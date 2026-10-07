import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
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

let cachedUrl: URL | null | undefined;

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

  await acquire();
  try {
    return await new Promise<ExtractedDocument>((resolve, reject) => {
      const worker = new Worker(url, { resourceLimits: { maxOldGenerationSizeMb: MEMORY_MB } });
      let settled = false;
      const finish = (settle: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        settle();
      };
      const limitMs = (options.timeoutMs ?? DEFAULT_TIMEOUT_MS) + HARD_TIMEOUT_GRACE_MS;
      const timer = setTimeout(
        () =>
          finish(() =>
            reject(new DocumentError(`Membaca "${fileName}" melebihi batas waktu ${Math.round(limitMs / 1000)} detik. Pecah dokumen menjadi beberapa file.`)),
          ),
        limitMs,
      );
      worker.once('message', (msg: WorkerResponse) =>
        finish(() => (msg.ok ? resolve(msg.result) : reject(msg.status ? new DocumentError(msg.message, msg.status as 413 | 415 | 422) : new Error(msg.message)))),
      );
      worker.once('error', (err: Error & { code?: string }) =>
        finish(() =>
          reject(
            err.code === 'ERR_WORKER_OUT_OF_MEMORY'
              ? new DocumentError(`"${fileName}" terlalu besar atau rumit untuk dibaca (batas memori). Pecah dokumen menjadi beberapa file.`, 413)
              : new DocumentError(`"${fileName}" tidak bisa dibaca: ${err.message.slice(0, 300)}`),
          ),
        ),
      );
      worker.once('exit', (code) => finish(() => reject(new DocumentError(`Pembaca dokumen berhenti tak terduga (kode ${code}).`))));
      // copy into a buffer of our own and hand it over to the worker without another copy
      const bytes = new Uint8Array(buffer);
      worker.postMessage({ bytes, fileName, options }, [bytes.buffer]);
    });
  } finally {
    release();
  }
}
