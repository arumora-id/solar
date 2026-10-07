import { DocumentError, type ExtractedDocument } from './types.js';

// PLACEHOLDER - replaced by the implementation chosen in the extraction evaluation
export async function extractPdf(_buffer: Buffer, _opts: { maxChars: number; signal: AbortSignal }): Promise<ExtractedDocument> {
  throw new DocumentError('Membaca file .pdf sedang disiapkan dan belum tersedia di versi ini. Untuk sementara lampirkan versi Markdown, TXT atau CSV.', 415);
}
