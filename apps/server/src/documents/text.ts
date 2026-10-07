/** Text-based formats: Markdown, plain text and CSV. */

// Windows-1252 differs from Latin-1 in 0x80-0x9F (curly quotes, dashes, €, ...). Node's TextDecoder('windows-1252')
// decodes that range as C1 control characters, so map it explicitly (undefined bytes stay as the replacement char).
const CP1252_HIGH = '€\uFFFD‚ƒ„…†‡ˆ‰Š‹Œ\uFFFDŽ\uFFFD\uFFFD‘’“”•–—˜™š›œ\uFFFDžŸ';

export function decodeWindows1252(buffer: Buffer): string {
  let out = '';
  for (const byte of buffer) out += byte >= 0x80 && byte <= 0x9f ? CP1252_HIGH[byte - 0x80] : String.fromCharCode(byte);
  return out;
}

/** Decodes text files: UTF-8 (with or without BOM), UTF-16 with BOM, otherwise Windows-1252 when UTF-8 is clearly wrong. */
export function decodeText(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buffer.subarray(3));
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer.subarray(2));
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  const invalid = (utf8.match(/�/g) ?? []).length;
  // a few replacement characters can be genuine; many mean the file is not UTF-8 (e.g. an Excel CSV export on Windows)
  if (invalid > 0 && invalid > utf8.length / 200) return decodeWindows1252(buffer);
  return utf8;
}

export function normalizeNewlines(text: string): string {
  // NUL and other C0 controls (except tab/newline) only confuse the model
  return text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** Escapes a value for a Markdown table cell. */
export function cell(value: string, maxLength = 500): string {
  let v = value.replace(/\r\n?|\n/g, '<br>').replace(/\|/g, '\\|').trim();
  if (v.length > maxLength) v = `${v.slice(0, maxLength - 1)}…`;
  return v;
}

/** Renders rows as a GitHub-flavoured Markdown table (first row = header). */
export function markdownTable(rows: string[][]): string {
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => cell(r[i] ?? ''));
  const [header, ...body] = rows;
  const lines = [`| ${pad(header!).map((h, i) => h || `Kolom ${i + 1}`).join(' | ')} |`, `| ${Array(width).fill('---').join(' | ')} |`];
  for (const r of body) lines.push(`| ${pad(r).join(' | ')} |`);
  return lines.join('\n');
}

/** RFC 4180 CSV parser (quoted fields with delimiters, quotes and newlines). Detects `,`, `;` or tab. */
export function parseCsv(text: string): string[][] {
  const firstLine = text.slice(0, text.indexOf('\n') >= 0 ? text.indexOf('\n') : text.length);
  const count = (d: string) => {
    let n = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) n += 1;
    }
    return n;
  };
  const delimiter = [',', ';', '\t'].reduce((best, d) => (count(d) > count(best) ? d : best), ',');

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
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
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

export const MAX_TABLE_ROWS = 2000;
export const MAX_TABLE_COLUMNS = 60;

/** CSV → Markdown table, capped to a sane size for the model. */
export function csvToMarkdown(text: string, title: string): { markdown: string; warnings: string[] } {
  const warnings: string[] = [];
  let rows = parseCsv(text);
  if (rows.length === 0) return { markdown: `# ${title}\n\n_(file CSV kosong)_`, warnings: ['File CSV kosong.'] };
  if (rows.length > MAX_TABLE_ROWS + 1) {
    warnings.push(`CSV berisi ${rows.length - 1} baris data; hanya ${MAX_TABLE_ROWS} baris pertama yang dibaca.`);
    rows = rows.slice(0, MAX_TABLE_ROWS + 1);
  }
  const width = Math.max(...rows.map((r) => r.length));
  if (width > MAX_TABLE_COLUMNS) {
    warnings.push(`CSV berisi ${width} kolom; hanya ${MAX_TABLE_COLUMNS} kolom pertama yang dibaca.`);
    rows = rows.map((r) => r.slice(0, MAX_TABLE_COLUMNS));
  }
  return { markdown: `# ${title}\n\n${markdownTable(rows)}`, warnings };
}
