/**
 * Base64 contents of the files listed in `assets.json`, by name.
 *
 * Empty when the server runs from source (tsx, vitest): the files are then read from disk. In the esbuild bundles
 * (`build.mjs`, `build-plugins.mjs`) this module is replaced: the Word worker bundle (dist/docx-worker.mjs) holds every
 * file, because the desktop app and the self-host zip ship only the bundles (no node_modules, no assets folder); the
 * server bundles, which never draw diagrams themselves, hold none.
 */
export const EMBEDDED_ASSETS: Readonly<Record<string, string>> = {};

/** True inside an esbuild bundle, where assets are never read from disk. */
export const BUNDLED: boolean = false;
