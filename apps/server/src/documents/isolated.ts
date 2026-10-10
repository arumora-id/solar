import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { DEFAULT_LANG, t } from '../i18n.js';
import { createLogger } from '../logger.js';
import { DEFAULT_TIMEOUT_MS, extractDocument } from './index.js';
import { DocumentError, type ExtractedDocument, type ExtractOptions } from './types.js';
import type { WorkerResponse } from './worker.js';

const log = createLogger('documents');

/** Built next to the server bundle by apps/server/build.mjs (and shipped with the desktop app). */
const WORKER_FILE = 'extract-worker.mjs';
/** Parallel extractions; each worker may use up to MEMORY_MB of heap. */
const MAX_PARALLEL = 2;
const MEMORY_MB = 1024;
/** Extra time over the parser's own (cooperative) timeout before the worker is terminated. */
const HARD_TIMEOUT_GRACE_MS = 5_000;
/**
 * Memory one extraction may use, heap and ArrayBuffers together. resourceLimits only caps the V8 heap (and a
 * --max-old-space-size flag in NODE_OPTIONS overrides it), while pdf.js keeps decoded streams in ArrayBuffers, so the
 * parent also watches the worker's heap statistics and stops it above this budget.
 */
const MEMORY_BUDGET_BYTES = MEMORY_MB * 1024 * 1024;
const WATCH_INTERVAL_MS = 50;

let cachedUrl: URL | null | undefined;

/** Points extraction at a specific worker bundle (tests), or back to auto-detection with `undefined`. */
export function setExtractWorkerUrl(url: URL | null | undefined): void {
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
  if (!cachedUrl) log.debug('Document worker not found next to the server code; extracting in-process (development mode).');
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

/**
 * Extracts a document in a worker thread with a hard timeout and a memory cap, so a pathological file cannot block
 * the event loop or exhaust the server's memory. Falls back to in-process extraction when the worker bundle is not
 * available (running from TypeScript sources: `npm run dev`, tests).
 */
export async function extractIsolated(buffer: Buffer, fileName: string, options: ExtractOptions = {}): Promise<ExtractedDocument> {
  const url = workerUrl();
  if (!url) return extractDocument(buffer, fileName, options);

  // the messages of the errors below, as the parser's own, are in the language of the upload
  const lang = options.lang ?? DEFAULT_LANG;
  await acquire();
  try {
    return await new Promise<ExtractedDocument>((resolve, reject) => {
      const worker = new Worker(url, { resourceLimits: { maxOldGenerationSizeMb: MEMORY_MB } });
      let settled = false;
      const finish = (settle: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(watchdog);
        void worker.terminate();
        settle();
      };
      const tooMuchMemory = () => new DocumentError(t(lang, 'doc.worker.memory', { file: fileName }), 413, 'TOO_LARGE');
      const watchdog = setInterval(() => {
        if (typeof worker.getHeapStatistics !== 'function') return;
        worker.getHeapStatistics().then(
          (stats) => {
            if (stats.used_heap_size + (stats.external_memory ?? 0) > MEMORY_BUDGET_BYTES) finish(() => reject(tooMuchMemory()));
          },
          () => {},
        );
      }, WATCH_INTERVAL_MS);
      watchdog.unref();
      const limitMs = (options.timeoutMs ?? DEFAULT_TIMEOUT_MS) + HARD_TIMEOUT_GRACE_MS;
      const timer = setTimeout(
        () =>
          finish(() =>
            reject(new DocumentError(t(lang, 'doc.worker.timeout', { file: fileName, seconds: Math.round(limitMs / 1000) }), 422, 'TIMEOUT')),
          ),
        limitMs,
      );
      worker.once('message', (msg: WorkerResponse) =>
        finish(() =>
          msg.ok
            ? resolve(msg.result)
            : reject(msg.status ? new DocumentError(msg.message, msg.status as 413 | 415 | 422, msg.code ?? undefined) : new Error(msg.message)),
        ),
      );
      worker.once('error', (err: Error & { code?: string }) =>
        finish(() =>
          reject(
            err.code === 'ERR_WORKER_OUT_OF_MEMORY'
              ? tooMuchMemory()
              : new DocumentError(t(lang, 'doc.worker.failed', { file: fileName, error: err.message.slice(0, 300) })),
          ),
        ),
      );
      worker.once('exit', (code) => finish(() => reject(new DocumentError(t(lang, 'doc.worker.stopped', { code })))));
      // copy into a buffer of our own and hand it over to the worker without another copy
      const bytes = new Uint8Array(buffer);
      worker.postMessage({ bytes, fileName, options }, [bytes.buffer]);
    });
  } finally {
    release();
  }
}
