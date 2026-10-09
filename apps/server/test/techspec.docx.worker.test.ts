import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { embedAssets } from '../build-plugins.mjs';
import { buildArchimate } from '../src/generators/archimate/index.js';
import { buildSequence } from '../src/generators/sequence/index.js';
import type { BuiltDocument } from '../src/generators/techspec/document.js';
import { buildTechSpec, type ResolvedDiagram } from '../src/generators/techspec/index.js';
import { renderTechSpecDocxIsolated, setDocxWorkerUrl } from '../src/tasks/techSpecDocxIsolated.js';
import { richTechSpec, sampleArchimate, sampleSequence } from './fixtures.js';
import { decodePng } from './png.js';

/**
 * The production path: the Word worker bundle, built as build.mjs builds it (WebAssembly and fonts embedded), run from a
 * folder outside the project, renders in its own thread.
 */
let dir = '';
let doc: BuiltDocument;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'solar-docx-worker-'));
  const out = join(dir, 'docx-worker.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../src/tasks/techSpecDocxWorker.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile: out,
    logLevel: 'silent',
    banner: { js: "import { createRequire as __solarCreateRequire } from 'node:module'; const require = __solarCreateRequire(import.meta.url);" },
    plugins: [embedAssets({ embed: true })],
  });
  setDocxWorkerUrl(pathToFileURL(out));

  const a = buildArchimate(sampleArchimate);
  const s = buildSequence(sampleSequence);
  if (!a.ok || !s.ok) throw new Error('fixture diagrams failed');
  const diagrams = new Map<string, ResolvedDiagram>([
    ['art_view1', { artifactId: 'art_view1', fileName: 'order-layered.svg', svg: a.output.views[0]!.svg }],
    ['art_seq', { artifactId: 'art_seq', fileName: 'place-order.sequence.svg', svg: s.output.svg, mermaid: s.output.mermaid }],
  ]);
  const res = buildTechSpec(richTechSpec({ view: 'art_view1', sequence: 'art_seq' }), diagrams, '2026-10-06');
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  doc = res.output.document;
}, 120_000);

afterAll(() => {
  setDocxWorkerUrl(undefined);
  rmSync(dir, { recursive: true, force: true });
});

describe('Word rendering in the worker thread', () => {
  it('renders the document with diagrams drawn from the embedded assets, without blocking the event loop', async () => {
    let longest = 0;
    let last = performance.now();
    const ticker = setInterval(() => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
    }, 5);
    try {
      const { buffer, warnings } = await renderTechSpecDocxIsolated(doc);
      expect(warnings).toEqual([]);
      const files = unzipSync(new Uint8Array(buffer));
      const pngs = Object.keys(files).filter((n) => /^word\/media\/.+\.png$/.test(n));
      expect(pngs).toHaveLength(2);
      for (const png of pngs) expect(decodePng(Buffer.from(files[png]!)).grey.some((g) => g < 100)).toBe(true);
      // the table of contents has its page numbers
      expect(strFromU8(files['word/document.xml']!)).toMatch(/PAGEREF _Toc\d+ \\h<\/w:instrText><w:fldChar w:fldCharType="separate"\/><w:t xml:space="preserve">4</);
    } finally {
      clearInterval(ticker);
    }
    // laying the pages out takes most of a second in-process; in the worker the server keeps answering
    expect(longest).toBeLessThan(250);
  }, 60_000);

  it('renders without the page layout, leaving the page numbers to Word, when the layout takes too long', async () => {
    const { buffer, warnings } = await renderTechSpecDocxIsolated(doc, { timeouts: { withLayout: 1 } });
    expect(warnings).toEqual([expect.stringMatching(/too long to lay out its pages in time/)]);
    expect(strFromU8(unzipSync(new Uint8Array(buffer))['word/settings.xml']!)).toMatch(/<w:updateFields\/>|<w:updateFields w:val="true"\/>/);
  }, 60_000);

  it('fails with a clear message when even that takes too long', async () => {
    await expect(renderTechSpecDocxIsolated(doc, { timeouts: { withLayout: 1, withoutLayout: 1 } })).rejects.toThrow(/took longer than 0 s/);
  }, 60_000);
});
