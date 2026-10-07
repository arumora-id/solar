/**
 * Worker-thread entry (bundled to dist/extract-worker.mjs): parses one document per message so that a slow,
 * synchronous or memory-hungry parser can never block or crash the server (or the Electron main process).
 */
import { parentPort } from 'node:worker_threads';
import { extractDocument } from './index.js';
import { DocumentError, type ExtractOptions } from './types.js';

export interface WorkerRequest {
  bytes: Uint8Array;
  fileName: string;
  options: ExtractOptions;
}

export type WorkerResponse =
  | { ok: true; result: Awaited<ReturnType<typeof extractDocument>> }
  | { ok: false; message: string; status: number | null };

parentPort?.on('message', (req: WorkerRequest) => {
  extractDocument(Buffer.from(req.bytes.buffer, req.bytes.byteOffset, req.bytes.byteLength), req.fileName, req.options)
    .then((result) => parentPort!.postMessage({ ok: true, result } satisfies WorkerResponse))
    .catch((err: unknown) =>
      parentPort!.postMessage({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        status: err instanceof DocumentError ? err.status : null,
      } satisfies WorkerResponse),
    );
});
