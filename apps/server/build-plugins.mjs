// esbuild plugins shared by build.mjs and the Word worker test.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const MODULE = /[\\/]src[\\/]assets[\\/]embedded\.ts$/;

/**
 * The desktop app and the self-host zip ship only the bundles, so the binary files in src/assets/assets.json (the SVG
 * rasterizer's WebAssembly, the diagram fonts) are written into the bundle that uses them: with `embed: true` (the Word
 * worker) src/assets/embedded.ts is replaced by a module holding each file as base64 (decoded the first time it is
 * used); with `embed: false` (the server and extraction bundles) by one holding none, whose loadAsset() then fails with
 * a clear message instead of looking for the files on disk.
 */
export function embedAssets({ embed }) {
  return {
    name: 'solar-embed-assets',
    setup(b) {
      b.onLoad({ filter: MODULE }, () => {
        const manifestPath = join(root, 'src/assets/assets.json');
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        const require = createRequire(join(root, 'package.json'));
        const files = {};
        const watchFiles = [manifestPath];
        if (embed) {
          for (const [name, source] of Object.entries(manifest)) {
            const path = source.package ? require.resolve(source.package) : join(root, source.file);
            files[name] = readFileSync(path).toString('base64');
            watchFiles.push(path);
          }
        }
        return { contents: `export const EMBEDDED_ASSETS = ${JSON.stringify(files)};\nexport const BUNDLED = true;\n`, loader: 'js', watchFiles };
      });
    },
  };
}

/**
 * Leaves the embedded base64 out of a bundle's source map (sourcesContent of src/assets/embedded.ts): the bundle has
 * it already, and the map would otherwise carry a second copy of every asset.
 */
export function stripEmbeddedSources(mapFile) {
  const map = JSON.parse(readFileSync(mapFile, 'utf8'));
  let changed = false;
  (map.sources ?? []).forEach((source, i) => {
    if (MODULE.test(source) && map.sourcesContent?.[i]) {
      map.sourcesContent[i] = '// the assets, as base64, are in the bundle itself\n';
      changed = true;
    }
  });
  if (changed) writeFileSync(mapFile, JSON.stringify(map));
}

/**
 * The server bundles render Word documents only through dist/docx-worker.mjs (src/tasks/techSpecDocxIsolated.ts), so
 * its in-process fallback, meant for running from source, is left out of them: the docx library, its page layout and
 * the rasterizer are not in index.js / server.mjs at all. Without the worker file next to them, rendering fails with a
 * clear message (the TSD itself is still saved).
 */
export function wordRendererInWorkerOnly() {
  return {
    name: 'solar-word-renderer-in-worker-only',
    setup(b) {
      b.onResolve({ filter: /[\\/]generators[\\/]techspec[\\/]docx\.js$/ }, (args) =>
        /[\\/]src[\\/]tasks[\\/]techSpecDocxIsolated\.ts$/.test(args.importer) ? { path: 'docx-in-worker-only', namespace: 'solar-stub' } : undefined,
      );
      b.onLoad({ filter: /.*/, namespace: 'solar-stub' }, () => ({
        contents:
          "export async function renderTechSpecDocx() { throw new Error('the Word renderer (docx-worker.mjs) is missing next to the server bundle'); }\n",
        loader: 'js',
      }));
    },
  };
}
