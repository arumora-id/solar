/** Text-based formats: Markdown, plain text and CSV. */
import { documentError } from './types.js';

// Windows-1252 differs from Latin-1 in 0x80-0x9F (curly quotes, dashes, €, ...). Node's TextDecoder('windows-1252')
// decodes that range as C1 control characters, so map it explicitly (undefined bytes stay as the replacement char).
const CP1252_HIGH = '€\uFFFD‚ƒ„…†‡ˆ‰Š‹Œ\uFFFDŽ\uFFFD\uFFFD‘’“”•–—˜™š›œ\uFFFDžŸ';

export function decodeWindows1252(buffer: Buffer): string {
  // latin1 maps bytes 1:1 to code points; only 0x80-0x9F need the Windows-1252 characters
  return buffer.toString('latin1').replace(/[\u0080-\u009f]/g, (c) => CP1252_HIGH[c.charCodeAt(0) - 0x80]!);
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

/** Detects BOM-less UTF-16 from the position of its NUL bytes (ASCII text in UTF-16 is half NULs). */
function utf16WithoutBom(probe: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const pairs = probe.length >> 1;
  // a few bytes with a stray NUL are not enough to tell
  if (pairs < 8) return null;
  let evenZero = 0;
  let oddZero = 0;
  for (let i = 0; i + 1 < probe.length; i += 2) {
    if (probe[i] === 0) evenZero += 1;
    if (probe[i + 1] === 0) oddZero += 1;
  }
  if (oddZero > pairs * 0.3 && evenZero < pairs * 0.02) return 'utf-16le';
  if (evenZero > pairs * 0.3 && oddZero < pairs * 0.02) return 'utf-16be';
  return null;
}

/**
 * Decodes text files: UTF-8 (with or without BOM), UTF-16 (with a BOM, or recognised without one), otherwise
 * Windows-1252 (e.g. an ANSI export from Excel).
 */
export function decodeText(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buffer.subarray(3));
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer.subarray(2));
  const probe = buffer.subarray(0, 65_536);
  const utf16 = utf16WithoutBom(probe);
  if (utf16) return new TextDecoder(utf16).decode(buffer);
  // many NUL bytes otherwise mean a binary file (an image, archive, ...) with a text extension; a stray one is
  // tolerated (and removed later)
  let nul = 0;
  for (const byte of probe) if (byte === 0) nul += 1;
  if (nul > Math.max(1, probe.length / 1000)) {
    throw documentError('UNSUPPORTED', 'File ini tampaknya file biner, bukan teks. Lampirkan PDF, Word, Excel, PowerPoint, Markdown, CSV atau teks biasa.');
  }
  try {
    return strictUtf8.decode(buffer);
  } catch {
    // mostly valid UTF-8 with a few stray legacy bytes stays UTF-8 (the stray bytes become U+FFFD); a file with
    // no real UTF-8 sequences is an ANSI (Windows-1252) export
    const lossy = new TextDecoder('utf-8').decode(buffer);
    const bad = (lossy.match(/\uFFFD/g) ?? []).length;
    const multi = (lossy.match(/[^\u0000-\u007F\uFFFD]/gu) ?? []).length;
    return multi > bad * 4 ? lossy : decodeWindows1252(buffer);
  }
}

export function normalizeNewlines(text: string): string {
  // NUL and other C0 controls (except tab/newline) only confuse the model
  return text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** Longest cell kept in a CSV table (the same as Excel/PowerPoint cells); longer values are cut and reported. */
export const MAX_CELL_CHARS = 2000;

/** Escapes a value for a Markdown table cell; `onCut` is called when the value had to be shortened. */
export function cell(value: string, maxLength = MAX_CELL_CHARS, onCut?: () => void): string {
  let v = value.replace(/\r\n?|\n/g, '<br>').replace(/\|/g, '\\|').trim();
  if (v.length > maxLength) {
    v = `${v.slice(0, maxLength - 1)}…`;
    onCut?.();
  }
  return v;
}

/** Renders rows as a GitHub-flavoured Markdown table (first row = header). */
export function markdownTable(rows: string[][], onCut?: () => void): string {
  if (rows.length === 0) return '';
  let width = 1;
  for (const r of rows) if (r.length > width) width = r.length;
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => cell(r[i] ?? '', MAX_CELL_CHARS, onCut));
  const [header, ...body] = rows;
  const lines = [`| ${pad(header!).map((h, i) => h || `Kolom ${i + 1}`).join(' | ')} |`, `| ${Array(width).fill('---').join(' | ')} |`];
  for (const r of body) lines.push(`| ${pad(r).join(' | ')} |`);
  return lines.join('\n');
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let n = 0;
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === delimiter && !quoted) n += 1;
  }
  return n;
}

/**
 * Picks the delimiter that splits the first lines most consistently (title or preamble lines without delimiters do
 * not count), honouring an Excel `sep=;` hint. Ties go to `;`, the delimiter of decimal-comma locales.
 */
function detectDelimiter(text: string): { delimiter: string; skip: number } {
  const hint = /^sep=([^"\r\n])\r?\n?/i.exec(text.slice(0, 8));
  if (hint) return { delimiter: hint[1]!, skip: hint[0].length };
  const lines = text
    .slice(0, 65_536)
    .split(/\r\n?|\n/)
    .filter((l) => l.trim())
    .slice(0, 20);
  let delimiter = ',';
  let bestScore = 0;
  for (const d of [';', '\t', ',', '|']) {
    const frequency = new Map<number, number>();
    for (const l of lines) {
      const n = countOutsideQuotes(l, d);
      if (n > 0) frequency.set(n, (frequency.get(n) ?? 0) + 1);
    }
    let score = 0;
    for (const [count, lineCount] of frequency) score = Math.max(score, lineCount * 1000 + count);
    if (score > bestScore) [bestScore, delimiter] = [score, d];
  }
  return { delimiter, skip: 0 };
}

/**
 * RFC 4180 CSV parser (quoted fields with delimiters, quotes and newlines; CRLF, LF or CR line ends). Detects `;`,
 * tab, `,` or `|`. Stops after `maxRows` non-empty rows (`truncated` tells whether data remained), so huge exports
 * stay cheap.
 */
export function parseCsvLimited(input: string, maxRows = Infinity): { rows: string[][]; truncated: boolean } {
  const { delimiter, skip } = detectDelimiter(input);
  const text = skip ? input.slice(skip) : input;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const endRow = () => {
    row.push(field);
    if (row.some((v) => v.trim() !== '')) rows.push(row);
    row = [];
    field = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      endRow();
      if (rows.length >= maxRows) return { rows, truncated: text.slice(i + 1).trim() !== '' };
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) endRow();
  return { rows: rows.slice(0, maxRows), truncated: rows.length > maxRows };
}

export function parseCsv(text: string): string[][] {
  return parseCsvLimited(text).rows;
}

export const MAX_TABLE_ROWS = 2000;
export const MAX_TABLE_COLUMNS = 60;

/** CSV → Markdown table, capped to a sane size for the model. */
export function csvToMarkdown(text: string, title: string): { markdown: string; warnings: string[] } {
  const warnings: string[] = [];
  const parsed = parseCsvLimited(text, MAX_TABLE_ROWS + 1);
  let rows = parsed.rows;
  if (rows.length === 0) return { markdown: `# ${title}\n\n_(file CSV kosong)_`, warnings: ['File CSV kosong.'] };
  if (parsed.truncated) warnings.push(`CSV berisi lebih dari ${MAX_TABLE_ROWS} baris data; hanya ${MAX_TABLE_ROWS} baris pertama yang dibaca.`);
  let width = 0;
  for (const r of rows) if (r.length > width) width = r.length;
  if (width > MAX_TABLE_COLUMNS) {
    warnings.push(`CSV berisi ${width} kolom; hanya ${MAX_TABLE_COLUMNS} kolom pertama yang dibaca.`);
    rows = rows.map((r) => r.slice(0, MAX_TABLE_COLUMNS));
  }
  let cut = 0;
  const onCut = () => (cut += 1);
  // leading single-cell lines (report title, export date) become captions above the table
  const captions: string[] = [];
  while (width > 1 && rows.length > 1 && rows[0]!.filter((v) => v.trim()).length === 1) {
    captions.push(`**${cell(rows[0]!.find((v) => v.trim())!, MAX_CELL_CHARS, onCut).replace(/\\\|/g, '|')}**`);
    rows = rows.slice(1);
  }
  const table = markdownTable(rows, onCut);
  if (cut) warnings.push(`${cut.toLocaleString('id-ID')} sel CSV berisi lebih dari ${MAX_CELL_CHARS.toLocaleString('id-ID')} karakter dan dipotong.`);
  return { markdown: [`# ${title}`, ...captions, table].join('\n\n'), warnings };
}
