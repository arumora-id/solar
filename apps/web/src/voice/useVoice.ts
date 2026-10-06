import { useCallback, useEffect, useRef, useState } from 'react';
import { readPref, writePref } from '../lib/session';
import {
  browserSpeechAvailable,
  isElectron,
  microphoneAvailable,
  startBrowserRecognition,
  startWhisperRecognition,
  type RecognitionSession,
} from './recognition';

export interface VoicePrefs {
  lang: 'id-ID' | 'en-US';
  engine: 'auto' | 'browser' | 'whisper';
  whisperModel: string;
  autoSend: boolean;
  speakReplies: boolean;
}

export const WHISPER_MODELS = [
  { id: 'Xenova/whisper-small', label: 'Whisper small - akurat (±250 MB, sekali unduh)' },
  { id: 'Xenova/whisper-base', label: 'Whisper base - seimbang (±80 MB)' },
  { id: 'Xenova/whisper-tiny', label: 'Whisper tiny - paling ringan (±40 MB)' },
];

export const DEFAULT_VOICE_PREFS: VoicePrefs = {
  lang: 'id-ID',
  engine: 'auto',
  whisperModel: 'Xenova/whisper-small',
  autoSend: true,
  speakReplies: true,
};

export function loadVoicePrefs(): VoicePrefs {
  return { ...DEFAULT_VOICE_PREFS, ...readPref<Partial<VoicePrefs>>('voice', {}) };
}

export function saveVoicePrefs(prefs: VoicePrefs): void {
  writePref('voice', prefs);
  window.dispatchEvent(new CustomEvent('solar:voice-prefs'));
}

export function useVoicePrefs(): VoicePrefs {
  const [prefs, setPrefs] = useState(loadVoicePrefs);
  useEffect(() => {
    const on = () => setPrefs(loadVoicePrefs());
    window.addEventListener('solar:voice-prefs', on);
    return () => window.removeEventListener('solar:voice-prefs', on);
  }, []);
  return prefs;
}

/** Engine actually used: Whisper in the desktop app (no Google speech service in Electron). */
export function resolveEngine(prefs: VoicePrefs, browserFailed: boolean): 'browser' | 'whisper' | null {
  if (prefs.engine === 'browser') return browserSpeechAvailable() ? 'browser' : null;
  if (prefs.engine === 'whisper') return microphoneAvailable() ? 'whisper' : null;
  if (browserSpeechAvailable() && !browserFailed && !isElectron()) return 'browser';
  return microphoneAvailable() ? 'whisper' : null;
}

export function useVoice(onFinal: (text: string) => void) {
  const prefs = useVoicePrefs();
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const sessionRef = useRef<RecognitionSession | null>(null);
  const browserFailed = useRef(false);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;

  const engine = resolveEngine(prefs, browserFailed.current);

  const stop = useCallback(() => {
    sessionRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.stop();
      return;
    }
    const chosen = resolveEngine(prefs, browserFailed.current);
    if (!chosen) {
      setError('Input suara tidak didukung di perangkat/browser ini.');
      return;
    }
    setError('');
    setInterim('');
    setListening(true);
    const callbacks = {
      onInterim: (t: string) => setInterim(t),
      onFinal: (t: string) => {
        setInterim(t);
        finalRef.current(t);
      },
      onStatus: (s: string) => setStatus(s),
      onError: (message: string, fallback: boolean) => {
        if (fallback && chosen === 'browser') {
          browserFailed.current = true;
          setError(`${message} Beralih ke Whisper lokal - klik mikrofon lagi.`);
        } else setError(message);
      },
      onEnd: () => {
        sessionRef.current = null;
        setListening(false);
        setStatus('');
      },
    };
    try {
      sessionRef.current =
        chosen === 'browser' ? startBrowserRecognition(prefs.lang, callbacks) : startWhisperRecognition(prefs.lang, prefs.whisperModel, callbacks);
    } catch (err) {
      setListening(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [prefs]);

  useEffect(() => () => sessionRef.current?.abort(), []);

  return { prefs, engine, listening, interim, status, error, start, stop, clearError: () => setError('') };
}
