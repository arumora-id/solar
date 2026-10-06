// Bundles the server into self-contained ESM files (used by `npm start` and by the desktop app).
import { build } from 'esbuild';

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
  logLevel: 'info',
};

await build({ ...common, entryPoints: ['src/index.ts'], outfile: 'dist/index.js' });
await build({ ...common, entryPoints: ['src/server.ts'], outfile: 'dist/server.mjs' });
