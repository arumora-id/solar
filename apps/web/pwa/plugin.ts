import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

/** Files that never belong in the offline shell (source maps are only read by developer tools). */
const SKIP = /\.map$|(^|\/)sw\.js$/;

function publicFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(dir, path).split('\\').join('/'));
    }
  };
  try {
    walk(dir);
  } catch {
    // no public directory
  }
  return out;
}

/**
 * Writes dist/sw.js from apps/web/pwa/sw.js with the list of files of this build (the offline app shell) and a
 * version derived from their contents, so every build that changes the UI installs a new service worker.
 */
export function solarServiceWorker(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'solar-service-worker',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    // after vite:build-html, so bundle['index.html'] (the precached '/') exists and is part of the version
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const files = new Map<string, string | Uint8Array>();
        for (const [fileName, output] of Object.entries(bundle)) {
          if (fileName === 'index.html' || SKIP.test(fileName)) continue;
          files.set(fileName, output.type === 'chunk' ? output.code : output.source);
        }
        if (config.publicDir) {
          for (const file of publicFiles(config.publicDir)) {
            if (!SKIP.test(file)) files.set(file, readFileSync(join(config.publicDir, file)));
          }
        }
        const index = bundle['index.html'];
        const names = [...files.keys()].sort();
        const hash = createHash('sha256');
        for (const name of names) hash.update(name).update('\0').update(files.get(name)!).update('\0');
        if (index?.type === 'asset') hash.update(index.source);
        const version = hash.digest('hex').slice(0, 16);
        const precache = ['/', ...names.map((name) => `/${name}`)];
        const template = readFileSync(join(config.root, 'pwa', 'sw.js'), 'utf8');
        this.emitFile({
          type: 'asset',
          fileName: 'sw.js',
          // replacer functions: a "$" in a file name must not be read as a replacement pattern
          source: template.replace('__SOLAR_VERSION__', () => version).replace('__SOLAR_PRECACHE__', () => JSON.stringify(precache, null, 2)),
        });
      },
    },
  };
}
