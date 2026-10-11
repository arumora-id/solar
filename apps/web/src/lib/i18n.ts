import { useSyncExternalStore } from 'react';
import { LANGUAGES, type Language } from '@solar/shared';
import { en } from '../i18n/en';
import { id, type Dict } from '../i18n/id';
import { readPref, writePref } from './session';

/*
 * Interface language of SOLAR: Bahasa Indonesia ('id') or English ('en'), switchable at any time without a reload.
 *
 * Dictionaries
 * - Every user-visible text lives in src/i18n/{id,en}/<namespace>.ts, one file pair per namespace (common, app, agent,
 *   character, monitor, artifacts, settings, voice, api), joined in src/i18n/{id,en}/index.ts.
 * - The Indonesian file is the source of the type (`Dict = typeof id`): write plain objects, no `as const`. The English
 *   file is typed `Dict['<namespace>']`, so a missing or extra key is a compile error right in that file.
 * - Adding a key: add it to i18n/id/<ns>.ts, then the same key to i18n/en/<ns>.ts (the compiler lists what is missing).
 * - Parameters and plurals: the leaf is a function returning a string, e.g. id `done: (n: number) => `${n} selesai``
 *   and en `done: (n: number) => `${numEn(n)} ${plural(n, 'task')} done`` (helpers in i18n/helpers.ts). Never glue
 *   translated fragments together in a component: word order differs between the languages.
 * - Dictionary files import only i18n/helpers.ts and types (a lib/ module there would be an import cycle).
 * - Shared words (Batal/Cancel, Simpan/Save, Tutup/Close, Hapus/Delete, Unduh/Download, ...) are in `common`.
 * - Keep the technical terms the UI already uses (ArchiMate, TSD, API, task, knowledge base, skill, plugin, MCP).
 * - Not translated: data (knowledge and skill content, plugin descriptions, artifacts, the user's own text) and the
 *   agent's answers. Server texts (task steps, errors) are translated by the server: every request carries the header
 *   X-Solar-Language and each new task its `language` (lib/api.ts).
 *
 * Use
 * - Components: `const t = useT();` then `t.agent.greeting` or `t.monitor.kpi.done(n)`; the component re-renders
 *   when the language changes. `useLang()` gives the code ('id' | 'en').
 * - Plain modules: `t().api.uploadDisconnected`, read when the text is needed (not at module load) so it follows the
 *   current language; `subscribeLang(listener)` for code that must react to a switch (e.g. a canvas aria-label).
 * - Formatting: lib/format.ts (dates, numbers, sizes, durations) or `localeOf()` for Intl.
 */

export type Lang = Language;
export type { Dict };
export { LANGUAGES };

const DICTS: Record<Lang, Dict> = { id, en };

/** Each language in its own name: the switch shows these, whatever the current language. */
export const LANGUAGE_NATIVE_NAME: Record<Lang, string> = { id: 'Bahasa Indonesia', en: 'English' };

/** Preference key: localStorage 'solar.lang' (JSON), read before the first paint by the inline script of index.html. */
const PREF = 'lang';
const STORAGE_KEY = `solar.${PREF}`;

const MANIFEST: Record<Lang, string> = { id: '/manifest.webmanifest', en: '/manifest.en.webmanifest' };

declare global {
  interface Window {
    /** Only in the desktop app (apps/desktop/src/preload.ts). */
    solarDesktop?: {
      platform: string;
      versions: { electron: string; chrome: string };
      /** Tells the desktop shell the interface language (its menu and dialogs follow it). */
      setLanguage?: (lang: Lang) => void;
    };
  }
}

export function isLang(value: unknown): value is Lang {
  return value === 'id' || value === 'en';
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  if (navigator.languages?.length) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}

/**
 * The language for a user who never chose one: the first of the browser's languages that SOLAR speaks (Indonesian or
 * Malay -> 'id', English -> 'en'), otherwise Indonesian. Keep in sync with the inline script of index.html.
 */
export function detectLang(languages: readonly string[] = browserLanguages()): Lang {
  for (const tag of languages) {
    const primary = tag.toLowerCase().split(/[-_]/)[0];
    if (primary === 'id' || primary === 'ms') return 'id';
    if (primary === 'en') return 'en';
  }
  return 'id';
}

function storedLang(): Lang | null {
  const value = readPref<unknown>(PREF, null);
  return isLang(value) ? value : null;
}

/** The user's explicit choice (also when storage is unavailable and it lives for this page only). */
let chosen: Lang | null = storedLang();
let current: Lang = chosen ?? detectLang();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

/** The dictionary of a language (default: the current one), for code outside React components. */
export function t(lang: Lang = current): Dict {
  return DICTS[lang];
}

/** BCP 47 locale for Intl / toLocaleString and speech: 'id-ID' or 'en-US'. */
export function localeOf(lang: Lang = current): 'id-ID' | 'en-US' {
  return lang === 'en' ? 'en-US' : 'id-ID';
}

/** Calls `listener` after every language switch (also one made in another window); returns the unsubscribe function. */
export function subscribeLang(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current language; the component re-renders when it changes. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang, getLang);
}

/** The dictionary of the current language; the component re-renders when it changes. */
export function useT(): Dict {
  return DICTS[useLang()];
}

/** Switches the interface language and remembers the choice on this device (other open windows follow). */
export function setLang(lang: Lang): void {
  if (!isLang(lang)) return;
  chosen = lang;
  writePref(PREF, lang);
  change(lang);
}

function change(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  applyToDocument();
  for (const listener of [...listeners]) listener();
}

/** <html lang>, the page description and the web app manifest follow the language; the desktop shell is told too. */
function applyToDocument(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = current;
  const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (description) description.content = DICTS[current].app.meta.description;
  const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (manifest && manifest.getAttribute('href') !== MANIFEST[current]) manifest.setAttribute('href', MANIFEST[current]);
  try {
    window.solarDesktop?.setLanguage?.(current);
  } catch {
    // the desktop bridge failed: only the desktop menu keeps its previous language
  }
}

let setUp = false;

/** Applies the language to the page and follows switches made in other windows (call once, before rendering). */
export function setupI18n(): void {
  if (setUp || typeof window === 'undefined') return;
  setUp = true;
  applyToDocument();
  window.addEventListener('storage', (e) => {
    // key null: the site's storage was cleared
    if (e.key !== null && e.key !== STORAGE_KEY) return;
    chosen = storedLang();
    change(chosen ?? detectLang());
  });
  // the browser's language list changed: matters only while the user has not chosen a language
  window.addEventListener('languagechange', () => {
    if (!chosen) change(detectLang());
  });
}
