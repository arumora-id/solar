/**
 * Word (.docx) → Markdown: mammoth turns WordprocessingML into semantic HTML (reading every part through the guarded
 * ZIP reader), turndown turns that into Markdown with rules for tables, compact lists, footnotes and images.
 */
import type TurndownService from 'turndown';
import { fmtInt, fmtMB, MB, mdTable, withTimeout } from './limits.js';
import { DocumentError, documentError, type ParseContext, type ParsedDocument } from './types.js';
import type { OoxmlPackage, ZipArchive } from './zip.js';

/** The part of the DOM API the turndown rules use (turndown parses HTML with domino in Node). */
interface DomNode {
  nodeType: number;
  nodeName: string;
  childNodes: ArrayLike<DomNode>;
  children: ArrayLike<DomNode>;
  parentNode: DomNode | null;
  nextSibling: DomNode | null;
  firstChild: DomNode | null;
  innerHTML: string;
  getAttribute(name: string): string | null;
}

const dom = (node: unknown) => node as DomNode;
const childElements = (node: DomNode, names: string[]) =>
  Array.from(node.childNodes ?? []).filter((c) => c.nodeType === 1 && names.includes(c.nodeName));

// Table rules: TD/TR wrap their (already converted) content in control-character sentinels and the TABLE rule splits
// them back into a grid. Converting each cell only once keeps this linear.
const CELL_START = '\u0001';
const CELL_END = '\u0002';
const ROW_START = '\u0003';
const ROW_END = '\u0004';

function tableReplacement(content: string, node: DomNode): string {
  const trs: DomNode[] = [];
  for (const c of childElements(node, ['TR', 'THEAD', 'TBODY', 'TFOOT'])) {
    if (c.nodeName === 'TR') trs.push(c);
    else trs.push(...childElements(c, ['TR']));
  }
  const rowTexts = content
    .split(ROW_START)
    .slice(1)
    .map((r) => r.slice(0, r.lastIndexOf(ROW_END)));
  const grid: string[][] = [];
  const carry: number[] = []; // rowspan carry-over: column -> remaining rows
  trs.forEach((tr, ri) => {
    const cellTexts = (rowTexts[ri] ?? '')
      .split(CELL_START)
      .slice(1)
      .map((c) => c.slice(0, c.lastIndexOf(CELL_END)));
    const row: string[] = [];
    let col = 0;
    const skipCarried = () => {
      while ((carry[col] ?? 0) > 0) {
        row[col] = '';
        carry[col]! -= 1;
        col += 1;
      }
    };
    childElements(tr, ['TD', 'TH']).forEach((cell, ci) => {
      skipCarried();
      const span = Math.max(1, Math.min(50, parseInt(cell.getAttribute('colspan') ?? '1', 10) || 1));
      const rowSpan = Math.max(1, Math.min(1000, parseInt(cell.getAttribute('rowspan') ?? '1', 10) || 1));
      row[col] = (cellTexts[ci] ?? '')
        .trim()
        .replace(/\|/g, '\\|')
        .replace(/\n\s*\n/g, '\n')
        .replace(/\n/g, '<br>');
      for (let k = 0; k < span; k++) {
        if (k > 0) row[col + k] = '';
        if (rowSpan > 1) carry[col + k] = rowSpan - 1;
      }
      col += span;
    });
    skipCarried();
    for (let c = col; c < carry.length; c++) {
      if ((carry[c] ?? 0) > 0) {
        row[c] = '';
        carry[c]! -= 1;
      }
    }
    grid.push(Array.from({ length: row.length }, (_, i) => row[i] ?? ''));
  });
  if (!grid.length) return '';
  if (node.getAttribute('data-cont') === '1') {
    // continuation batch of a split table: rows only (no header separator)
    const lines = mdTable(grid).split('\n');
    lines.splice(1, 1);
    return `\n\n${lines.join('\n')}\n\n`;
  }
  // header cells are usually bold in Word; being the header row already says so
  grid[0] = grid[0]!.map((c) => c.replace(/^\*\*([^*]+)\*\*$/, '$1'));
  return `\n\n${mdTable(grid)}\n\n`;
}

let turndownInstance: TurndownService | null = null;

async function getTurndown(): Promise<TurndownService> {
  if (turndownInstance) return turndownInstance;
  const Turndown = (await import('turndown')).default;
  const td = new Turndown({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '_',
    strongDelimiter: '**',
    hr: '---',
  });
  td.addRule('tableCell', { filter: ['td', 'th'], replacement: (content) => CELL_START + content + CELL_END });
  td.addRule('tableRow', { filter: 'tr', replacement: (content) => ROW_START + content + ROW_END });
  td.addRule('tableSection', { filter: ['thead', 'tbody', 'tfoot'], replacement: (content) => content });
  td.addRule('table', { filter: 'table', replacement: (content, node) => tableReplacement(content, dom(node)) });
  // compact list items ("- x", "1. x") with continuation lines indented to the content column
  td.addRule('compactListItem', {
    filter: 'li',
    replacement(content, node) {
      const n = dom(node);
      let prefix = '- ';
      const parent = n.parentNode;
      if (parent && parent.nodeName === 'OL') {
        const start = parent.getAttribute('start');
        const index = Array.prototype.indexOf.call(parent.children, n);
        prefix = `${start ? Number(start) + index : index + 1}. `;
      }
      const isParagraph = /\n$/.test(content);
      let c = content.replace(/^\n+/, '').replace(/\n+$/, '') + (isParagraph ? '\n' : '');
      c = c.replace(/\n/gm, `\n${' '.repeat(prefix.length)}`);
      return prefix + c + (n.nextSibling ? '\n' : '');
    },
  });
  td.addRule('strike', { filter: ['del', 's'], replacement: (c) => (c.trim() ? `~~${c}~~` : '') });
  const noteHref = (node: unknown) => dom(node).getAttribute('href') ?? '';
  td.addRule('noteRef', {
    filter: (node) => dom(node).nodeName === 'A' && /^#(footnote|endnote)-(?!ref-)/.test(noteHref(node)),
    replacement: (_c, node) => {
      const m = /^#(footnote|endnote)-(.+)$/.exec(noteHref(node));
      return m ? `[^${m[1] === 'endnote' ? 'e' : ''}${m[2]}]` : '';
    },
  });
  td.addRule('noteBacklink', {
    filter: (node) => dom(node).nodeName === 'A' && /^#(footnote|endnote)-ref-/.test(noteHref(node)),
    replacement: () => '',
  });
  td.addRule('supNote', {
    filter: (node) => {
      const n = dom(node);
      return n.nodeName === 'SUP' && n.childNodes.length === 1 && n.firstChild?.nodeName === 'A' && /^#(footnote|endnote)-/.test(noteHref(n.firstChild));
    },
    replacement: (c) => c,
  });
  td.addRule('noteList', {
    filter: (node) => {
      const items = childElements(dom(node), ['LI']);
      return dom(node).nodeName === 'OL' && items.length > 0 && items.every((li) => /^(footnote|endnote)-/.test(li.getAttribute('id') ?? ''));
    },
    replacement: (_c, node) => {
      const items = childElements(dom(node), ['LI']).map((li) => {
        const m = /^(footnote|endnote)-(.+)$/.exec(li.getAttribute('id') ?? '');
        const text = td
          .turndown(li.innerHTML || '')
          .trim()
          .replace(/\s*\n+\s*/g, ' ');
        return `[^${m?.[1] === 'endnote' ? 'e' : ''}${m?.[2] ?? ''}]: ${text}`;
      });
      return `\n\n${items.join('\n')}\n\n`;
    },
  });
  td.addRule('image', {
    filter: 'img',
    replacement: (_c, node) => {
      const alt = (dom(node).getAttribute('alt') ?? '').trim().replace(/\s+/g, ' ');
      return alt ? `[Image: ${alt}]` : '[Image]';
    },
  });
  turndownInstance = td;
  return td;
}

/**
 * Cuts an oversized WordprocessingML main part after the last complete top-level body block (paragraph, table,
 * content control, ...) that fits in `budget` characters, then closes the body. Null when no cut is needed or possible.
 */
export function truncateDocxXml(xml: string, budget: number): string | null {
  if (xml.length <= budget) return null;
  const rootMatch = /<([\w.-]+:)?document\b/.exec(xml);
  const prefix = rootMatch ? (rootMatch[1] ?? '') : 'w:';
  const bodyAt = xml.indexOf(`<${prefix}body`);
  if (bodyAt < 0) return null;
  const re = /<(\/?)([\w.:-]+)[^>]*?(\/?)>/g;
  re.lastIndex = xml.indexOf('>', bodyAt) + 1;
  const stack: string[] = [];
  let lastCut = -1;
  let closers = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && re.lastIndex <= budget) {
    if (m[0].startsWith('<?') || m[0].startsWith('<!')) continue;
    if (m[3] === '/') {
      if (!stack.length && !/sectPr$/.test(m[2]!)) [lastCut, closers] = [re.lastIndex, ''];
      continue;
    }
    if (m[1] === '/') {
      if (!stack.length) break; // </w:body>
      stack.pop();
      if (!stack.length) [lastCut, closers] = [re.lastIndex, ''];
      // inside a top-level table a finished row is also a safe cut point (the table gets closed)
      else if (stack.length === 1 && /(^|:)tr$/.test(m[2]!) && /(^|:)tbl$/.test(stack[0]!)) [lastCut, closers] = [re.lastIndex, `</${stack[0]}>`];
    } else {
      stack.push(m[2]!);
    }
  }
  if (lastCut < 0) return null;
  return `${xml.slice(0, lastCut)}${closers}</${prefix}body></${prefix}document>`;
}

const HTML_VOID = new Set(['br', 'img', 'hr', 'col', 'input', 'meta', 'link', 'wbr', 'area', 'base', 'source']);

function topLevelElements(html: string): string[] {
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const name = m[2]!.toLowerCase();
    if (m[3] === '/' || HTML_VOID.has(name)) continue;
    if (m[1] === '/') depth = Math.max(0, depth - 1);
    else depth += 1;
    if (depth === 0) {
      out.push(html.slice(start, re.lastIndex));
      start = re.lastIndex;
    }
  }
  if (start < html.length) out.push(html.slice(start));
  return out;
}

/** Direct <tr> children of a table or of its thead/tbody/tfoot. */
function splitTableRows(tableHtml: string): string[] | null {
  const open = /^<table\b[^>]*>/i.exec(tableHtml);
  if (!open || !/<\/table>\s*$/i.test(tableHtml)) return null;
  const inner = tableHtml.slice(open[0].length, tableHtml.lastIndexOf('</table>'));
  const rows: string[] = [];
  for (const el of topLevelElements(inner)) {
    const section = /^\s*<(thead|tbody|tfoot)\b[^>]*>([\s\S]*)<\/\1>\s*$/i.exec(el);
    if (section) rows.push(...topLevelElements(section[2]!).filter((r) => /^\s*<tr\b/i.test(r)));
    else if (/^\s*<tr\b/i.test(el)) rows.push(el);
  }
  return rows;
}

/**
 * Splits mammoth's flat HTML into chunks of complete top-level elements. turndown's output joining is quadratic in
 * the number of siblings, so one call on a long document takes tens of seconds; per-chunk conversion stays linear.
 * Very large tables are split into row batches; continuation batches are flagged (data-cont) so they render without
 * a header separator and join into one Markdown table.
 */
export function splitTopLevelHtml(html: string, chunkChars = 48 * 1024, rowsPerBatch = 400): Array<{ html: string; cont: boolean }> {
  const chunks: Array<{ html: string; cont: boolean }> = [];
  let cur = '';
  for (const el of topLevelElements(html)) {
    if (el.length > chunkChars * 4 && /^\s*<table\b/i.test(el)) {
      const rows = splitTableRows(el);
      if (rows && rows.length > rowsPerBatch) {
        if (cur) chunks.push({ html: cur, cont: false });
        cur = '';
        for (let i = 0; i < rows.length; i += rowsPerBatch) {
          chunks.push({ html: `<table${i ? ' data-cont="1"' : ''}>${rows.slice(i, i + rowsPerBatch).join('')}</table>`, cont: i > 0 });
        }
        continue;
      }
    }
    cur += el;
    if (cur.length >= chunkChars) {
      chunks.push({ html: cur, cont: false });
      cur = '';
    }
  }
  if (cur) chunks.push({ html: cur, cont: false });
  return chunks;
}

interface MammothElement {
  type?: string;
  styleName?: string | null;
  styleId?: string | null;
  children?: MammothElement[];
}

function walk(el: MammothElement, fn: (el: MammothElement) => void): void {
  fn(el);
  for (const child of el.children ?? []) walk(child, fn);
}

const isTitle = (el: MammothElement) => /^title$/i.test(el.styleName ?? '') || /^title$/i.test(el.styleId ?? '');

/** Maps Title to h1 and shifts Heading N one level down when the document has a title, so the outline stays nested. */
function normalizeHeadings(doc: MammothElement): MammothElement {
  let hasTitle = false;
  walk(doc, (el) => {
    if (el.type === 'paragraph' && isTitle(el)) hasTitle = true;
  });
  const shift = hasTitle ? 1 : 0;
  walk(doc, (el) => {
    if (el.type !== 'paragraph') return;
    if (isTitle(el)) {
      el.styleName = '__h1';
      return;
    }
    const m = /^heading\s*([1-9])$/i.exec(el.styleName ?? '') ?? /^heading([1-9])$/i.exec(el.styleId ?? '');
    if (m) el.styleName = `__h${Math.min(6, parseInt(m[1]!, 10) + shift)}`;
  });
  return doc;
}

const HEADING_STYLES = [1, 2, 3, 4, 5, 6].map((i) => `p[style-name='__h${i}'] => h${i}:fresh`);

export async function extractDocx(ctx: ParseContext, zip: ZipArchive, pkg: OoxmlPackage): Promise<ParsedDocument> {
  const { limits, deadline, warnings, maxChars } = ctx;
  const mammoth = (await import('mammoth')).default;
  const td = await getTurndown();

  // mammoth (~100-150 MB of memory per MB of XML) only gets the first blocks of a huge document
  const xmlBudget = Math.max(1 * MB, Math.min(limits.maxDocxXmlBytes, maxChars * 3));
  const mainPart = pkg.mainPart.toLowerCase();
  // mammoth reads the package through this object, so every part goes through the guarded inflater
  const file = {
    exists: (name: string) => zip.has(name),
    read: (name: string, encoding?: string): Promise<string | Uint8Array> => {
      try {
        deadline.check();
        const b = zip.read(name);
        if (!b) return Promise.reject(new Error(`missing part ${name}`));
        if (encoding === 'base64') return Promise.resolve(Buffer.from(b).toString('base64'));
        if (!encoding) return Promise.resolve(b);
        let text = new TextDecoder(encoding).decode(b);
        if (name.replace(/^\/+/, '').toLowerCase() === mainPart && text.length > xmlBudget) {
          const cut = truncateDocxXml(text, xmlBudget);
          if (cut) {
            warnings.push(
              `Dokumen dipotong: hanya ${fmtMB(cut.length)} pertama dari ${fmtMB(text.length)} isi dokumen (~${Math.round((cut.length / text.length) * 100)}%) yang dibaca.`,
            );
            text = cut;
          }
        }
        return Promise.resolve(text);
      } catch (err) {
        return Promise.reject(err);
      }
    },
  };

  let result: { value: string; messages: Array<{ type: string; message: string }> };
  try {
    result = await withTimeout(
      mammoth.convertToHtml({ file } as unknown as Parameters<typeof mammoth.convertToHtml>[0], {
        styleMap: HEADING_STYLES,
        includeDefaultStyleMap: true,
        transformDocument: normalizeHeadings,
        ignoreEmptyParagraphs: true,
        externalFileAccess: false,
        convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' })),
      }),
      deadline,
    );
  } catch (err) {
    if (err instanceof DocumentError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw documentError('CORRUPT', `File rusak atau bukan dokumen Word yang valid (${message.slice(0, 200)}).`);
  }

  const notes = (result.messages ?? [])
    .filter((m) => m.type === 'warning' || m.type === 'error')
    .map((m) => m.message)
    .filter((m) => !/^Unrecognised (paragraph|run|table|numbering) style/i.test(m) && !/w:(proofErr|lastRenderedPageBreak|bookmark)/.test(m));
  for (const m of [...new Set(notes)].slice(0, 3)) warnings.push(`Catatan konversi Word: ${m}`);

  let html = result.value ?? '';
  const htmlCap = Math.min(limits.maxDocxHtmlChars, Math.max(200_000, maxChars * 4));
  if (html.length > htmlCap) {
    const cut = html.lastIndexOf('</p>', htmlCap);
    html = html.slice(0, cut > 0 ? cut + 4 : htmlCap);
    warnings.push(`Dokumen dipotong: hanya sekitar ${fmtInt(htmlCap)} karakter pertama hasil konversi yang dibaca.`);
  }
  deadline.check();
  let md = '';
  for (const chunk of splitTopLevelHtml(html)) {
    deadline.check();
    const part = td.turndown(chunk.html).trim();
    if (part) md += (md ? (chunk.cont ? '\n' : '\n\n') : '') + part;
  }
  // turndown escapes "1." at the start of any block; inside an ATX heading that is unnecessary
  md = md.replace(/^(#{1,6} +\d+(?:\.\d+)*)\\\./gm, '$1.');
  if (/macroenabled/i.test(pkg.mainType)) warnings.push('Dokumen berisi makro; makro diabaikan (tidak pernah dijalankan).');
  return { kind: 'docx', markdown: md, parts: null };
}
