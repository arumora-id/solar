import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import manifest from './assets.json';
import { BUNDLED, EMBEDDED_ASSETS } from './embedded.js';

/**
 * Binary files the server needs at runtime (the SVG rasterizer's WebAssembly, the fonts it draws diagram text with).
 *
 * `assets.json` lists them once: a `package` entry is a file of an npm dependency, a `file` entry is relative to
 * apps/server. The Word worker bundle carries the files inside it (see `build-plugins.mjs`); from source they are read
 * from disk. A bundle never reads them from disk: one that does not carry them says so.
 */
export type AssetName = keyof typeof manifest;

type Source = { package: string } | { file: string };

const SERVER_ROOT = fileURLToPath(new URL('../../', import.meta.url));

function sourcePath(name: AssetName): string {
  const source = (manifest as Record<string, Source>)[name];
  if (!source) throw new Error(`Unknown asset "${name}"`);
  if ('package' in source) return createRequire(import.meta.url).resolve(source.package);
  return join(SERVER_ROOT, source.file);
}

const cache = new Map<AssetName, Promise<Uint8Array>>();

/** The bytes of an asset, embedded in the bundle or read from disk; loaded once and kept. */
export function loadAsset(name: AssetName): Promise<Uint8Array> {
  let pending = cache.get(name);
  if (!pending) {
    const embedded = EMBEDDED_ASSETS[name];
    pending =
      embedded !== undefined
        ? Promise.resolve(new Uint8Array(Buffer.from(embedded, 'base64')))
        : BUNDLED
          ? Promise.reject(new Error(`${name} is not embedded in this build (only the Word worker bundle carries it)`))
          : readFile(sourcePath(name)).then((b) => new Uint8Array(b));
    // a failed read is not cached, so a later call can try again
    pending.catch(() => cache.delete(name));
    cache.set(name, pending);
  }
  return pending;
}
