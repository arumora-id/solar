// Bundles the Electron main process (ESM) and the preload script (CommonJS, required by sandboxed renderers).
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
  // the .env template is embedded so the installed app can create %APPDATA%/SOLAR/.env on first run
  loader: { '.example': 'text' },
};

await build({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist/main.js', format: 'esm' });
await build({ ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs', format: 'cjs' });
