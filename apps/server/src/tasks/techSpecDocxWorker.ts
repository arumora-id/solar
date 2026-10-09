/**
 * Worker-thread entry (bundled to dist/docx-worker.mjs by build.mjs): renders one Word document of a Technical
 * Specification Document per message, so laying out its pages (seconds for a long TSD) and drawing the diagrams' PNG
 * fallbacks never block the server or, in the desktop app, the Electron main process. This bundle is the only one that
 * carries the docx library, the SVG rasterizer's WebAssembly and the fonts; the server bundles do not.
 */
import { parentPort } from 'node:worker_threads';
import type { BuiltDocument } from '../generators/techspec/document.js';
import { renderTechSpecDocx, type DocxRenderOptions } from '../generators/techspec/docx.js';

export interface DocxWorkerRequest {
  document: BuiltDocument;
  options: DocxRenderOptions;
}

export type DocxWorkerResponse = { ok: true; buffer: Uint8Array; warnings: string[] } | { ok: false; message: string };

parentPort?.on('message', (req: DocxWorkerRequest) => {
  renderTechSpecDocx(req.document, req.options).then(
    ({ buffer, warnings }) => {
      // a copy with an ArrayBuffer of its own, handed over to the server thread without another copy
      const bytes = new Uint8Array(buffer);
      parentPort!.postMessage({ ok: true, buffer: bytes, warnings } satisfies DocxWorkerResponse, [bytes.buffer]);
    },
    (err: unknown) => parentPort!.postMessage({ ok: false, message: err instanceof Error ? err.message : String(err) } satisfies DocxWorkerResponse),
  );
});
