/**
 * Helpers for text that comes from user documents: keep strings well-formed (no lone UTF-16 surrogates, which
 * break JSON/jsonb and the model input) and keep document text from imitating SOLAR's prompt framing tags.
 */

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Replaces lone surrogates with U+FFFD (like String.prototype.toWellFormed). */
export function wellFormed(text: string): string {
  return text.replace(LONE_SURROGATE, '�');
}

/** Cuts to at most `max` UTF-16 units without splitting a surrogate pair. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return text.slice(0, end);
}

/** Moves an offset off the second half of a surrogate pair (to the start of the character). */
export function charBoundary(text: string, offset: number): number {
  if (offset <= 0 || offset >= text.length) return Math.max(0, Math.min(offset, text.length));
  const code = text.charCodeAt(offset);
  const prev = text.charCodeAt(offset - 1);
  return code >= 0xdc00 && code <= 0xdfff && prev >= 0xd800 && prev <= 0xdbff ? offset - 1 : offset;
}

/** Tags SOLAR uses to frame the conversation for the model. Document text must never open or close them. */
const FRAMING_TAG =
  /<(?=\s*\/?\s*(?:attached_documents|document|document_content|request|session_history|task_context|previous_task|user_request|agent_answer|artifacts)\b)/gi;

/** Neutralises framing tags inside document-derived text by escaping their `<`. */
export function neutralizeFraming(text: string): string {
  return text.replace(FRAMING_TAG, '&lt;');
}
