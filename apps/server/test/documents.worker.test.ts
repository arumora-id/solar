import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { strToU8, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocumentError } from '../src/documents/index.js';
import { extractIsolated, setExtractWorkerUrl } from '../src/documents/isolated.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/documents/${name}`, import.meta.url));

async function failure(promise: Promise<unknown>): Promise<DocumentError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof DocumentError) return err;
    throw err;
  }
  throw new Error('expected a DocumentError');
}

/** The production path: the worker bundle (built like build.mjs does) parses in its own thread. */
describe('extraction in the worker thread', () => {
  beforeAll(async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'solar-worker-')), 'extract-worker.mjs');
    await build({
      entryPoints: [fileURLToPath(new URL('../src/documents/worker.ts', import.meta.url))],
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'esm',
      outfile: out,
      logLevel: 'silent',
      banner: { js: "import { createRequire as __solarCreateRequire } from 'node:module'; const require = __solarCreateRequire(import.meta.url);" },
    });
    setExtractWorkerUrl(pathToFileURL(out));
  }, 60_000);

  afterAll(() => setExtractWorkerUrl(undefined));

  it('returns the extracted document', async () => {
    const doc = await extractIsolated(fixture('requirements.docx'), 'requirements.docx');
    expect(doc.kind).toBe('docx');
    expect(doc.markdown).toContain('# Dokumen Persyaratan Sistem Pembayaran Terpadu (SPT)');
  });

  it('keeps the error code and HTTP status across the thread boundary', async () => {
    const encrypted = await failure(extractIsolated(fixture('encrypted.docx'), 'kontrak.docx'));
    expect([encrypted.code, encrypted.status]).toEqual(['ENCRYPTED', 422]);

    const bomb = Buffer.from(zipSync({ 'word/document.xml': strToU8(`<w:document>${'A'.repeat(2_000_000)}</w:document>`) }));
    // declare 500 MB for the document part in the central directory
    const at = bomb.lastIndexOf(Buffer.from('word/document.xml')) - 46;
    bomb.writeUInt32LE(500 * 1024 * 1024, at + 24);
    const zipBomb = await failure(extractIsolated(bomb, 'bom.docx'));
    expect([zipBomb.code, zipBomb.status]).toEqual(['ZIP_BOMB', 413]);

    const slow = await failure(extractIsolated(fixture('business-case.pdf'), 'business-case.pdf', { timeoutMs: 1 }));
    expect([slow.code, slow.status]).toEqual(['TIMEOUT', 422]);
  });
});
