import type { AttachmentKind } from '@solar/shared';

/** Result of turning an uploaded document into LLM-friendly Markdown. */
export interface ExtractedDocument {
  kind: AttachmentKind;
  markdown: string;
  /** Pages (pdf), slides (pptx) or sheets (xlsx); null for text formats. */
  parts: number | null;
  warnings: string[];
}

export interface ExtractOptions {
  /** Extracted Markdown is cut at this length (a warning says so). */
  maxChars?: number;
  /** Aborts extraction that takes longer than this. */
  timeoutMs?: number;
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

/** A problem with the uploaded file itself (unsupported, corrupt, encrypted, too large); the message is shown to the user. */
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
  /** User-facing notes (Indonesian), e.g. what was cut or skipped. */
  warnings: string[];
}

/** What a format parser returns; index.ts normalises and caps it. */
export interface ParsedDocument {
  kind: AttachmentKind;
  markdown: string;
  parts: number | null;
}
