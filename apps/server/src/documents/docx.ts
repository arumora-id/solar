/**
 * Word (.docx) → Markdown: mammoth turns WordprocessingML into semantic HTML (reading every part through the guarded
 * ZIP reader), turndown turns that into Markdown with rules for tables, compact lists, footnotes and images.
 */
import type TurndownService from 'turndown';
import { fmtInt, mdTable, withTimeout } from './limits.js';
import { checkPart, LIST_MARK, normPath, prepareDocx } from './docxPrepare.js';
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
      const label = new RegExp(`^\\s*${LIST_MARK}([^${LIST_MARK}]*)${LIST_MARK}\\s*`).exec(content);
      if (label) {
        // the number Word shows (continues across interruptions, "2.1", "a)", ...)
        prefix = `${label[1]} `;
        content = content.slice(label[0].length);
      } else if (parent && parent.nodeName === 'OL') {
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

const HTML_VOID = new Set(['br', 'img', 'hr', 'col', 'input', 'meta', 'link', 'wbr', 'area', 'base', 'source']);

function topLevelElements(html: string): string[] {
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^<>]*?(\/?)>/g;
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

/** Direct <li> children of a list. */
function listItems(listHtml: string): { tag: string; start: number; items: string[] } | null {
  const open = /^\s*<(ul|ol)\b([^<>]*)>/i.exec(listHtml);
  if (!open || !new RegExp(`</${open[1]}>\\s*$`, 'i').test(listHtml)) return null;
  const inner = listHtml.slice(open[0].length, listHtml.toLowerCase().lastIndexOf(`</${open[1]!.toLowerCase()}>`));
  const start = Number(/\bstart="(\d+)"/.exec(open[2] ?? '')?.[1] ?? 1);
  return { tag: open[1]!.toLowerCase(), start, items: topLevelElements(inner).filter((el) => /^\s*<li\b/i.test(el)) };
}

/** Cells of a small table (a layout table holding the document text), or null for a real data table. */
function layoutCells(tableHtml: string): string[] | null {
  const rows = splitTableRows(tableHtml);
  if (!rows || rows.length > 3) return null;
  const cells: string[] = [];
  for (const row of rows) {
    const inner = row.slice(row.indexOf('>') + 1, row.toLowerCase().lastIndexOf('</tr>'));
    for (const c of topLevelElements(inner)) {
      const m = /^\s*<(td|th)\b[^<>]*>([\s\S]*)<\/\1>\s*$/i.exec(c);
      if (m) cells.push(m[2]!);
    }
  }
  return cells;
}

/** Rowspans still open after each row, so a table is only split where no merged cell continues. */
function openRowspans(rows: string[]): number[] {
  const open: number[] = [];
  let carry = 0;
  for (const r of rows) {
    let longest = 0;
    for (const m of r.matchAll(/\browspan="(\d+)"/gi)) longest = Math.max(longest, Number(m[1]) - 1);
    carry = Math.max(carry - 1, longest);
    open.push(carry);
  }
  return open;
}

/**
 * Splits mammoth's HTML into chunks of complete top-level elements. turndown's output joining is quadratic in the
 * number of siblings, so one call on a long document takes tens of seconds; per-chunk conversion stays linear.
 * Long lists are split into batches of items, layout tables (a few rows holding the whole text) are unwrapped, and
 * very large tables are split into row batches where no merged cell continues; continuation batches are flagged so
 * they join without a blank line (lists) or without a header separator (tables).
 */
export function splitTopLevelHtml(html: string, chunkChars = 48 * 1024, rowsPerBatch = 400, itemsPerBatch = 300): Array<{ html: string; cont: boolean }> {
  const chunks: Array<{ html: string; cont: boolean }> = [];
  let cur = '';
  const flush = () => {
    if (cur) chunks.push({ html: cur, cont: false });
    cur = '';
  };
  for (const el of topLevelElements(html)) {
    if (el.length > chunkChars * 4 && /^\s*<(ul|ol)\b/i.test(el)) {
      const list = listItems(el);
      if (list && list.items.length > itemsPerBatch) {
        flush();
        for (let i = 0; i < list.items.length; i += itemsPerBatch) {
          const start = list.tag === 'ol' ? ` start="${list.start + i}"` : '';
          chunks.push({ html: `<${list.tag}${start}>${list.items.slice(i, i + itemsPerBatch).join('')}</${list.tag}>`, cont: i > 0 });
        }
        continue;
      }
    }
    if (el.length > chunkChars * 4 && /^\s*<table\b/i.test(el)) {
      const cells = layoutCells(el);
      if (cells) {
        flush();
        for (const cell of cells) chunks.push(...splitTopLevelHtml(cell, chunkChars, rowsPerBatch, itemsPerBatch));
        continue;
      }
      const rows = splitTableRows(el);
      if (rows && rows.length > rowsPerBatch) {
        flush();
        const open = openRowspans(rows);
        let batch: string[] = [];
        let first = true;
        rows.forEach((row, i) => {
          batch.push(row);
          const last = i === rows.length - 1;
          if (last || (batch.length >= rowsPerBatch && open[i] === 0) || batch.length >= rowsPerBatch * 4) {
            chunks.push({ html: `<table${first ? '' : ' data-cont="1"'}>${batch.join('')}</table>`, cont: !first });
            batch = [];
            first = false;
          }
        });
        continue;
      }
    }
    cur += el;
    if (cur.length >= chunkChars) flush();
  }
  flush();
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

/** mammoth notes that say nothing useful to a SOLAR user (styles, images are never displayed anyway, ...). */
const QUIET_MESSAGES = [
  /^Unrecognised (paragraph|run|table|numbering) style/i,
  /w:(proofErr|lastRenderedPageBreak|bookmark)/,
  /^Image of type .* is unlikely to display in web browsers/i,
  /style with ID .* was referenced but not defined/i,
  /^Could not find image file for a:blip element/i,
];

/** The last block end (paragraph, list item, heading, row, table, list) at or before `cap`. */
function lastBlockEnd(html: string, cap: number): number {
  let cut = -1;
  for (const m of html.slice(0, cap).matchAll(/<\/(?:p|li|h[1-6]|tr|table|ul|ol|blockquote)>/gi)) cut = m.index! + m[0].length;
  return cut;
}

export async function extractDocx(ctx: ParseContext, zip: ZipArchive, pkg: OoxmlPackage): Promise<ParsedDocument> {
  const { limits, deadline, warnings, maxChars } = ctx;
  const prepared = prepareDocx(zip, { limits, deadline, maxChars, warnings });
  const mammoth = (await import('mammoth')).default;
  const td = await getTurndown();

  // mammoth reads the package through this object: prepared parts as prepared, every other XML part size-capped and
  // checked, binary parts (never needed: images are not embedded) through the guarded inflater
  const checked = new Map<string, string>();
  const file = {
    exists: (name: string) => zip.has(name) && !prepared.hidden.has(normPath(name)),
    read: (name: string, encoding?: string): Promise<string | Uint8Array> => {
      try {
        deadline.check();
        const key = normPath(name);
        if (prepared.hidden.has(key)) return Promise.reject(new Error(`missing part ${name}`));
        if (!encoding || encoding === 'base64') {
          const b = zip.read(name);
          if (!b) return Promise.reject(new Error(`missing part ${name}`));
          return Promise.resolve(encoding ? Buffer.from(b).toString('base64') : b);
        }
        const text = prepared.texts.get(key) ?? checked.get(key);
        if (text !== undefined) return Promise.resolve(text);
        const raw = zip.text(name, limits.maxDocxXmlBytes);
        if (raw === null) return Promise.reject(new Error(`missing part ${name}`));
        checkPart(raw, name);
        checked.set(key, raw);
        return Promise.resolve(raw);
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
    // mammoth's own errors are JavaScript internals; the user gets a plain explanation
    throw documentError('CORRUPT', 'File Word ini berisi struktur yang tidak bisa dibaca (referensi atau elemen rusak). Coba buka di Word lalu simpan ulang.');
  }

  const unusual = (result.messages ?? []).filter((m) => (m.type === 'warning' || m.type === 'error') && !QUIET_MESSAGES.some((q) => q.test(m.message)));
  if (unusual.length) warnings.push('Sebagian elemen Word tidak dikenali dan dilewati.');

  let html = result.value ?? '';
  const htmlCap = Math.min(limits.maxDocxHtmlChars, Math.max(200_000, maxChars * 4));
  if (html.length > htmlCap) {
    const total = html.length;
    const cut = lastBlockEnd(html, htmlCap);
    html = html.slice(0, cut > 0 ? cut : htmlCap); // the HTML parser closes any list or table left open
    warnings.push(`Dokumen dipotong: hanya ${fmtInt(html.length)} dari ${fmtInt(total)} karakter hasil konversi (~${Math.round((html.length / total) * 100)}%) yang dibaca.`);
  }
  deadline.check();
  let md = '';
  for (const chunk of splitTopLevelHtml(html)) {
    deadline.check();
    const part = td.turndown(chunk.html).trim();
    if (part) md += (md ? (chunk.cont ? '\n' : '\n\n') : '') + part;
  }
  // numbers of numbered paragraphs that were not rendered as list items
  md = md.replace(new RegExp(`${LIST_MARK}([^${LIST_MARK}]*)${LIST_MARK}\\s*`, 'g'), '$1 ');
  // turndown escapes "1." at the start of any block; inside an ATX heading that is unnecessary
  md = md.replace(/^(#{1,6} +\d+(?:\.\d+)*)\\\./gm, '$1.');
  if (/macroenabled/i.test(pkg.mainType)) warnings.push('Dokumen berisi makro; makro diabaikan (tidak pernah dijalankan).');
  return { kind: 'docx', markdown: md, parts: null };
}
