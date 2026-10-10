/**
 * PowerPoint (.pptx) → Markdown: slides in presentation order with their title, text (bullets kept), tables, chart
 * data, SmartArt text, image descriptions and speaker notes. Parts are read through the guarded ZIP reader.
 */
import { t, type Lang } from '../i18n.js';
import { fmtInt, MB, mdCell, mdTable, yieldToLoop } from './limits.js';
import { DocumentError, documentError, type ParseContext, type ParsedDocument } from './types.js';
import { attrNS, descendants, kid, kids, parseXml, path, textContent, type XmlElement } from './xml.js';
import { dirOf, parseRels, relsPathOf, resolvePart, type OoxmlPackage, type Relationship, type ZipArchive } from './zip.js';

const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
/** Tree-parsed parts stay modest; a single slide is rarely more than a few hundred KB. */
const MAX_PART_BYTES = 16 * MB;

function parsePart(xml: string, label: string, lang: Lang): XmlElement {
  try {
    return parseXml(xml);
  } catch {
    throw documentError('CORRUPT', t(lang, 'doc.pptx.badPart', { part: label }));
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

/** Counts what had to be shortened in a presentation, for one warning at the end. */
interface Cuts {
  cells: number;
  tables: number;
  charts: number;
}

const MAX_TABLE_ROWS = 1000;
const MAX_TABLE_COLUMNS = 50;
const MAX_CHART_SERIES = 50;

function tableToMarkdown(tbl: XmlElement, maxCellChars: number, cuts: Cuts, lang: Lang): string {
  const trs = kids(tbl, 'tr');
  let cut = trs.length > MAX_TABLE_ROWS;
  const rows = trs.slice(0, MAX_TABLE_ROWS).map((tr) => {
    const tcs = kids(tr, 'tc');
    if (tcs.length > MAX_TABLE_COLUMNS) cut = true;
    return tcs.slice(0, MAX_TABLE_COLUMNS).map((tc) => {
      if (tc.attrs.hMerge === '1' || tc.attrs.vMerge === '1') return '';
      const tx = kid(tc, 'txBody');
      const text = tx ? shapeParagraphs(tx).map((p) => p.text).join('\n') : '';
      if (text.length > maxCellChars) cuts.cells += 1;
      return mdCell(text, maxCellChars);
    });
  });
  if (cut) cuts.tables += 1;
  return rows.length ? mdTable(rows) + (cut ? `\n\n${t(lang, 'doc.pptx.tableCutNote', { rows: MAX_TABLE_ROWS, columns: MAX_TABLE_COLUMNS })}` : '') : '';
}

async function chartToMarkdown(zip: ZipArchive, chartPath: string, cuts: Cuts): Promise<string> {
  const xml = zip.text(chartPath, MAX_PART_BYTES);
  if (!xml) return '';
  const root = parsePart(xml, chartPath, zip.lang);
  // the chart's own title (c:chart/c:title), not an axis title
  const titleEl = path(root, 'chart', 'title');
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
    const shown = series.slice(0, MAX_CHART_SERIES);
    if (shown.length < series.length || categories.length > 200) cuts.charts += 1;
    const rows = [['Category', ...shown.map((s, i) => mdCell(s.name || `Series ${i + 1}`))]];
    for (const [idx, cat] of categories.slice(0, 200)) rows.push([mdCell(cat), ...shown.map((s) => mdCell(s.val.get(idx) ?? ''))]);
    lines.push(mdTable(rows));
  }
  return lines.join('\n\n');
}

const SKIPPED_PLACEHOLDERS = new Set(['sldNum', 'dt', 'ftr', 'hdr', 'sldImg']);

export async function extractPptx(ctx: ParseContext, zip: ZipArchive, pkg: OoxmlPackage): Promise<ParsedDocument> {
  const { limits, deadline, warnings, maxChars, lang } = ctx;
  const cuts: Cuts = { cells: 0, tables: 0, charts: 0 };
  const presPath = pkg.mainPart;
  const presXml = zip.text(presPath, MAX_PART_BYTES);
  if (!presXml) throw documentError('CORRUPT', t(lang, 'doc.pptx.invalid'));
  const presRels = new Map(parseRels(zip.text(relsPathOf(presPath), 4 * MB)).map((r) => [r.id, r]));
  const presRoot = parsePart(presXml, presPath, lang);
  const slidePaths: string[] = [];
  for (const s of kids(path(presRoot, 'sldIdLst'), 'sldId')) {
    const rel = presRels.get(relAttr(s, presRoot, 'id'));
    if (rel) slidePaths.push(resolvePart(dirOf(presPath), rel.target));
  }
  const total = slidePaths.length;
  const limit = Math.min(total, limits.maxSlides);
  if (total > limit) warnings.push(t(lang, 'doc.pptx.slideLimit', { limit: fmtInt(limit, lang), total: fmtInt(total, lang) }));
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
      parts.push(`## Slide ${i + 1}\n\n${t(lang, 'doc.pptx.slideMissingNote')}`);
      continue;
    }
    const root = parsePart(xml, slidePath, lang);
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
        const table = tableToMarkdown(tbl, limits.maxCellChars, cuts, lang);
        if (table) blocks.push(table);
        return;
      }
      if (/\/chart$/.test(uri)) {
        const c = kid(gd, 'chart');
        const rel = c ? slideRels.get(relAttr(c, root, 'id')) : undefined;
        if (!rel) return;
        try {
          const md = await chartToMarkdown(zip, resolvePart(dirOf(slidePath), rel.target), cuts);
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
        const items = descendants(parsePart(dataXml, 'SmartArt', lang), 'pt')
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
        for (const shape of descendants(parsePart(notesXml, notesPath, lang), 'sp')) {
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
      warnings.push(t(lang, 'doc.pptx.cutAfter', { slide: i + 1, total, max: fmtInt(maxChars, lang) }));
      break;
    }
    if (i % 20 === 19) await yieldToLoop();
  }
  if (total === 0) warnings.push(t(lang, 'doc.pptx.noSlides'));
  else if (read > 0 && emptySlides === read) warnings.push(t(lang, 'doc.pptx.noText'));
  if (cuts.tables) warnings.push(t(lang, 'doc.pptx.tablesCut', { n: cuts.tables, rows: MAX_TABLE_ROWS, columns: MAX_TABLE_COLUMNS }));
  if (cuts.charts) warnings.push(t(lang, 'doc.pptx.chartsCut', { n: cuts.charts, series: MAX_CHART_SERIES }));
  if (cuts.cells) {
    warnings.push(t(lang, 'doc.pptx.cellsCut', { n: fmtInt(cuts.cells, lang), cells: cuts.cells, max: fmtInt(limits.maxCellChars, lang) }));
  }
  if (/macroenabled/i.test(pkg.mainType)) warnings.push(t(lang, 'doc.pptx.macros'));
  return { kind: 'pptx', markdown: parts.join('\n\n'), parts: total };
}
