/**
 * Prepares a Word package before mammoth reads it. mammoth parses whole XML parts into a DOM (about 100-150 MB of
 * memory per MB of XML) with a parser that slows down badly on malformed markup, so every part it sees is
 * size-capped, cut at a safe boundary when needed and checked for well-formedness first (linear time). The
 * preparation also removes references mammoth would crash on, hides comments (never shown) and carries Word's list
 * and heading numbering into the text, since mammoth renders every list from 1 and drops heading numbers.
 */
import { fmtMB, MB, parseAttrs, type Deadline, type Limits } from './limits.js';
import { documentError } from './types.js';
import { assertWellFormed, kid, kids, parseXml, prefixFor, scanXml, type XmlElement } from './xml.js';
import { dirOf, parseRels, relsPathOf, resolvePart, type ZipArchive } from './zip.js';

const REL_NAMESPACES = ['http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'http://purl.oclc.org/ooxml/officeDocument/relationships'];
const WORD_NAMESPACES = ['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main'];
const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';

/** Wraps the number of a numbered list item so the Markdown converter can use it (invisible separator). */
export const LIST_MARK = '⁣';

/** Largest styles/numbering part handed to mammoth; bigger ones are skipped. */
const MAX_SIDE_PART = 2 * MB;
/** Footnotes and endnotes are cut after the last whole note within this size. */
const MAX_NOTES_PART = 1 * MB;
/** All XML handed to mammoth together (main part included). */
const TOTAL_XML_FACTOR = 1.5;

export interface PreparedDocx {
  mainPart: string;
  /** Pre-processed XML parts by normalised path; served to mammoth instead of the raw package content. */
  texts: Map<string, string>;
  /** Parts mammoth must not see (comments, oversized optional parts). */
  hidden: Set<string>;
}

export const normPath = (p: string) => p.replace(/^\/+/, '').toLowerCase();
/** An XML name prefix (letters, digits, '.', '-', '_') for use inside a RegExp. */
const esc = (prefix: string) => prefix.replace(/[.-]/g, '\\$&');

const corrupt = (part: string) =>
  documentError('CORRUPT', `File rusak atau bukan dokumen Word yang valid (XML bagian "${part}" tidak lengkap atau tidak valid).`);

/** Throws CORRUPT (Indonesian, without parser internals) unless the part is well-formed XML without a DOCTYPE. */
export function checkPart(text: string, part: string): void {
  try {
    assertWellFormed(text);
  } catch {
    throw corrupt(part);
  }
}

/** The first start tag of a document: its qualified name and attributes. */
function rootTag(xml: string): { name: string; attrs: Record<string, string> } | null {
  let found: { name: string; attrs: Record<string, string> } | null = null;
  try {
    scanXml(xml, {
      open(name, attrSource) {
        found = { name, attrs: parseAttrs(attrSource) };
        return false;
      },
    });
  } catch {
    return null;
  }
  return found;
}

function prefixOf(root: { attrs: Record<string, string> } | null, namespaces: string[], fallback: string): string {
  for (const ns of namespaces) {
    const p = root ? prefixFor(root.attrs, ns) : null;
    if (p) return p;
  }
  return fallback;
}

/** Where mammoth looks for a part: the first existing target of the relationship type, else a fixed path. */
function findPart(zip: ZipArchive, rels: ReturnType<typeof parseRels>, type: string, baseDir: string, fallback: string): string {
  for (const r of rels) {
    if (r.external || r.type !== REL_TYPE + type) continue;
    const path = r.target.startsWith('/') ? r.target.replace(/^\/+/, '') : resolvePart(baseDir, r.target);
    if (zip.has(path)) return path;
  }
  return fallback;
}

// ---------------------------------------------------------------------------------------------------------------
// Cutting oversized parts at a safe boundary

/**
 * Cuts an oversized WordprocessingML main part after the last complete top-level body block (paragraph, table,
 * content control, ...) that fits in `budget` characters, then closes the body. When no whole block fits (the body is
 * one content control or a layout table), it cuts after the last complete paragraph and closes every open element.
 * Null when no cut is needed or possible.
 */
export function truncateDocxXml(xml: string, budget: number): string | null {
  if (xml.length <= budget) return null;
  const stack: string[] = [];
  let bodyDepth = -1;
  let lastCut = -1;
  let closers = '';
  let paraCut = -1;
  let paraClosers = '';
  const local = (name: string) => name.slice(name.indexOf(':') + 1);
  const closeAll = () =>
    stack
      .slice()
      .reverse()
      .map((n) => `</${n}>`)
      .join('');
  try {
    scanXml(xml, {
      open(name, _attrs, selfClosing, _start, end) {
        if (end > budget) return false;
        const inBody = bodyDepth >= 0;
        if (inBody && stack.length === bodyDepth + 1 && selfClosing && local(name) !== 'sectPr') {
          [lastCut, closers] = [end, closeAll()];
        }
        if (selfClosing) return;
        stack.push(name);
        if (!inBody && local(name) === 'body' && stack.length === 2) bodyDepth = 1;
      },
      close(name, _start, end) {
        if (end > budget) return false;
        stack.pop();
        if (bodyDepth < 0) return;
        if (stack.length === bodyDepth) return false; // </w:body>
        const depthBelowBody = stack.length - bodyDepth - 1;
        if (depthBelowBody === 0) [lastCut, closers] = [end, closeAll()];
        // inside a top-level table a finished row is also a safe cut point (the table gets closed)
        else if (depthBelowBody === 1 && local(name) === 'tr' && local(stack[stack.length - 1]!) === 'tbl') [lastCut, closers] = [end, closeAll()];
        if (local(name) === 'p') [paraCut, paraClosers] = [end, closeAll()];
      },
    });
  } catch {
    return null;
  }
  if (lastCut < 0 && paraCut > 0) [lastCut, closers] = [paraCut, paraClosers];
  if (lastCut < 0) return null;
  return xml.slice(0, lastCut) + closers;
}

/** Cuts a notes part (footnotes/endnotes) after the last whole note that fits; null when none does. */
function truncateAtChild(xml: string, budget: number): string | null {
  const stack: string[] = [];
  let cut = -1;
  let rootName = '';
  try {
    scanXml(xml, {
      open(name, _attrs, selfClosing, _start, end) {
        if (end > budget) return false;
        if (!stack.length) rootName = name;
        if (stack.length === 1 && selfClosing) cut = end;
        if (!selfClosing) stack.push(name);
      },
      close(_name, _start, end) {
        if (end > budget) return false;
        stack.pop();
        if (stack.length === 1) cut = end;
      },
    });
  } catch {
    return null;
  }
  return cut > 0 && rootName ? `${xml.slice(0, cut)}</${rootName}>` : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Dangling references

/** Removes relationship attributes (r:id, r:embed, r:link, ...) that point to no relationship; mammoth crashes on them. */
function stripDanglingRelIds(xml: string, relIds: Set<string>): string {
  const root = rootTag(xml);
  let out = xml;
  for (const ns of REL_NAMESPACES) {
    const p = root ? prefixFor(root.attrs, ns) : null;
    if (!p) continue;
    const re = new RegExp(`\\s${esc(p)}:(?:embed|link|id|pict|dm|lo|qs|cs)="([^"]*)"`, 'g');
    out = out.replace(re, (m, id: string) => (relIds.has(id) ? m : ''));
  }
  return out;
}

function noteIds(xml: string | undefined, kind: 'footnote' | 'endnote'): Set<string> {
  const ids = new Set<string>();
  if (!xml) return ids;
  const w = esc(prefixOf(rootTag(xml), WORD_NAMESPACES, 'w'));
  for (const m of xml.matchAll(new RegExp(`<${w}:${kind}\\b[^<>]*?\\s${w}:id="(-?\\d+)"`, 'g'))) ids.add(m[1]!);
  return ids;
}

/** Removes footnote/endnote references whose note does not exist (mammoth crashes on them). */
function stripDanglingNoteRefs(xml: string, prefix: string, footnotes: Set<string>, endnotes: Set<string>): string {
  const w = esc(prefix);
  const re = new RegExp(`<${w}:(footnoteReference|endnoteReference)\\b[^<>]*?\\s${w}:id="(-?\\d+)"[^<>]*?\\/>`, 'g');
  return xml.replace(re, (m, kind: string, id: string) => ((kind === 'footnoteReference' ? footnotes : endnotes).has(id) ? m : ''));
}

// ---------------------------------------------------------------------------------------------------------------
// Numbering

interface Level {
  start: number;
  fmt: string;
  text: string;
  pStyle?: string;
}

interface NumberingDefs {
  abstracts: Map<string, Array<Level | undefined>>;
  nums: Map<string, { abstractId: string; starts: Map<number, number>; levels: Map<number, Level> }>;
}

interface StyleDef {
  name: string;
  basedOn?: string;
  numId?: string;
  ilvl?: number;
}

const valOf = (el: { attrs: Record<string, string> } | null | undefined) => el?.attrs.val;

function readLevel(lvl: XmlElement): Level {
  const start = Number(valOf(kid(lvl, 'start')) ?? 1);
  return {
    start: Number.isFinite(start) ? start : 1,
    fmt: valOf(kid(lvl, 'numFmt')) ?? 'decimal',
    text: valOf(kid(lvl, 'lvlText')) ?? '',
    pStyle: valOf(kid(lvl, 'pStyle')),
  };
}

function readNumbering(xml: string): NumberingDefs {
  const root = parseXml(xml);
  const abstracts = new Map<string, Array<Level | undefined>>();
  for (const an of kids(root, 'abstractNum')) {
    const levels: Array<Level | undefined> = [];
    for (const lvl of kids(an, 'lvl')) {
      const i = Number(lvl.attrs.ilvl ?? 0);
      if (i >= 0 && i <= 8) levels[i] = readLevel(lvl);
    }
    abstracts.set(an.attrs.abstractNumId ?? '', levels);
  }
  const nums: NumberingDefs['nums'] = new Map();
  for (const num of kids(root, 'num')) {
    const starts = new Map<number, number>();
    const levels = new Map<number, Level>();
    for (const o of kids(num, 'lvlOverride')) {
      const i = Number(o.attrs.ilvl ?? 0);
      const start = Number(valOf(kid(o, 'startOverride')));
      if (Number.isFinite(start)) starts.set(i, start);
      const lvl = kid(o, 'lvl');
      if (lvl) levels.set(i, readLevel(lvl));
    }
    nums.set(num.attrs.numId ?? '', { abstractId: valOf(kid(num, 'abstractNumId')) ?? '', starts, levels });
  }
  return { abstracts, nums };
}

function readStyles(xml: string): Map<string, StyleDef> {
  const styles = new Map<string, StyleDef>();
  for (const st of kids(parseXml(xml), 'style')) {
    if ((st.attrs.type ?? 'paragraph') !== 'paragraph') continue;
    const numPr = kid(kid(st, 'pPr'), 'numPr');
    const ilvl = valOf(kid(numPr, 'ilvl'));
    styles.set(st.attrs.styleId ?? '', {
      name: valOf(kid(st, 'name')) ?? '',
      basedOn: valOf(kid(st, 'basedOn')),
      numId: valOf(kid(numPr, 'numId')),
      ilvl: ilvl === undefined ? undefined : Number(ilvl),
    });
  }
  return styles;
}

function roman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  const table: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  for (const [v, s] of table) while (n >= v) [out, n] = [out + s, n - v];
  return out;
}

/** Word's letter numbering: A..Z, then AA..ZZ, AAA... */
const letters = (n: number) => (n <= 0 ? String(n) : String.fromCharCode(65 + ((n - 1) % 26)).repeat(Math.floor((n - 1) / 26) + 1));

function formatNumber(n: number, fmt: string): string {
  switch (fmt) {
    case 'none':
      return '';
    case 'decimalZero':
      return n >= 0 && n < 10 ? `0${n}` : String(n);
    case 'upperRoman':
      return roman(n);
    case 'lowerRoman':
      return roman(n).toLowerCase();
    case 'upperLetter':
      return letters(n);
    case 'lowerLetter':
      return letters(n).toLowerCase();
    default:
      return String(n);
  }
}

const isHeadingStyle = (id: string | undefined, name: string | undefined) =>
  /^(heading\s*[1-9]|title)$/i.test(name ?? '') || /^(heading[1-9]|title)$/i.test(id ?? '');

const escapeXmlText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Inserts each numbered paragraph's label as text: visible for headings ("2.1 Ruang Lingkup"), wrapped in LIST_MARK
 * for list items so the converter can number the item as Word does (continuing across interruptions).
 */
function addNumberLabels(xml: string, numbering: NumberingDefs, styles: Map<string, StyleDef>): string {
  const w = prefixOf(rootTag(xml), WORD_NAMESPACES, 'w');
  const P = `${w}:p`;
  const PPR = `${w}:pPr`;
  const NUMPR = `${w}:numPr`;
  const counters = new Map<string, Array<number | undefined>>();
  const overrides = new Map<string, number>();
  const seenNums = new Set<string>();
  const inserts: Array<[number, string]> = [];
  const names: string[] = [];
  interface Para {
    insertAt: number;
    style?: string;
    numId?: string;
    ilvl?: number;
  }
  const paras: Para[] = [];

  const label = (para: Para): string | null => {
    let numId = para.numId;
    let ilvl = para.ilvl;
    if (numId === undefined) {
      for (let s = para.style, i = 0; s && i < 10; i++) {
        const st = styles.get(s);
        if (!st) break;
        if (st.numId !== undefined) {
          numId = st.numId;
          if (ilvl === undefined) ilvl = st.ilvl;
          break;
        }
        s = st.basedOn;
      }
    }
    if (!numId || numId === '0') return null;
    const num = numbering.nums.get(numId);
    const levels = num ? numbering.abstracts.get(num.abstractId) : undefined;
    if (!num || !levels) return null;
    if (ilvl === undefined) {
      const linked = levels.findIndex((l) => l?.pStyle !== undefined && l.pStyle === para.style);
      ilvl = linked >= 0 ? linked : 0;
    }
    ilvl = Math.max(0, Math.min(8, ilvl || 0));
    const abs = num.abstractId;
    const levelAt = (k: number) => num.levels.get(k) ?? levels[k];
    const c = counters.get(abs) ?? [];
    counters.set(abs, c);
    if (!seenNums.has(numId)) {
      seenNums.add(numId);
      for (const [k, start] of num.starts) {
        overrides.set(`${abs}:${k}`, start);
        c[k] = undefined;
      }
    }
    const startOf = (k: number) => overrides.get(`${abs}:${k}`) ?? levelAt(k)?.start ?? 1;
    c[ilvl] = c[ilvl] === undefined ? startOf(ilvl) : c[ilvl]! + 1;
    for (let k = ilvl + 1; k < 9; k++) c[k] = undefined;
    const level = levelAt(ilvl);
    if (!level || level.fmt === 'bullet' || !level.text) return null;
    const text = level.text.replace(/%([1-9])/g, (_m, d: string) => {
      const k = Number(d) - 1;
      return formatNumber(c[k] ?? startOf(k), levelAt(k)?.fmt ?? 'decimal');
    });
    return text.trim() || null;
  };

  scanXml(xml, {
    open(name, attrSource, selfClosing, _start, end) {
      const para = paras[paras.length - 1];
      const parent = names[names.length - 1];
      if (name === P && !selfClosing) paras.push({ insertAt: end });
      else if (para && parent === PPR && names[names.length - 2] === P && name === `${w}:pStyle`) para.style = parseAttrs(attrSource).val;
      else if (para && parent === NUMPR && names[names.length - 2] === PPR && names[names.length - 3] === P) {
        if (name === `${w}:numId`) para.numId = parseAttrs(attrSource).val;
        else if (name === `${w}:ilvl`) para.ilvl = Number(parseAttrs(attrSource).val ?? 0);
      }
      if (!selfClosing) names.push(name);
    },
    close(name, _start, end) {
      names.pop();
      const para = paras[paras.length - 1];
      if (!para) return;
      if (name === PPR && names[names.length - 1] === P) para.insertAt = end;
      else if (name === P) {
        paras.pop();
        const text = label(para);
        if (!text) return;
        const style = para.style ? styles.get(para.style) : undefined;
        const shown = isHeadingStyle(para.style, style?.name) ? `${text} ` : `${LIST_MARK}${text}${LIST_MARK}`;
        inserts.push([para.insertAt, `<${w}:r><${w}:t xml:space="preserve">${escapeXmlText(shown)}</${w}:t></${w}:r>`]);
      }
    },
  });
  if (!inserts.length) return xml;
  inserts.sort((a, b) => a[0] - b[0]);
  let out = '';
  let pos = 0;
  for (const [at, text] of inserts) {
    out += xml.slice(pos, at) + text;
    pos = at;
  }
  return out + xml.slice(pos);
}

// ---------------------------------------------------------------------------------------------------------------

export function prepareDocx(zip: ZipArchive, options: { limits: Limits; deadline: Deadline; maxChars: number; warnings: string[] }): PreparedDocx {
  const { limits, deadline, maxChars, warnings } = options;
  const texts = new Map<string, string>();
  const hidden = new Set<string>();

  // the parts mammoth will read, found the same way mammoth finds them
  const mainPart = findPart(zip, parseRels(zip.text('_rels/.rels', 4 * MB)), 'officeDocument', '', 'word/document.xml');
  if (!zip.has(mainPart)) throw documentError('CORRUPT', 'File rusak atau bukan dokumen Word yang valid (bagian utama dokumen tidak ditemukan).');
  // an oversized relationship list (tens of thousands of hyperlinks) is left out: links and images then read as text
  const relsPath = relsPathOf(mainPart);
  const relsEntry = zip.get(relsPath);
  let mainRels: ReturnType<typeof parseRels> = [];
  if (relsEntry && relsEntry.usize > limits.maxDocxXmlBytes) {
    hidden.add(normPath(relsPath));
    warnings.push(`Daftar tautan dan gambar dokumen terlalu besar (${fmtMB(relsEntry.usize)}); tautan dibaca sebagai teks biasa.`);
  } else {
    mainRels = parseRels(zip.text(relsPath, limits.maxDocxXmlBytes));
  }
  const related = (type: string) => findPart(zip, mainRels, type, dirOf(mainPart), `word/${type}.xml`);
  hidden.add(normPath(related('comments')));

  let sideTotal = 0;
  const read = (path: string): string | null => (zip.has(path) ? zip.text(path, limits.maxEntryBytes) : null);

  // styles and numbering: optional for mammoth; skipped when unreasonably large
  const side: Record<'styles' | 'numbering', string | undefined> = { styles: undefined, numbering: undefined };
  for (const type of ['styles', 'numbering'] as const) {
    deadline.check();
    const path = related(type);
    const entry = zip.get(path);
    if (!entry) continue;
    if (entry.usize > MAX_SIDE_PART) {
      hidden.add(normPath(path));
      warnings.push(`Bagian ${type === 'styles' ? 'gaya' : 'penomoran'} dokumen terlalu besar (${fmtMB(entry.usize)}) dan dilewati.`);
      continue;
    }
    const text = zip.text(path, MAX_SIDE_PART);
    if (text === null) continue;
    checkPart(text, path);
    texts.set(normPath(path), text);
    side[type] = text;
    sideTotal += text.length;
  }

  // footnotes and endnotes: cut after the last whole note within their budget
  const notes: Record<'footnotes' | 'endnotes', string | undefined> = { footnotes: undefined, endnotes: undefined };
  for (const type of ['footnotes', 'endnotes'] as const) {
    deadline.check();
    const path = related(type);
    let text = read(path);
    if (text === null) continue;
    if (text.length > MAX_NOTES_PART) {
      const cut = truncateAtChild(text, MAX_NOTES_PART);
      warnings.push(`${type === 'footnotes' ? 'Catatan kaki' : 'Catatan akhir'} dokumen sangat panjang; hanya ${fmtMB(cut?.length ?? 0)} pertama yang dibaca.`);
      if (!cut) {
        hidden.add(normPath(path));
        continue;
      }
      text = cut;
    }
    checkPart(text, path);
    const relIds = new Set(parseRels(zip.text(relsPathOf(path), limits.maxDocxXmlBytes)).map((r) => r.id));
    text = stripDanglingRelIds(text, relIds);
    texts.set(normPath(path), text);
    notes[type] = text;
    sideTotal += text.length;
  }

  // the main part: cut to what mammoth can afford, then cleaned and numbered
  deadline.check();
  let main = zip.text(mainPart, limits.maxEntryBytes)!;
  const budget = Math.max(1 * MB, Math.min(limits.maxDocxXmlBytes, maxChars * 3, limits.maxDocxXmlBytes * TOTAL_XML_FACTOR - sideTotal));
  if (main.length > budget) {
    const cut = truncateDocxXml(main, budget);
    if (!cut) {
      throw documentError('TOO_LARGE', `Dokumen terlalu besar (${fmtMB(main.length)} isi XML) dan tidak bisa dipotong dengan aman. Pecah dokumen menjadi beberapa file.`);
    }
    warnings.push(`Dokumen dipotong: hanya ${fmtMB(cut.length)} pertama dari ${fmtMB(main.length)} isi dokumen (~${Math.round((cut.length / main.length) * 100)}%) yang dibaca.`);
    main = cut;
  }
  checkPart(main, mainPart);
  deadline.check();
  main = stripDanglingRelIds(main, new Set(mainRels.map((r) => r.id)));
  const w = prefixOf(rootTag(main), WORD_NAMESPACES, 'w');
  main = stripDanglingNoteRefs(main, w, noteIds(notes.footnotes, 'footnote'), noteIds(notes.endnotes, 'endnote'));
  if (side.numbering) {
    try {
      main = addNumberLabels(main, readNumbering(side.numbering), side.styles ? readStyles(side.styles) : new Map());
    } catch {
      // numbering labels are a nicety; mammoth still renders the lists
    }
  }
  texts.set(normPath(mainPart), main);
  return { mainPart, texts, hidden };
}
