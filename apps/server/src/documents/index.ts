import { detectKind } from './kind.js';
import { truncate, wellFormed } from './safe.js';
import { csvToMarkdown, decodeText, normalizeNewlines } from './text.js';
import { DocumentError, type ExtractedDocument, type ExtractOptions } from './types.js';

export { detectKind, extensionOf } from './kind.js';
export { DocumentError, type ExtractedDocument, type ExtractOptions } from './types.js';

export const DEFAULT_MAX_CHARS = 2_000_000;
export const DEFAULT_TIMEOUT_MS = 90_000;

function titleOf(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  return base || fileName;
}

async function extractByKind(buffer: Buffer, fileName: string, maxChars: number, signal: AbortSignal): Promise<ExtractedDocument> {
  const { kind } = detectKind(fileName);
  switch (kind) {
    case 'markdown':
    case 'text':
      return { kind, markdown: decodeText(buffer), parts: null, warnings: [] };
    case 'csv': {
      const { markdown, warnings } = csvToMarkdown(decodeText(buffer), titleOf(fileName));
      return { kind, markdown, parts: null, warnings };
    }
    case 'pdf':
      return (await import('./pdf.js')).extractPdf(buffer, { maxChars, signal });
    case 'docx':
      return (await import('./docx.js')).extractDocx(buffer, titleOf(fileName));
    case 'xlsx':
      return (await import('./xlsx.js')).extractXlsx(buffer, titleOf(fileName));
    case 'pptx':
      return (await import('./pptx.js')).extractPptx(buffer, titleOf(fileName));
  }
}

/**
 * Turns an uploaded document into Markdown the agent can read.
 * Throws DocumentError (user-facing message) for unsupported, corrupt, encrypted or oversized input.
 */
export async function extractDocument(buffer: Buffer, fileName: string, options: ExtractOptions = {}): Promise<ExtractedDocument> {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (buffer.length === 0) throw new DocumentError('File kosong (0 byte).');

  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new DocumentError(`Membaca "${fileName}" melebihi batas waktu ${Math.round(timeoutMs / 1000)} detik. Pecah dokumen menjadi beberapa file.`));
    }, timeoutMs);
  });
  let result: ExtractedDocument;
  try {
    result = await Promise.race([extractByKind(buffer, fileName, maxChars, controller.signal), timeout]);
  } catch (err) {
    if (err instanceof DocumentError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new DocumentError(`"${fileName}" tidak bisa dibaca (file rusak atau formatnya tidak sesuai ekstensi): ${message.slice(0, 300)}`);
  } finally {
    clearTimeout(timer);
  }

  let markdown = wellFormed(normalizeNewlines(result.markdown).replace(/\n{4,}/g, '\n\n\n').trim());
  const warnings = result.warnings.map(wellFormed);
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
  return { ...result, markdown, warnings };
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
