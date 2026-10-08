/**
 * Base64 contents of the files listed in `assets.json`, by name.
 *
 * Empty when the server runs from source (tsx, vitest): the files are then read from disk. `build.mjs` replaces this
 * module in the esbuild bundles with one that holds every file, because the desktop app and the self-host zip ship
 * only the bundles (no node_modules, no assets folder).
 */
export const EMBEDDED_ASSETS: Readonly<Record<string, string>> = {};
