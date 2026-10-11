/**
 * Small helpers for dictionary functions (see the conventions in lib/i18n.ts). A dictionary formats in its own
 * language, so these take no "current language": the Indonesian file uses numId, the English file numEn and plural.
 */

const ID_NUMBER = new Intl.NumberFormat('id-ID');
const EN_NUMBER = new Intl.NumberFormat('en-US');

/** 12345 -> "12.345" */
export function numId(n: number): string {
  return ID_NUMBER.format(n);
}

/** 12345 -> "12,345" */
export function numEn(n: number): string {
  return EN_NUMBER.format(n);
}

/**
 * English singular or plural word (Indonesian nouns do not change): plural(1, 'file') -> "file",
 * plural(3, 'file') -> "files", plural(2, 'entry', 'entries') -> "entries".
 */
export function plural(n: number, one: string, other = `${one}s`): string {
  return n === 1 ? one : other;
}
