import { useCallback, useEffect, useRef, useState } from 'react';
import { localeOf, useT, type Dict } from '../lib/i18n';
import { readPref, writePref } from '../lib/session';
import {
  browserSpeechAvailable,
  isElectron,
  microphoneAvailable,
  startBrowserRecognition,
  startWhisperRecognition,
  type RecognitionSession,
  type VoiceText,
} from './recognition';

/** A speech language (BCP 47) SOLAR listens and speaks in. */
export type SpeechLocale = 'id-ID' | 'en-US';

export const SPEECH_LOCALES: readonly SpeechLocale[] = ['id-ID', 'en-US'];

export interface VoicePrefs {
  /** 'auto' (the default): the interface language; an explicit choice stays as it is when the interface switches. */
  lang: 'auto' | SpeechLocale;
  engine: 'auto' | 'browser' | 'whisper';
  whisperModel: string;
  autoSend: boolean;
  speakReplies: boolean;
}

/** Whisper models to pick from; the label is `t.voice.panel.whisperModels[size]`. */
export const WHISPER_MODELS: ReadonlyArray<{ id: string; size: 'small' | 'base' | 'tiny' }> = [
  { id: 'Xenova/whisper-small', size: 'small' },
  { id: 'Xenova/whisper-base', size: 'base' },
  { id: 'Xenova/whisper-tiny', size: 'tiny' },
];

export const DEFAULT_VOICE_PREFS: VoicePrefs = {
  lang: 'auto',
  engine: 'auto',
  whisperModel: 'Xenova/whisper-small',
  autoSend: true,
  speakReplies: true,
};

/**
 * Version of the stored preferences. Version 1 (no `v`) had no 'auto' language, defaulted to 'id-ID' and saved the
 * whole object on any change, so a stored 'id-ID' from then was usually never chosen.
 */
const PREFS_VERSION = 2;

type StoredVoicePrefs = Partial<VoicePrefs> & { v?: number };

export function loadVoicePrefs(): VoicePrefs {
  const stored = readPref<StoredVoicePrefs | null>('voice', null);
  const { v, ...saved }: StoredVoicePrefs = stored !== null && typeof stored === 'object' ? stored : {};
  const prefs: VoicePrefs = { ...DEFAULT_VOICE_PREFS, ...saved };
  // version 1's 'id-ID' was the old default and cannot be told apart from a choice: it follows the interface language
  // now (the same Indonesian while the interface is Indonesian). Its 'en-US' was chosen and stays.
  if (stored !== null && v === undefined && prefs.lang === 'id-ID') prefs.lang = 'auto';
  // an unknown stored value (a damaged preference) falls back to the interface language
  if (prefs.lang !== 'auto' && !SPEECH_LOCALES.includes(prefs.lang)) prefs.lang = 'auto';
  return prefs;
}

/** The speech language to use now: 'auto' follows the current interface language (id-ID / en-US). */
export function speechLocale(lang: VoicePrefs['lang']): SpeechLocale {
  return lang === 'auto' ? localeOf() : lang;
}

export function saveVoicePrefs(prefs: VoicePrefs): void {
  writePref<StoredVoicePrefs>('voice', { ...prefs, v: PREFS_VERSION });
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
  const t = useT();
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  // kept as dictionary lookups and rendered below, so a line on screen follows a language switch
  const [status, setStatus] = useState<VoiceText | null>(null);
  const [error, setError] = useState<VoiceText | null>(null);
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
      setError(() => (d: Dict) => d.voice.recognition.unsupported);
      return;
    }
    setError(null);
    setInterim('');
    setListening(true);
    const callbacks = {
      onInterim: (t: string) => setInterim(t),
      onFinal: (t: string) => {
        setInterim(t);
        finalRef.current(t);
      },
      // a function given to a state setter is an updater: wrap the text
      onStatus: (s: VoiceText) => setStatus(() => s),
      onError: (message: VoiceText, fallback: boolean) => {
        if (fallback && chosen === 'browser') {
          browserFailed.current = true;
          setError(() => (d: Dict) => d.voice.recognition.fallbackToWhisper(message(d)));
        } else setError(() => message);
      },
      onEnd: () => {
        sessionRef.current = null;
        setListening(false);
        setStatus(null);
      },
    };
    // 'auto' is resolved when listening starts: the interface language of that moment
    const lang = speechLocale(prefs.lang);
    try {
      sessionRef.current =
        chosen === 'browser' ? startBrowserRecognition(lang, callbacks) : startWhisperRecognition(lang, prefs.whisperModel, callbacks);
    } catch (err) {
      setListening(false);
      const message = err instanceof Error ? err.message : String(err);
      setError(() => () => message);
    }
  }, [prefs]);

  useEffect(() => () => sessionRef.current?.abort(), []);

  return {
    prefs,
    engine,
    listening,
    interim,
    status: status ? status(t) : '',
    error: error ? error(t) : '',
    start,
    stop,
    clearError: () => setError(null),
  };
}
