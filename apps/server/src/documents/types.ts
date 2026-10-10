import type { AttachmentKind } from '@solar/shared';
import type { Lang } from '../i18n.js';

/** Result of turning an uploaded document into LLM-friendly Markdown. */
export interface ExtractedDocument {
  kind: AttachmentKind;
  markdown: string;
  /** Pages (pdf), slides (pptx) or sheets (xlsx); null for text formats. */
  parts: number | null;
  warnings: string[];
  /** Raw cell values per sheet (xlsx/csv only), when ExtractOptions.tableRows is set. First row = header. */
  tables?: SheetTable[];
}

export interface SheetTable {
  name: string;
  rows: string[][];
  /**
   * Not every row was read: more rows than tableRows allowed, the sheet was skipped for the text limit, or the tables
   * reached their total text limit.
   */
  truncated: boolean;
}

export interface ExtractOptions {
  /** Extracted Markdown is cut at this length (a warning says so). */
  maxChars?: number;
  /** Aborts extraction that takes longer than this. */
  timeoutMs?: number;
  /** Also return the raw tables of spreadsheets (xlsx/csv), up to this many rows per sheet. */
  tableRows?: number;
  /** Language of the errors, warnings and notes in the text (the upload request's); default Indonesian. */
  lang?: Lang;
}

export type DocumentErrorCode =
  | 'EMPTY'
  | 'TOO_LARGE'
  | 'ZIP_BOMB'
  | 'ENCRYPTED'
  | 'CORRUPT'
  | 'LEGACY_FORMAT'
  | 'UNSUPPORTED'
  | 'TIMEOUT';

const STATUS: Record<DocumentErrorCode, 413 | 415 | 422> = {
  EMPTY: 422,
  TOO_LARGE: 413,
  ZIP_BOMB: 413,
  ENCRYPTED: 422,
  CORRUPT: 422,
  LEGACY_FORMAT: 415,
  UNSUPPORTED: 415,
  TIMEOUT: 422,
};

/**
 * A problem with the uploaded file itself (unsupported, corrupt, encrypted, too large); the message is shown to the
 * user, in the language the extraction was asked for (ExtractOptions.lang).
 */
export class DocumentError extends Error {
  constructor(
    message: string,
    /** HTTP status the API answers with. */
    readonly status: 413 | 415 | 422 = 422,
    readonly code: DocumentErrorCode = status === 413 ? 'TOO_LARGE' : status === 415 ? 'UNSUPPORTED' : 'CORRUPT',
  ) {
    super(message);
  }
}

export function documentError(code: DocumentErrorCode, message: string): DocumentError {
  return new DocumentError(message, STATUS[code], code);
}

/** State shared by the format parsers while one file is extracted. */
export interface ParseContext {
  bytes: Uint8Array;
  /** Lower-case extension without the dot. */
  ext: string;
  fileName: string;
  limits: import('./limits.js').Limits;
  deadline: import('./limits.js').Deadline;
  /** Parsers may stop early once this much text is produced. */
  maxChars: number;
  /** User-facing notes in `lang`, e.g. what was cut or skipped. */
  warnings: string[];
  /** Language of the errors, warnings and the notes written into the text. */
  lang: Lang;
  /** Collect raw spreadsheet tables (ExtractOptions.tableRows). */
  collectTables?: boolean;
}

/** What a format parser returns; index.ts normalises and caps it. */
export interface ParsedDocument {
  kind: AttachmentKind;
  markdown: string;
  parts: number | null;
  tables?: SheetTable[];
}
