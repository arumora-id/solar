/**
 * PowerPoint (.pptx) → Markdown: slides in presentation order with their title, text (bullets kept), tables, chart
 * data, SmartArt text, image descriptions and speaker notes. Parts are read through the guarded ZIP reader.
 */
import { fmtInt, MB, mdCell, mdTable, yieldToLoop } from './limits.js';
import { DocumentError, documentError, type ParseContext, type ParsedDocument } from './types.js';
import { attrNS, descendants, kid, kids, parseXml, path, textContent, type XmlElement } from './xml.js';
import { dirOf, parseRels, relsPathOf, resolvePart, type OoxmlPackage, type Relationship, type ZipArchive } from './zip.js';

const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
/** Tree-parsed parts stay modest; a single slide is rarely more than a few hundred KB. */
const MAX_PART_BYTES = 16 * MB;

function parsePart(xml: string, label: string): XmlElement {
  try {
    return parseXml(xml);
  } catch {
    throw documentError('CORRUPT', `Presentasi rusak (bagian ${label} tidak bisa dibaca).`);
  }
}

/** A relationship id attribute (r:id, r:dm, ...) whatever prefix the part uses for the relationships namespace. */
const relAttr = (el: XmlElement, root: XmlElement, name: string) => el.attrs[`r:${name}`] ?? attrNS(el, root, RELATIONSHIPS_NS, name) ?? '';

function paragraphText(p: XmlElement): string {
  let s = '';
  for (const c of kids(p)) {
    if (c.localName === 'r' || c.localName === 'fld') s += kids(c, 't').map(textContent).join('');
    else if (c.localName === 'br') s += '\n';
  }
  return s.replace(/\u000b/g, '\n');
}

interface Paragraph {
  text: string;
  level: number;
  bullet: 'none' | 'num' | 'char' | null;
}

function shapeParagraphs(txBody: XmlElement): Paragraph[] {
  return kids(txBody, 'p')
    .map((p): Paragraph => {
      const pPr = kid(p, 'pPr');
      let bullet: Paragraph['bullet'] = null;
      if (pPr) {
        if (kid(pPr, 'buNone')) bullet = 'none';
        else if (kid(pPr, 'buAutoNum')) bullet = 'num';
        else if (kid(pPr, 'buChar') || kid(pPr, 'buBlip')) bullet = 'char';
      }
      const level = pPr ? Math.min(8, parseInt(pPr.attrs.lvl || '0', 10) || 0) : 0;
      return { text: paragraphText(p).trim(), level, bullet };
    })
    .filter((p) => p.text);
}

function renderParagraphs(paras: Paragraph[], bulletByDefault: boolean): string {
  const lines: string[] = [];
  const counters: number[] = [];
  for (const p of paras) {
    const kind = p.bullet === 'none' ? null : (p.bullet ?? (bulletByDefault ? 'char' : null));
    const text = p.text.replace(/\n+/g, kind ? ' ' : '\n');
    if (!kind) {
      lines.push(text);
      counters.length = 0;
      continue;
    }
    counters.length = p.level + 1;
    counters[p.level] = (counters[p.level] ?? 0) + 1;
    lines.push(`${'  '.repeat(p.level)}${kind === 'num' ? `${counters[p.level]}.` : '-'} ${text}`);
  }
  return lines.join('\n');
}

function tableToMarkdown(tbl: XmlElement, maxCellChars: number): string {
  const rows = kids(tbl, 'tr').map((tr) =>
    kids(tr, 'tc').map((tc) => {
      if (tc.attrs.hMerge === '1' || tc.attrs.vMerge === '1') return '';
      const tx = kid(tc, 'txBody');
      return mdCell(tx ? shapeParagraphs(tx).map((p) => p.text).join('\n') : '', maxCellChars);
    }),
  );
  return rows.length ? mdTable(rows) : '';
}

async function chartToMarkdown(zip: ZipArchive, chartPath: string): Promise<string> {
  const xml = zip.text(chartPath, MAX_PART_BYTES);
  if (!xml) return '';
  const root = parsePart(xml, chartPath);
  const titleEl = descendants(root, 'title')[0] ?? null;
  const title = titleEl ? descendants(titleEl, 't').map(textContent).join('').trim() : '';
  const points = (el: XmlElement | null) => {
    const m = new Map<number, string>();
    for (const pt of descendants(el, 'pt')) m.set(Number(pt.attrs.idx), textContent(kid(pt, 'v')).trim());
    return m;
  };
  const series = descendants(root, 'ser').map((ser) => {
    const tx = kid(ser, 'tx');
    return {
      name: tx ? descendants(tx, 'v').map(textContent).join(' ').trim() : '',
      cat: points(kid(ser, 'cat') ?? kid(ser, 'xVal')),
      val: points(kid(ser, 'val') ?? kid(ser, 'yVal')),
    };
  });
  const lines = [`[Chart${title ? `: ${title}` : ''}]`];
  const first = series[0];
  if (first) {
    const categories: Array<[number, string]> = first.cat.size
      ? [...first.cat.entries()].sort((a, b) => a[0] - b[0])
      : [...first.val.keys()].sort((a, b) => a - b).map((i): [number, string] => [i, String(i + 1)]);
    const rows = [['Category', ...series.map((s, i) => mdCell(s.name || `Series ${i + 1}`))]];
    for (const [idx, cat] of categories.slice(0, 200)) rows.push([mdCell(cat), ...series.map((s) => mdCell(s.val.get(idx) ?? ''))]);
    lines.push(mdTable(rows));
  }
  return lines.join('\n\n');
}

const SKIPPED_PLACEHOLDERS = new Set(['sldNum', 'dt', 'ftr', 'hdr', 'sldImg']);

export async function extractPptx(ctx: ParseContext, zip: ZipArchive, pkg: OoxmlPackage): Promise<ParsedDocument> {
  const { limits, deadline, warnings, maxChars } = ctx;
  const presPath = pkg.mainPart;
  const presXml = zip.text(presPath, MAX_PART_BYTES);
  if (!presXml) throw documentError('CORRUPT', 'File bukan presentasi PowerPoint yang valid (ppt/presentation.xml tidak ada).');
  const presRels = new Map(parseRels(zip.text(relsPathOf(presPath), 4 * MB)).map((r) => [r.id, r]));
  const presRoot = parsePart(presXml, presPath);
  const slidePaths: string[] = [];
  for (const s of kids(path(presRoot, 'sldIdLst'), 'sldId')) {
    const rel = presRels.get(relAttr(s, presRoot, 'id'));
    if (rel) slidePaths.push(resolvePart(dirOf(presPath), rel.target));
  }
  const total = slidePaths.length;
  const limit = Math.min(total, limits.maxSlides);
  if (total > limit) warnings.push(`Presentasi dipotong: hanya ${fmtInt(limit)} dari ${fmtInt(total)} slide pertama yang dibaca.`);
  const parts: string[] = [];
  let chars = 0;
  let emptySlides = 0;
  let read = 0;

  for (let i = 0; i < limit; i++) {
    deadline.check();
    const slidePath = slidePaths[i]!;
    read += 1;
    const xml = zip.text(slidePath, MAX_PART_BYTES);
    if (!xml) {
      parts.push(`## Slide ${i + 1}\n\n_(bagian slide tidak ada)_`);
      continue;
    }
    const root = parsePart(xml, slidePath);
    const slideRels = new Map<string, Relationship>(parseRels(zip.text(relsPathOf(slidePath), 4 * MB)).map((r) => [r.id, r]));
    const hidden = root.attrs.show === '0';
    let title = '';
    const blocks: string[] = [];

    const handleShape = (shape: XmlElement) => {
      const ph = path(shape, 'nvSpPr', 'nvPr', 'ph');
      const phType = ph ? ph.attrs.type || 'obj' : null;
      if (phType && SKIPPED_PLACEHOLDERS.has(phType)) return;
      const tx = kid(shape, 'txBody');
      if (!tx) return;
      const paras = shapeParagraphs(tx);
      if (!paras.length) return;
      if ((phType === 'title' || phType === 'ctrTitle') && !title) {
        title = paras
          .map((p) => p.text.replace(/\s*\n+\s*/g, ' '))
          .join(' ')
          .trim();
        return;
      }
      blocks.push(renderParagraphs(paras, phType === 'body' || phType === 'obj'));
    };

    const graphicFrame = async (el: XmlElement) => {
      const gd = path(el, 'graphic', 'graphicData');
      if (!gd) return;
      const uri = gd.attrs.uri ?? '';
      const tbl = kid(gd, 'tbl');
      if (tbl) {
        const t = tableToMarkdown(tbl, limits.maxCellChars);
        if (t) blocks.push(t);
        return;
      }
      if (/\/chart$/.test(uri)) {
        const c = kid(gd, 'chart');
        const rel = c ? slideRels.get(relAttr(c, root, 'id')) : undefined;
        if (!rel) return;
        try {
          const md = await chartToMarkdown(zip, resolvePart(dirOf(slidePath), rel.target));
          if (md) blocks.push(md);
        } catch (err) {
          // a broken chart part costs the chart, not the presentation; size and bomb limits still apply
          if (err instanceof DocumentError && (err.code === 'ZIP_BOMB' || err.code === 'TOO_LARGE' || err.code === 'TIMEOUT')) throw err;
        }
        return;
      }
      if (/\/diagram$/.test(uri)) {
        const ids = kid(gd, 'relIds');
        const rel = ids ? slideRels.get(relAttr(ids, root, 'dm')) : undefined;
        const dataXml = rel ? zip.text(resolvePart(dirOf(slidePath), rel.target), MAX_PART_BYTES) : null;
        if (!dataXml) return;
        const items = descendants(parsePart(dataXml, 'SmartArt'), 'pt')
          .map((pt) => {
            const t = kid(pt, 't');
            return t ? kids(t, 'p').map(paragraphText).join(' ').trim() : '';
          })
          .filter(Boolean);
        if (items.length) blocks.push(items.map((t) => `- ${t}`).join('\n'));
      }
    };

    const walk = async (container: XmlElement | null): Promise<void> => {
      for (const el of kids(container)) {
        switch (el.localName) {
          case 'sp':
            handleShape(el);
            break;
          case 'grpSp':
            await walk(el);
            break;
          case 'AlternateContent': {
            const choice = kid(el, 'Choice') ?? kid(el, 'Fallback');
            if (choice) await walk(choice);
            break;
          }
          case 'graphicFrame':
            await graphicFrame(el);
            break;
          case 'pic': {
            const descr = path(el, 'nvPicPr', 'cNvPr')?.attrs.descr?.trim();
            if (descr) blocks.push(`[Image: ${descr.replace(/\s+/g, ' ')}]`);
            break;
          }
          default:
            break;
        }
      }
    };
    await walk(path(root, 'cSld', 'spTree'));

    let notes = '';
    const notesRel = [...slideRels.values()].find((r) => /\/notesSlide$/.test(r.type));
    if (notesRel) {
      const notesPath = resolvePart(dirOf(slidePath), notesRel.target);
      const notesXml = zip.text(notesPath, MAX_PART_BYTES);
      if (notesXml) {
        const texts: string[] = [];
        for (const shape of descendants(parsePart(notesXml, notesPath), 'sp')) {
          const ph = path(shape, 'nvSpPr', 'nvPr', 'ph');
          if (!ph || (ph.attrs.type || 'obj') !== 'body') continue;
          const tx = kid(shape, 'txBody');
          if (tx) texts.push(shapeParagraphs(tx).map((p) => p.text).join('\n'));
        }
        notes = texts.filter(Boolean).join('\n\n').trim();
      }
    }

    const heading = `## Slide ${i + 1}${title ? `: ${title}` : ''}${hidden ? ' (hidden)' : ''}`;
    const body = blocks.filter(Boolean).join('\n\n');
    if (!title && !body && !notes) emptySlides += 1;
    const section = [heading, body, notes ? `### Speaker notes\n\n${notes}` : ''].filter(Boolean).join('\n\n');
    parts.push(section);
    chars += section.length;
    if (chars > maxChars && i + 1 < total) {
      warnings.push(`Presentasi dipotong setelah slide ${i + 1} dari ${total} (batas ${fmtInt(maxChars)} karakter).`);
      break;
    }
    if (i % 20 === 19) await yieldToLoop();
  }
  if (total === 0) warnings.push('Presentasi tidak berisi slide.');
  else if (read > 0 && emptySlides === read) warnings.push('Tidak ada teks di slide mana pun (presentasi berisi gambar saja?).');
  if (/macroenabled/i.test(pkg.mainType)) warnings.push('Presentasi berisi makro; makro diabaikan (tidak pernah dijalankan).');
  return { kind: 'pptx', markdown: parts.join('\n\n'), parts: total };
}
