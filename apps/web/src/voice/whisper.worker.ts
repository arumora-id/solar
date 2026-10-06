/// <reference lib="webworker" />
// Offline speech-to-text with Whisper (transformers.js, ONNX Runtime Web). The library is loaded
// from the CDN on first use and the model is cached by the browser afterwards.

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';

type Transcriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string } | Array<{ text: string }>>;

interface TranscribeRequest {
  type: 'transcribe';
  id: number;
  audio: Float32Array;
  language: string;
  model: string;
}

let transcriber: Transcriber | null = null;
let loadedModel = '';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (event: MessageEvent<TranscribeRequest>) => {
  const msg = event.data;
  if (msg.type !== 'transcribe') return;
  try {
    if (!transcriber || loadedModel !== msg.model) {
      ctx.postMessage({ type: 'status', id: msg.id, status: 'loading' });
      const lib = (await import(/* @vite-ignore */ TRANSFORMERS_URL)) as {
        pipeline: (task: string, model: string, options: Record<string, unknown>) => Promise<Transcriber>;
        env: { allowLocalModels: boolean };
      };
      lib.env.allowLocalModels = false;
      transcriber = await lib.pipeline('automatic-speech-recognition', msg.model, {
        progress_callback: (p: { status?: string; progress?: number; file?: string }) => {
          if (p.status === 'progress' && typeof p.progress === 'number') {
            ctx.postMessage({ type: 'progress', id: msg.id, file: p.file ?? '', progress: p.progress });
          }
        },
      });
      loadedModel = msg.model;
    }
    ctx.postMessage({ type: 'status', id: msg.id, status: 'transcribing' });
    const output = await transcriber(msg.audio, { language: msg.language, task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
    const text = Array.isArray(output) ? output.map((o) => o.text).join(' ') : output.text;
    ctx.postMessage({ type: 'result', id: msg.id, text: text.trim() });
  } catch (err) {
    ctx.postMessage({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
