/** Speech-to-text engines: the browser's Web Speech API, or Whisper running locally in a worker. */

export type VoiceEngine = 'browser' | 'whisper';

export interface RecognitionCallbacks {
  onInterim(text: string): void;
  onFinal(text: string): void;
  onStatus(status: string): void;
  onError(message: string, fallbackSuggested: boolean): void;
  onEnd(): void;
}

export interface RecognitionSession {
  stop(): void;
  abort(): void;
}

// ---- Web Speech API ---------------------------------------------------------

interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  isFinal: boolean;
  0: SpeechAlternative;
}
interface SpeechResultEvent {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechResult };
}
interface BrowserRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => BrowserRecognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isElectron(): boolean {
  return /Electron\//.test(navigator.userAgent);
}

/** Electron ships Chromium without Google's speech service, so the Web Speech API cannot work there. */
export function browserSpeechAvailable(): boolean {
  return recognitionCtor() !== null && !isElectron();
}

export function microphoneAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

export function startBrowserRecognition(lang: string, cb: RecognitionCallbacks): RecognitionSession {
  const Ctor = recognitionCtor();
  if (!Ctor) throw new Error('Web Speech API is not available');
  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!;
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    cb.onInterim((finalText + interim).trim());
  };
  rec.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    const fallback = e.error === 'network' || e.error === 'service-not-allowed' || e.error === 'language-not-supported';
    const text: Record<string, string> = {
      'not-allowed': 'Akses mikrofon ditolak. Izinkan mikrofon di pengaturan browser.',
      'audio-capture': 'Mikrofon tidak ditemukan.',
      network: 'Layanan pengenalan suara browser tidak dapat dihubungi.',
    };
    cb.onError(text[e.error] ?? `Pengenalan suara gagal (${e.error}).`, fallback);
  };
  rec.onend = () => {
    if (finalText.trim()) cb.onFinal(finalText.trim());
    cb.onEnd();
  };
  rec.start();
  cb.onStatus('Mendengarkan…');
  return { stop: () => rec.stop(), abort: () => rec.abort() };
}

// ---- Whisper (local) -------------------------------------------------------

let worker: Worker | null = null;
let requestId = 0;

function getWorker(): Worker {
  worker ??= new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

const WHISPER_LANG: Record<string, string> = { id: 'indonesian', en: 'english' };

async function decodeTo16k(blob: Blob): Promise<Float32Array> {
  const buffer = await blob.arrayBuffer();
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const audio = await ctx.decodeAudioData(buffer);
    return audio.getChannelData(0).slice();
  } finally {
    void ctx.close();
  }
}

/**
 * Records until the speaker is silent for ~1.5 s (or `stop()` is called, max 45 s),
 * then transcribes locally with Whisper.
 */
export function startWhisperRecognition(lang: string, model: string, cb: RecognitionCallbacks): RecognitionSession {
  let stopped = false;
  let aborted = false;
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  let raf = 0;
  let maxTimer = 0;
  const chunks: Blob[] = [];

  const cleanup = () => {
    cancelAnimationFrame(raf);
    window.clearTimeout(maxTimer);
    stream?.getTracks().forEach((t) => t.stop());
    void audioCtx?.close().catch(() => undefined);
  };

  const finish = async () => {
    cleanup();
    if (aborted) return cb.onEnd();
    const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' });
    if (blob.size < 2000) {
      cb.onEnd();
      return;
    }
    try {
      cb.onStatus('Mentranskripsi…');
      const audio = await decodeTo16k(blob);
      const id = ++requestId;
      const w = getWorker();
      const text = await new Promise<string>((resolve, reject) => {
        const onMessage = (ev: MessageEvent<{ type: string; id: number; text?: string; message?: string; progress?: number; status?: string }>) => {
          const m = ev.data;
          if (m.id !== id) return;
          if (m.type === 'progress') cb.onStatus(`Mengunduh model suara… ${Math.round(m.progress ?? 0)}%`);
          else if (m.type === 'status' && m.status === 'loading') cb.onStatus('Menyiapkan model suara (sekali saja)…');
          else if (m.type === 'status' && m.status === 'transcribing') cb.onStatus('Mentranskripsi…');
          else if (m.type === 'result') {
            w.removeEventListener('message', onMessage);
            resolve(m.text ?? '');
          } else if (m.type === 'error') {
            w.removeEventListener('message', onMessage);
            reject(new Error(m.message));
          }
        };
        w.addEventListener('message', onMessage);
        w.postMessage({ type: 'transcribe', id, audio, language: WHISPER_LANG[lang.slice(0, 2)] ?? 'indonesian', model }, [audio.buffer]);
      });
      if (text) cb.onFinal(text);
    } catch (err) {
      cb.onError(`Transkripsi gagal: ${err instanceof Error ? err.message : String(err)}`, false);
    }
    cb.onEnd();
  };

  void (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch {
      cb.onError('Akses mikrofon ditolak atau mikrofon tidak tersedia.', false);
      cb.onEnd();
      return;
    }
    if (stopped) {
      cleanup();
      cb.onEnd();
      return;
    }
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = () => void finish();
    recorder.start(250);
    cb.onStatus('Mendengarkan… (berhenti otomatis saat hening)');

    // simple voice activity detection
    audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let heard = false;
    let silentSince = performance.now();
    const loop = () => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      const rms = Math.sqrt(sum / data.length);
      const now = performance.now();
      if (rms > 0.02) {
        heard = true;
        silentSince = now;
      } else if (heard && now - silentSince > 1500 && recorder?.state === 'recording') {
        recorder.stop();
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    maxTimer = window.setTimeout(() => recorder?.state === 'recording' && recorder.stop(), 45_000);
  })();

  return {
    stop: () => {
      stopped = true;
      if (recorder?.state === 'recording') recorder.stop();
    },
    abort: () => {
      aborted = true;
      stopped = true;
      if (recorder?.state === 'recording') recorder.stop();
      else cleanup();
    },
  };
}
