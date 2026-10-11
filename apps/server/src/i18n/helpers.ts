/**
 * Building blocks of the server's message catalogs (see ../i18n.ts). A catalog file imports only from here, so the
 * catalogs never import the module that combines them.
 */

/** A message: text with `{name}` placeholders, or a function of its parameters (for English plurals). */
export type Template = string | ((params: never) => string);

/** One message in both interface languages. */
export interface Entry {
  readonly id: Template;
  readonly en: Template;
}

export type Catalog = Readonly<Record<string, Entry>>;

/** English plural form: plural(1, 'file') = "file", plural(2, 'file') = "files". */
export const plural = (n: number, one: string, other = `${one}s`): string => (n === 1 ? one : other);

/** A count with its English noun: count(1, 'file') = "1 file", count(3, 'match', 'matches') = "3 matches". */
export const count = (n: number, one: string, other?: string): string => `${n} ${plural(n, one, other)}`;
