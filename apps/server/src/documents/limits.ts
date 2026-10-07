import { documentError } from './types.js';

export const MB = 1024 * 1024;

/** Safety limits for parsing untrusted documents. */
export const LIMITS = Object.freeze({
  /** One fully materialised ZIP part (document.xml, a slide, styles, ...). */
  maxEntryBytes: 64 * MB,
  /** All bytes inflated from one file, streamed parts included. */
  maxTotalInflatedBytes: 256 * MB,
  maxEntries: 10_000,
  /** Reported as a possible zip bomb above this ratio (for parts larger than 1 MB). */
  maxCompressionRatio: 200,
  /** document.xml handed to mammoth (it needs ~100-150 MB of memory per MB); longer documents are cut at a block. */
  maxDocxXmlBytes: 4 * MB,
  /** mammoth HTML handed to turndown. */
  maxDocxHtmlChars: 12_000_000,
  maxPages: 2000,
  maxSlides: 1000,
  maxSheets: 50,
  maxRowsPerSheet: 1000,
  maxColsPerSheet: 50,
  maxCellChars: 2000,
});

export type Limits = typeof LIMITS;

export const fmtInt = (n: number) => Number(n).toLocaleString('id-ID');
export const fmtMB = (n: number) => `${(n / MB).toFixed(n >= 10 * MB ? 0 : 1)} MB`;
const fmtSecs = (ms: number) => (ms >= 1000 ? `${Math.round(ms / 1000)} detik` : `${ms} ms`);

export interface Deadline {
  readonly timeoutMs: number;
  remaining(): number;
  /** Throws a TIMEOUT error once the time is up (called between parsing steps). */
  check(): void;
}

const timeoutError = (timeoutMs: number) =>
  documentError('TIMEOUT', `Membaca dokumen melebihi batas waktu ${fmtSecs(timeoutMs)}; dokumen terlalu besar atau terlalu rumit. Pecah menjadi beberapa file.`);

export function makeDeadline(timeoutMs: number): Deadline {
  const end = Date.now() + timeoutMs;
  return {
    timeoutMs,
    remaining: () => end - Date.now(),
    check() {
      if (Date.now() > end) throw timeoutError(timeoutMs);
    },
  };
}

/** Rejects with a TIMEOUT error when the promise does not settle before the deadline. */
export function withTimeout<T>(promise: Promise<T>, deadline: Deadline): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timeoutError(deadline.timeoutMs)), Math.max(1, deadline.remaining()));
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Escapes and flattens a value for a Markdown table cell. */
export function mdCell(value: unknown, maxCellChars?: number): string {
  let t = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (maxCellChars && t.length > maxCellChars) t = `${t.slice(0, maxCellChars)}…`;
  return t.replace(/\|/g, '\\|').replace(/\n+/g, '<br>');
}

/** Rows of already escaped cells as a GitHub Markdown table; the first row is the header. */
export function mdTable(rows: string[][]): string {
  if (!rows.length) return '';
  const width = Math.max(1, ...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
  const out = [line(rows[0]!), `| ${Array(width).fill('---').join(' | ')} |`];
  for (let i = 1; i < rows.length; i++) out.push(line(rows[i]!));
  return out.join('\n');
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(s: string | null | undefined): string {
  if (!s || s.indexOf('&') < 0) return s || '';
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
    if (e[0] !== '#') return XML_ENTITIES[e]!;
    const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
  });
}

/** OOXML escapes control characters as _xHHHH_ inside strings. */
export function decodeOoxmlText(s: string): string {
  let t = decodeXml(s);
  if (t.indexOf('_x') >= 0) t = t.replace(/_x([0-9A-Fa-f]{4})_/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
  return t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

/** Attributes of an XML start tag; prefixed names are also available without their prefix. */
export function parseAttrs(s: string | undefined): Record<string, string> {
  const o: Record<string, string> = {};
  if (!s) return o;
  for (const m of s.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const v = decodeXml(m[2] ?? m[3]);
    o[m[1]!] = v;
    const i = m[1]!.indexOf(':');
    if (i >= 0 && !(m[1]!.slice(i + 1) in o)) o[m[1]!.slice(i + 1)] = v;
  }
  return o;
}
