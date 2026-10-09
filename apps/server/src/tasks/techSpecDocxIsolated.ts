import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { BuiltDocument } from '../generators/techspec/document.js';
import type { DocxRenderOptions, DocxRenderResult } from '../generators/techspec/docx.js';
import { createLogger } from '../logger.js';
import type { DocxWorkerRequest, DocxWorkerResponse } from './techSpecDocxWorker.js';

const log = createLogger('docx');

/** Built next to the server bundle by apps/server/build.mjs (and shipped with the desktop app and the self-host zip). */
const WORKER_FILE = 'docx-worker.mjs';
/** Word documents rendered at the same time; each worker may use up to MEMORY_MB of heap. */
const MAX_PARALLEL = 2;
const MEMORY_MB = 1024;

export interface DocxTimeouts {
  /** How long a render with the page layout (page numbers of the table of contents) may take. */
  withLayout: number;
  /** How long the render without it, tried when the first one timed out, may take. */
  withoutLayout: number;
}

export const DOCX_TIMEOUTS: Readonly<DocxTimeouts> = { withLayout: 30_000, withoutLayout: 30_000 };

let cachedUrl: URL | null | undefined;

/** Points rendering at a specific worker bundle (tests), or back to auto-detection with `undefined`. */
export function setDocxWorkerUrl(url: URL | null | undefined): void {
  cachedUrl = url;
}

function workerUrl(): URL | null {
  if (cachedUrl !== undefined) return cachedUrl;
  try {
    const url = new URL(`./${WORKER_FILE}`, import.meta.url);
    cachedUrl = existsSync(fileURLToPath(url)) ? url : null;
  } catch {
    cachedUrl = null;
  }
  if (!cachedUrl) log.debug('Word worker not found next to the server code; rendering in-process (development mode).');
  return cachedUrl;
}

let active = 0;
const waiting: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active < MAX_PARALLEL) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;
}

function release(): void {
  active -= 1;
  waiting.shift()?.();
}

/** One render in a fresh worker; 'timeout' when it took longer than `timeoutMs` (the worker is then stopped). */
function inWorker(url: URL, request: DocxWorkerRequest, timeoutMs: number): Promise<DocxRenderResult | 'timeout'> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(url, { resourceLimits: { maxOldGenerationSizeMb: MEMORY_MB } });
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      settle();
    };
    const timer = setTimeout(() => finish(() => resolve('timeout')), timeoutMs);
    worker.once('message', (msg: DocxWorkerResponse) =>
      finish(() =>
        msg.ok
          ? resolve({ buffer: Buffer.from(msg.buffer.buffer, msg.buffer.byteOffset, msg.buffer.byteLength), warnings: msg.warnings })
          : reject(new Error(msg.message)),
      ),
    );
    worker.once('error', (err: Error & { code?: string }) =>
      finish(() => reject(new Error(err.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'the document is too large to render (memory limit)' : err.message))),
    );
    worker.once('exit', (code) => finish(() => reject(new Error(`the Word renderer stopped unexpectedly (code ${code})`))));
    worker.postMessage(request);
  });
}

/**
 * Renders the Word document of a TSD (renderTechSpecDocx) in a worker thread with a memory cap and a hard time limit,
 * so a long or pathological TSD cannot block the server's event loop (in the desktop app: the Electron main process).
 * When laying the pages out takes longer than `timeouts.withLayout`, the document is rendered again without it (Word
 * then fills in the page numbers of the table of contents when it opens the file); when that also times out, it fails.
 *
 * Renders in-process when the worker bundle is not there, i.e. when running from the TypeScript sources (`npm run dev`,
 * tests). The server bundles leave that fallback out (build-plugins.mjs): they fail with a clear message instead.
 */
export async function renderTechSpecDocxIsolated(
  document: BuiltDocument,
  options: DocxRenderOptions & { timeouts?: Partial<DocxTimeouts> } = {},
): Promise<DocxRenderResult> {
  const { timeouts: custom, ...renderOptions } = options;
  const url = workerUrl();
  if (!url) {
    const { renderTechSpecDocx } = await import('../generators/techspec/docx.js');
    return renderTechSpecDocx(document, renderOptions);
  }
  const timeouts = { ...DOCX_TIMEOUTS, ...custom };
  await acquire();
  try {
    if (renderOptions.pageNumbers !== false) {
      const result = await inWorker(url, { document, options: renderOptions }, timeouts.withLayout);
      if (result !== 'timeout') return result;
      log.warn(`Laying out the pages of "${document.title}" took over ${timeouts.withLayout / 1000} s; rendering it without page numbers`);
    }
    const result = await inWorker(url, { document, options: { ...renderOptions, pageNumbers: false } }, timeouts.withoutLayout);
    if (result === 'timeout') throw new Error(`rendering the Word document took longer than ${Math.round(timeouts.withoutLayout / 1000)} s`);
    if (renderOptions.pageNumbers === false) return result;
    return {
      ...result,
      warnings: [
        ...result.warnings,
        'The document was too long to lay out its pages in time: Word fills in the page numbers of the table of contents when it opens the file',
      ],
    };
  } finally {
    release();
  }
}
