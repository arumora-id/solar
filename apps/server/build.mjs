// Bundles the server into self-contained ESM files (used by `npm start` and by the desktop app).
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';
import { strFromU8, unzipSync } from 'fflate';
import { embedAssets, stripEmbeddedSources, wordRendererInWorkerOnly } from './build-plugins.mjs';

const root = dirname(fileURLToPath(import.meta.url));

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
  // the Word renderer and its binary assets (rasterizer WebAssembly, fonts) go into the Word worker only, see build-plugins.mjs
  plugins: [embedAssets({ embed: false }), wordRendererInWorkerOnly()],
  logLevel: 'info',
};

await serverBundle('src/index.ts', 'dist/index.js');
await serverBundle('src/server.ts', 'dist/server.mjs');
// document parsing runs in a worker thread (hard timeout, memory cap); found next to the bundles at runtime
await build({ ...common, entryPoints: ['src/documents/worker.ts'], outfile: 'dist/extract-worker.mjs' });
// so does the Word (.docx) rendering of a TSD, which also draws the diagrams' PNG fallbacks
await build({ ...common, plugins: [embedAssets({ embed: true })], entryPoints: ['src/tasks/techSpecDocxWorker.ts'], outfile: 'dist/docx-worker.mjs' });
stripEmbeddedSources(join(root, 'dist/docx-worker.mjs.map'));
await verifyDocxWorker(join(root, 'dist/docx-worker.mjs'));

/**
 * A server bundle, checked to leave the Word renderer out: the docx library, the rasterizer and its WebAssembly and fonts
 * belong in dist/docx-worker.mjs only (rendering in the server thread would block it for seconds, see
 * src/tasks/techSpecDocxIsolated.ts), and a stray import would also put megabytes back into every server bundle.
 */
async function serverBundle(entry, outfile) {
  const { metafile } = await build({ ...common, entryPoints: [entry], outfile, metafile: true });
  const word = /node_modules[\\/](docx|@resvg[\\/]resvg-wasm)[\\/]|src[\\/]generators[\\/](techspec[\\/]docx|svgRaster)\.ts$/;
  const found = Object.keys(metafile.inputs).filter((input) => word.test(input));
  if (found.length) throw new Error(`${outfile} includes the Word renderer, which must run in the Word worker only: ${found.slice(0, 5).join(', ')}`);
}

/**
 * Runs the Word worker from a folder outside the project, as the desktop app and the self-host zip do (no node_modules,
 * no assets folder), and checks that it draws a diagram: a bundle that lost its embedded WebAssembly or fonts would
 * otherwise ship grey placeholder pictures without any test noticing.
 */
async function verifyDocxWorker(bundle) {
  const dir = mkdtempSync(join(tmpdir(), 'solar-docx-worker-'));
  try {
    const file = join(dir, 'docx-worker.mjs');
    copyFileSync(bundle, file);
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120" font-family="\'Segoe UI\', Arial, sans-serif">' +
      '<rect x="10" y="10" width="300" height="100" rx="6" fill="rgba(255,255,181,0.9)" stroke="#333"/><text x="30" y="70" font-size="20">Build check</text></svg>';
    const document = {
      title: 'Build check',
      lang: 'en',
      info: { documentId: null, version: '1.0', status: 'Draft', date: '2026-01-01', authors: ['SOLAR'], reviewers: [], approvers: [], summary: '' },
      meta: [['Version', '1.0']],
      revisionHeaders: ['Version', 'Date', 'Author', 'Changes'],
      revisions: [['1.0', '2026-01-01', 'SOLAR', 'Initial version']],
      blocks: [
        { kind: 'heading', level: 2, text: '1. Diagram', anchor: '1-diagram', toc: true },
        { kind: 'figure', diagram: { artifactId: 'art_check', fileName: 'check.svg', svg }, caption: 'Build check', number: 1 },
      ],
    };
    const worker = new Worker(file);
    const response = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no answer within 60 s')), 60_000);
      worker.once('message', (msg) => (clearTimeout(timer), resolve(msg)));
      worker.once('error', (err) => (clearTimeout(timer), reject(err)));
      worker.postMessage({ document, options: {} });
    }).finally(() => worker.terminate());
    if (!response.ok) throw new Error(response.message);
    if (response.warnings.length) throw new Error(response.warnings.join('; '));
    const files = unzipSync(response.buffer);
    const pngs = Object.keys(files).filter((name) => /^word\/media\/.+\.png$/.test(name));
    if (pngs.length !== 1 || !strFromU8(files['word/document.xml']).includes('Build check')) throw new Error('the document has no diagram');
    console.log(`  dist/docx-worker.mjs checked: diagram drawn from the embedded assets (${files[pngs[0]].length} byte PNG)`);
  } catch (err) {
    throw new Error(`dist/docx-worker.mjs does not work on its own: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
