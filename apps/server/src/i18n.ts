/**
 * Server-side translations: every text the server writes for people exists in Bahasa Indonesia and English.
 *
 * - Task-scoped text (current step, status messages, approval reasons, tool display names, errors of a task) follows the
 *   task's language, `Task.language`, set from the interface language of the client that created the task: the event
 *   stream sends it to every open UI.
 * - Request-scoped text (API errors, upload errors and warnings, import notices, provider tests) follows the language of
 *   the request: the `X-Solar-Language` header of the web client, a `lang` query parameter (event stream, download
 *   links), else `Accept-Language`.
 * - Without a language the server answers in Indonesian ({@link DEFAULT_LANG}).
 * - Not translated: data (knowledge and skill content, plugin descriptions, artifact contents, the user's own text) and
 *   what the tools return to the model, which stays English.
 *
 * Messages live in ./i18n/*.ts, one catalog per area, each entry with both languages side by side (as the TSD labels in
 * generators/techspec/i18n.ts). A text uses `{name}` placeholders; a function entry builds the text from its parameters
 * (English plurals). `t(lang, key, params)` is typed: the key must exist and the parameters must match.
 */
import { LANGUAGE_HEADER, LANGUAGES, type Language } from '@solar/shared';
import { API_MESSAGES } from './i18n/api.js';
import { DOCUMENT_MESSAGES } from './i18n/documents.js';
import type { Entry } from './i18n/helpers.js';
import { KNOWLEDGE_MESSAGES } from './i18n/knowledge.js';
import { LLM_MESSAGES } from './i18n/llm.js';
import { TASK_MESSAGES } from './i18n/tasks.js';

export { count, plural } from './i18n/helpers.js';

export type Lang = Language;

/** The language of tasks and requests that do not name one. */
export const DEFAULT_LANG: Lang = 'id';

/** Each language named in itself (for the agent's task context and for people). */
export const LANGUAGE_NAME: Readonly<Record<Lang, string>> = { id: 'Bahasa Indonesia', en: 'English' };

/** Locale used to format numbers and dates in each language. */
export const LOCALE: Readonly<Record<Lang, string>> = { id: 'id-ID', en: 'en-US' };

/** A text in both languages. */
export type Localized = Readonly<Record<Lang, string>>;

/** A text that is the same in both languages (e.g. an MCP tool's own name) or differs per language. */
export type LocalizedText = string | Localized;

const MESSAGES = {
  ...TASK_MESSAGES,
  ...API_MESSAGES,
  ...DOCUMENT_MESSAGES,
  ...KNOWLEDGE_MESSAGES,
  ...LLM_MESSAGES,
} as const;

type Messages = typeof MESSAGES;
export type MessageKey = keyof Messages;

type Placeholders<S extends string> = S extends `${string}{${infer Name}}${infer Rest}` ? Name | Placeholders<Rest> : never;

/** Parameters of an entry: those of its function, else one value per `{name}` placeholder, else none (`void`). */
type ParamsOf<E> = E extends { readonly id: (params: infer P) => string }
  ? P
  : E extends { readonly en: (params: infer P) => string }
    ? P
    : E extends { readonly id: infer S extends string }
      ? [Placeholders<S>] extends [never]
        ? void
        : Record<Placeholders<S>, string | number>
      : never;

export type MessageParams<K extends MessageKey> = ParamsOf<Messages[K]>;
type Args<K extends MessageKey> = MessageParams<K> extends void ? [] : [params: MessageParams<K>];

export const isLang = (value: unknown): value is Lang => typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);

/** The text of a message in a language. */
export function t<K extends MessageKey>(lang: Lang, key: K, ...args: Args<K>): string {
  const entry = MESSAGES[key] as Entry;
  const template = entry[isLang(lang) ? lang : DEFAULT_LANG];
  const params = args[0] as Record<string, unknown> | undefined;
  if (typeof template === 'function') return (template as (p: unknown) => string)(params);
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/** The text of a message in both languages, for a value that is shown later in a language not known yet. */
export function both<K extends MessageKey>(key: K, ...args: Args<K>): Localized {
  return { id: t('id', key, ...args), en: t('en', key, ...args) };
}

/** The text in a language; a plain string is the same in both. */
export function localize(text: LocalizedText, lang: Lang): string {
  return typeof text === 'string' ? text : text[lang];
}

/** Formats an integer for a language: 1.234 (id), 1,234 (en). */
export function fmtInt(n: number, lang: Lang = DEFAULT_LANG): string {
  return Number(n).toLocaleString(LOCALE[lang]);
}

/**
 * An error whose message exists in both languages. `message` is the text in `fallback` (what logs, tests and the agent
 * see); an API answer shows `in(lang)` for the language of the request (see {@link errorMessage}).
 */
export class LocalizedError extends Error {
  constructor(
    readonly text: Localized,
    fallback: Lang = DEFAULT_LANG,
  ) {
    super(text[fallback]);
  }

  in(lang: Lang): string {
    return this.text[lang];
  }
}

/** The message of any thrown value, in `lang` when the error carries both languages. */
export function errorMessage(err: unknown, lang: Lang): string {
  if (err instanceof LocalizedError) return err.in(lang);
  return err instanceof Error ? err.message : String(err);
}

// ---- language of a request -------------------------------------------------------------------------------------

/** The interface language of a language tag: en* -> en, id* / in* / ms* -> id, anything else null. */
export function langOfTag(tag: unknown): Lang | null {
  if (typeof tag !== 'string') return null;
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
  if (primary === 'en') return 'en';
  // "in" is the old code of Indonesian; Malay readers understand Indonesian best
  if (primary === 'id' || primary === 'in' || primary === 'ms') return 'id';
  return null;
}

/** The first supported language of an Accept-Language header, by preference (q value, then order). */
export function langOfAcceptLanguage(header: unknown): Lang | null {
  if (typeof header !== 'string' || !header.trim()) return null;
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag, q: q ? Number(q.slice(2)) : 1, index };
    })
    .filter((r) => r.tag && Number.isFinite(r.q) && r.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const r of ranked) {
    const lang = langOfTag(r.tag);
    if (lang) return lang;
  }
  return null;
}

/** Header name as Node lower-cases it. */
const HEADER = LANGUAGE_HEADER.toLowerCase();

const first = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);

/**
 * The language a request is answered in: the `X-Solar-Language` header, else a `lang` query parameter (an event stream
 * or a download link cannot send headers), else Accept-Language, else Indonesian.
 */
export function requestLanguage(headers: Record<string, string | string[] | undefined>, query?: unknown): Lang {
  const fromQuery = query && typeof query === 'object' ? langOfTag(first((query as Record<string, unknown>).lang)) : null;
  return langOfTag(first(headers[HEADER])) ?? fromQuery ?? langOfAcceptLanguage(first(headers['accept-language'])) ?? DEFAULT_LANG;
}

/**
 * The language of an HTTP request: what the API's language middleware stored (`req.lang`), else read from the request
 * itself (code that also runs before that middleware, e.g. the error handler).
 */
export function langOf(req: { readonly lang?: unknown; readonly headers?: Record<string, string | string[] | undefined>; readonly query?: unknown }): Lang {
  return isLang(req.lang) ? req.lang : requestLanguage(req.headers ?? {}, req.query);
}

/** The language of a task (older tasks have none and are Indonesian); tolerates the partial contexts of tests. */
export function taskLang(ctx: { readonly task?: { readonly language?: Lang } | null } | null | undefined): Lang {
  const lang = ctx?.task?.language;
  return isLang(lang) ? lang : DEFAULT_LANG;
}

/** Every message key (tests check that both languages have the same placeholders). */
export function messageKeys(): MessageKey[] {
  return Object.keys(MESSAGES) as MessageKey[];
}

/** The raw templates of a message (tests). */
export function messageEntry(key: MessageKey): Entry {
  return MESSAGES[key] as Entry;
}
