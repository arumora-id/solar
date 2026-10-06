import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useVoice } from '../voice/useVoice';
import { MicIcon, SendIcon } from './Icons';

export interface ComposerHandle {
  insert(text: string): void;
  toggleVoice(): void;
}

interface Props {
  disabled?: boolean;
  onSubmit(text: string): Promise<void>;
  onListeningChange?(listening: boolean): void;
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ disabled, onSubmit, onListeningChange }, ref) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const send = useCallback(
    async (text: string) => {
      const prompt = text.trim();
      if (!prompt || sending) return;
      setSending(true);
      setError('');
      try {
        await onSubmit(prompt);
        setValue('');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSending(false);
      }
    },
    [onSubmit, sending],
  );

  const voice = useVoice((transcript) => {
    if (voice.prefs.autoSend) {
      // keep what is already in the composer (e.g. a quick-prompt template) in front of the spoken text
      const base = valueRef.current.trim();
      void send(base ? `${base} ${transcript}` : transcript);
    } else setValue((v) => (v ? `${v} ${transcript}` : transcript));
  });

  useEffect(() => onListeningChange?.(voice.listening), [voice.listening, onListeningChange]);

  useImperativeHandle(ref, () => ({
    insert(text: string) {
      setValue(text);
      requestAnimationFrame(() => {
        const el = areaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(text.length, text.length);
      });
    },
    toggleVoice() {
      voice.start();
    },
  }));

  // auto-grow
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(180, el.scrollHeight)}px`;
  }, [value]);

  const statusText = voice.error || (voice.listening ? voice.interim || voice.status || 'Mendengarkan…' : error);

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send(value);
      }}
    >
      <div className="composer-row">
        <button
          type="button"
          className={`mic${voice.listening ? ' on' : ''}`}
          onClick={() => voice.start()}
          disabled={disabled || voice.engine === null}
          aria-pressed={voice.listening}
          aria-label={voice.listening ? 'Berhenti mendengarkan' : 'Bicara (input suara)'}
          title={voice.engine === null ? 'Input suara tidak tersedia' : voice.engine === 'whisper' ? 'Input suara (Whisper lokal)' : 'Input suara'}
        >
          <MicIcon />
        </button>
        <label className="sr-only" htmlFor="prompt">
          Perintah untuk SOLAR
        </label>
        <textarea
          id="prompt"
          ref={areaRef}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder="Ketik perintah… (Enter kirim, Shift+Enter baris baru)"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(value);
            }
          }}
        />
        <button type="submit" className="btn primary send" disabled={disabled || sending || !value.trim()} aria-label="Kirim">
          <SendIcon />
        </button>
      </div>
      <div className="voice-status" role="status" style={voice.error || (!voice.listening && error) ? { color: 'var(--critical-text)' } : undefined}>
        {statusText}
      </div>
    </form>
  );
});
