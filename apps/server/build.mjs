// Bundles the server into self-contained ESM files (used by `npm start` and by the desktop app).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * The desktop app and the self-host zip ship only the bundles, so the binary files in src/assets/assets.json (the SVG
 * rasterizer's WebAssembly, the diagram fonts) are written into them: src/assets/embedded.ts, empty when running from
 * source, is replaced by a module holding each file as base64 (decoded the first time it is used).
 */
const embedAssets = {
  name: 'solar-embed-assets',
  setup(b) {
    b.onLoad({ filter: /[\\/]src[\\/]assets[\\/]embedded\.ts$/ }, () => {
      const manifest = JSON.parse(readFileSync(join(root, 'src/assets/assets.json'), 'utf8'));
      const require = createRequire(join(root, 'package.json'));
      const files = {};
      const watchFiles = [join(root, 'src/assets/assets.json')];
      for (const [name, source] of Object.entries(manifest)) {
        const path = source.package ? require.resolve(source.package) : join(root, source.file);
        files[name] = readFileSync(path).toString('base64');
        watchFiles.push(path);
      }
      return { contents: `export const EMBEDDED_ASSETS = ${JSON.stringify(files)};\n`, loader: 'js', watchFiles };
    });
  },
};

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  legalComments: 'none',
  // optional native binding of `pg`, never used
  external: ['pg-native'],
  // CommonJS dependencies inside an ESM bundle still need `require`
  banner: {
    js: "import { createRequire as __solarCreateRequire } from 'node:module'; const require = __solarCreateRequire(import.meta.url);",
  },
  plugins: [embedAssets],
  logLevel: 'info',
};

await build({ ...common, entryPoints: ['src/index.ts'], outfile: 'dist/index.js' });
await build({ ...common, entryPoints: ['src/server.ts'], outfile: 'dist/server.mjs' });
// document parsing runs in a worker thread (hard timeout, memory cap); found next to the bundles at runtime
await build({ ...common, entryPoints: ['src/documents/worker.ts'], outfile: 'dist/extract-worker.mjs' });
