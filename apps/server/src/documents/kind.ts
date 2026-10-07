import type { AttachmentKind } from '@solar/shared';
import { DocumentError } from './types.js';

const BY_EXTENSION: Record<string, { kind: AttachmentKind; mimeType: string }> = {
  '.pdf': { kind: 'pdf', mimeType: 'application/pdf' },
  '.docx': { kind: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  '.xlsx': { kind: 'xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  '.xlsm': { kind: 'xlsx', mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12' },
  '.csv': { kind: 'csv', mimeType: 'text/csv' },
  '.pptx': { kind: 'pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  '.md': { kind: 'markdown', mimeType: 'text/markdown' },
  '.markdown': { kind: 'markdown', mimeType: 'text/markdown' },
  '.txt': { kind: 'text', mimeType: 'text/plain' },
};

const LEGACY: Record<string, string> = {
  '.doc': 'Word 97-2003 (.doc)',
  '.xls': 'Excel 97-2003 (.xls)',
  '.ppt': 'PowerPoint 97-2003 (.ppt)',
};

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
}

/** Detects the attachment kind from the file name; throws a user-facing DocumentError for unsupported files. */
export function detectKind(fileName: string): { kind: AttachmentKind; mimeType: string } {
  const ext = extensionOf(fileName);
  const known = BY_EXTENSION[ext];
  if (known) return known;
  if (LEGACY[ext]) {
    throw new DocumentError(
      `Format ${LEGACY[ext]} belum didukung. Simpan ulang sebagai ${ext}x (File → Save As) atau PDF, lalu lampirkan lagi.`,
      415,
    );
  }
  throw new DocumentError(
    `Jenis file "${ext || fileName}" tidak didukung. Gunakan PDF, Word (.docx), Excel (.xlsx/.xlsm/.csv), PowerPoint (.pptx), Markdown (.md) atau teks (.txt).`,
    415,
  );
}
