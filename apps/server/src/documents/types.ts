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

/** A problem with the uploaded file itself (unsupported, corrupt, encrypted, too large); the message is shown to the user. */
export class DocumentError extends Error {
  constructor(
    message: string,
    /** HTTP status the API answers with. */
    readonly status: 413 | 415 | 422 = 422,
  ) {
    super(message);
  }
}
