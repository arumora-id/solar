import { DocumentError, type ExtractedDocument } from './types.js';

// PLACEHOLDER - replaced by the implementation chosen in the extraction evaluation
export async function extractPptx(_buffer: Buffer, _title: string): Promise<ExtractedDocument> {
  throw new DocumentError('Membaca file .pptx sedang disiapkan dan belum tersedia di versi ini. Untuk sementara lampirkan versi Markdown, TXT atau CSV.', 415);
}
