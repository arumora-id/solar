import { DEFAULT_LANG, fmtInt, t, type Lang } from '../i18n.js';
import { detectKind, extensionOf } from './kind.js';
import { LIMITS, makeDeadline, withTimeout } from './limits.js';
import { isOle, oleError } from './ole.js';
import { truncate, wellFormed } from './safe.js';
import { csvToMarkdown, decodeText, normalizeNewlines, parseCsvLimited } from './text.js';
import { DocumentError, documentError, type ExtractedDocument, type ExtractOptions, type ParseContext, type ParsedDocument } from './types.js';
import { classifyOoxml, ZipArchive } from './zip.js';

export { detectKind, extensionOf } from './kind.js';
export { DocumentError, type ExtractedDocument, type ExtractOptions, type SheetTable } from './types.js';

export const DEFAULT_MAX_CHARS = 2_000_000;
export const DEFAULT_TIMEOUT_MS = 90_000;

function titleOf(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  return base || fileName;
}

const OFFICE_LABEL = {
  docx: 'doc.label.docx',
  xlsx: 'doc.label.xlsx',
  xlsm: 'doc.label.xlsx',
  pptx: 'doc.label.pptx',
} as const;

/** "Word document (.docx)", or null for an extension that is not an Office format. */
function officeLabel(ext: string, lang: Lang): string | null {
  const key = OFFICE_LABEL[ext as keyof typeof OFFICE_LABEL];
  return key ? t(lang, 'doc.label.withExtension', { label: t(lang, key), ext }) : null;
}

const OFFICE_EXPECTED: Record<string, 'docx' | 'xlsx' | 'pptx'> = { docx: 'docx', xlsx: 'xlsx', xlsm: 'xlsx', pptx: 'pptx' };

const KIND_LABEL: Record<string, string> = { pdf: 'PDF', docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint' };

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5 || bytes[2] === 7);
}

function isPdf(bytes: Uint8Array, ext: string): boolean {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // some producers put junk before the header; only trust that for files that claim to be PDFs
  if (buf.subarray(0, ext === 'pdf' ? 1024 : 5).indexOf('%PDF-') < 0) return false;
  // a text note may start with "%PDF-"; with another extension the file must also contain PDF objects
  return ext === 'pdf' || /\d+\s+\d+\s+obj\b/.test(buf.subarray(0, 65_536).toString('latin1'));
}

/** Picks the parser from the file's content (not only its extension), so renamed or mislabelled files are handled. */
async function dispatch(ctx: ParseContext): Promise<ParsedDocument> {
  const { bytes, ext, warnings, lang } = ctx;
  const mismatch = (actual: string) => warnings.push(t(lang, 'doc.extensionMismatch', { ext, kind: KIND_LABEL[actual] ?? actual }));
  const label = officeLabel(ext, lang);

  if (isPdf(bytes, ext)) {
    if (ext !== 'pdf') mismatch('pdf');
    return (await import('./pdf.js')).extractPdf(ctx);
  }
  if (isOle(bytes)) throw oleError(bytes, ext, lang);
  if (isZip(bytes)) {
    const zip = new ZipArchive(bytes, ctx.limits, ctx.deadline, label ?? t(lang, 'doc.label.file', { ext }), lang);
    const pkg = classifyOoxml(zip);
    if (pkg.unsupported) throw documentError('UNSUPPORTED', t(lang, 'doc.unsupportedPackage', { reason: pkg.unsupported }));
    if (!pkg.kind) {
      if (label) throw documentError('CORRUPT', t(lang, 'doc.corrupt', { label, detail: t(lang, 'doc.corrupt.mainPartMissing') }));
      throw documentError('UNSUPPORTED', t(lang, 'doc.zipNotDocument', { ext }));
    }
    if (OFFICE_EXPECTED[ext] !== pkg.kind) mismatch(pkg.kind);
    if (pkg.kind === 'docx') return (await import('./docx.js')).extractDocx(ctx, zip, pkg);
    if (pkg.kind === 'xlsx') return (await import('./xlsx.js')).extractXlsx(ctx, zip, pkg);
    return (await import('./pptx.js')).extractPptx(ctx, zip, pkg);
  }

  const { kind } = detectKind(ctx.fileName, lang);
  switch (kind) {
    case 'pdf':
      throw documentError('CORRUPT', t(lang, 'doc.pdfHeaderMissing'));
    case 'docx':
    case 'xlsx':
    case 'pptx':
      throw documentError('CORRUPT', t(lang, 'doc.corrupt', { label: label ?? kind, detail: t(lang, 'doc.corrupt.notOfficePackage') }));
    case 'markdown':
    case 'text':
      return { kind, markdown: decodeText(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), lang), parts: null };
    case 'csv': {
      const text = decodeText(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), lang);
      const { markdown, warnings: csvWarnings } = csvToMarkdown(text, titleOf(ctx.fileName), lang);
      warnings.push(...csvWarnings);
      if (!ctx.collectTables) return { kind, markdown, parts: null };
      const parsed = parseCsvLimited(text, ctx.limits.maxRowsPerSheet);
      return { kind, markdown, parts: null, tables: [{ name: titleOf(ctx.fileName), rows: parsed.rows, truncated: parsed.truncated }] };
    }
  }
}

/**
 * Turns an uploaded document into Markdown the agent can read.
 * Throws DocumentError (user-facing message, in `options.lang`) for unsupported, corrupt, encrypted or oversized input.
 */
export async function extractDocument(buffer: Buffer, fileName: string, options: ExtractOptions = {}): Promise<ExtractedDocument> {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const lang = options.lang ?? DEFAULT_LANG;
  detectKind(fileName, lang); // rejects unsupported extensions before looking at the content
  if (buffer.length === 0) throw documentError('EMPTY', t(lang, 'doc.empty'));

  const ctx: ParseContext = {
    bytes: buffer,
    ext: extensionOf(fileName).slice(1),
    fileName,
    // table import (knowledge base): more rows per sheet; the markdown is still capped by maxChars
    limits: options.tableRows ? { ...LIMITS, maxRowsPerSheet: options.tableRows } : LIMITS,
    deadline: makeDeadline(timeoutMs, lang),
    maxChars,
    warnings: [],
    collectTables: Boolean(options.tableRows),
    lang,
  };
  let result: ParsedDocument;
  try {
    result = await withTimeout(dispatch(ctx), ctx.deadline);
  } catch (err) {
    if (err instanceof DocumentError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw documentError('CORRUPT', t(lang, 'doc.unreadable', { file: fileName, error: message.slice(0, 300) }));
  }

  let markdown = wellFormed(normalizeNewlines(result.markdown).replace(/\n{4,}/g, '\n\n\n').trim());
  const warnings = ctx.warnings.map(wellFormed);
  if (markdown.length > maxChars) {
    markdown = `${truncate(markdown, maxChars)}\n\n${t(lang, 'doc.textCut', { n: fmtInt(maxChars, lang) })}`;
    warnings.push(t(lang, 'doc.veryLong', { n: fmtInt(maxChars, lang) }));
  }
  if (!markdown.replace(/[#\s|\-:<>!\[\]()*_`]/g, '')) warnings.push(t(lang, result.kind === 'pdf' ? 'doc.noTextPdf' : 'doc.noText'));
  return { kind: result.kind, markdown, parts: result.parts, warnings: [...new Set(warnings)], ...(result.tables ? { tables: result.tables } : {}) };
}

/** First headings of a Markdown text, for orientation (UI chips, agent document list). */
export function outlineOf(markdown: string, max = 25): string[] {
  const out: string[] = [];
  for (const line of markdown.split('\n')) {
    const m = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    out.push(`${'  '.repeat(m[1]!.length - 1)}${truncate(m[2]!, 120)}`);
    if (out.length >= max) break;
  }
  return out;
}
