import { detectKind, extensionOf } from './kind.js';
import { LIMITS, makeDeadline, withTimeout } from './limits.js';
import { isOle, oleError } from './ole.js';
import { truncate, wellFormed } from './safe.js';
import { csvToMarkdown, decodeText, normalizeNewlines } from './text.js';
import { DocumentError, documentError, type ExtractedDocument, type ExtractOptions, type ParseContext, type ParsedDocument } from './types.js';
import { classifyOoxml, ZipArchive } from './zip.js';

export { detectKind, extensionOf } from './kind.js';
export { DocumentError, type ExtractedDocument, type ExtractOptions } from './types.js';

export const DEFAULT_MAX_CHARS = 2_000_000;
export const DEFAULT_TIMEOUT_MS = 90_000;

function titleOf(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  return base || fileName;
}

const OFFICE_LABEL: Record<string, string> = {
  docx: 'dokumen Word (.docx)',
  xlsx: 'workbook Excel (.xlsx)',
  xlsm: 'workbook Excel (.xlsm)',
  pptx: 'presentasi PowerPoint (.pptx)',
};

const OFFICE_EXPECTED: Record<string, 'docx' | 'xlsx' | 'pptx'> = { docx: 'docx', xlsx: 'xlsx', xlsm: 'xlsx', pptx: 'pptx' };

const KIND_LABEL: Record<string, string> = { pdf: 'PDF', docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint' };

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5 || bytes[2] === 7);
}

function isPdf(bytes: Uint8Array, ext: string): boolean {
  // some producers put junk before the header; only trust that for files that claim to be PDFs
  const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.length, ext === 'pdf' ? 1024 : 5));
  return head.indexOf('%PDF-') >= 0;
}

/** Picks the parser from the file's content (not only its extension), so renamed or mislabelled files are handled. */
async function dispatch(ctx: ParseContext): Promise<ParsedDocument> {
  const { bytes, ext, warnings } = ctx;
  const mismatch = (actual: string) => warnings.push(`Ekstensi .${ext} tidak sesuai isinya (${KIND_LABEL[actual] ?? actual}); file dibaca sebagai ${KIND_LABEL[actual] ?? actual}.`);

  if (isPdf(bytes, ext)) {
    if (ext !== 'pdf') mismatch('pdf');
    return (await import('./pdf.js')).extractPdf(ctx);
  }
  if (isOle(bytes)) throw oleError(bytes, ext);
  if (isZip(bytes)) {
    const zip = new ZipArchive(bytes, ctx.limits, ctx.deadline, OFFICE_LABEL[ext] ?? `file .${ext}`);
    const pkg = classifyOoxml(zip);
    if (pkg.unsupported) throw documentError('UNSUPPORTED', `Jenis file tidak didukung: ${pkg.unsupported}.`);
    if (!pkg.kind) {
      if (OFFICE_LABEL[ext]) throw documentError('CORRUPT', `File rusak atau bukan ${OFFICE_LABEL[ext]} yang valid (bagian utama dokumen tidak ditemukan).`);
      throw documentError('UNSUPPORTED', `File .${ext} ini ternyata arsip ZIP, bukan dokumen yang didukung.`);
    }
    if (OFFICE_EXPECTED[ext] !== pkg.kind) mismatch(pkg.kind);
    if (pkg.kind === 'docx') return (await import('./docx.js')).extractDocx(ctx, zip, pkg);
    if (pkg.kind === 'xlsx') return (await import('./xlsx.js')).extractXlsx(ctx, zip, pkg);
    return (await import('./pptx.js')).extractPptx(ctx, zip, pkg);
  }

  const { kind } = detectKind(ctx.fileName);
  switch (kind) {
    case 'pdf':
      throw documentError('CORRUPT', 'File rusak atau bukan PDF yang valid (header %PDF tidak ditemukan).');
    case 'docx':
    case 'xlsx':
    case 'pptx':
      throw documentError('CORRUPT', `File rusak atau bukan ${OFFICE_LABEL[ext] ?? kind} yang valid (bukan paket Office/ZIP).`);
    case 'markdown':
    case 'text':
      return { kind, markdown: decodeText(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)), parts: null };
    case 'csv': {
      const { markdown, warnings: csvWarnings } = csvToMarkdown(decodeText(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)), titleOf(ctx.fileName));
      warnings.push(...csvWarnings);
      return { kind, markdown, parts: null };
    }
  }
}

/**
 * Turns an uploaded document into Markdown the agent can read.
 * Throws DocumentError (user-facing message) for unsupported, corrupt, encrypted or oversized input.
 */
export async function extractDocument(buffer: Buffer, fileName: string, options: ExtractOptions = {}): Promise<ExtractedDocument> {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  detectKind(fileName); // rejects unsupported extensions before looking at the content
  if (buffer.length === 0) throw documentError('EMPTY', 'File kosong (0 byte).');

  const ctx: ParseContext = {
    bytes: buffer,
    ext: extensionOf(fileName).slice(1),
    fileName,
    limits: LIMITS,
    deadline: makeDeadline(timeoutMs),
    maxChars,
    warnings: [],
  };
  let result: ParsedDocument;
  try {
    result = await withTimeout(dispatch(ctx), ctx.deadline);
  } catch (err) {
    if (err instanceof DocumentError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw documentError('CORRUPT', `"${fileName}" tidak bisa dibaca (file rusak atau memakai fitur yang belum didukung): ${message.slice(0, 300)}`);
  }

  let markdown = wellFormed(normalizeNewlines(result.markdown).replace(/\n{4,}/g, '\n\n\n').trim());
  const warnings = ctx.warnings.map(wellFormed);
  if (markdown.length > maxChars) {
    markdown = `${truncate(markdown, maxChars)}\n\n[SOLAR: teks dipotong pada ${maxChars.toLocaleString('id-ID')} karakter]`;
    warnings.push(`Dokumen sangat panjang; hanya ${maxChars.toLocaleString('id-ID')} karakter pertama yang disimpan.`);
  }
  if (!markdown.replace(/[#\s|\-:<>!\[\]()*_`]/g, '')) {
    warnings.push(
      result.kind === 'pdf'
        ? 'Tidak ada teks yang bisa dibaca (PDF hasil scan/gambar?). Gunakan PDF dengan teks atau sertakan versi Word.'
        : 'Dokumen tidak berisi teks.',
    );
  }
  return { kind: result.kind, markdown, parts: result.parts, warnings: [...new Set(warnings)] };
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
