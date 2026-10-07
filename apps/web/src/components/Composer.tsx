import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ATTACHMENT_EXTENSIONS, type Attachment } from '@solar/shared';
import { api, uploadAttachment } from '../lib/api';
import { useSolar } from '../lib/store';
import { useVoice } from '../voice/useVoice';
import { AttachmentChip, AttachmentPreview } from './Attachments';
import { MicIcon, PaperclipIcon, SendIcon } from './Icons';

export interface ComposerHandle {
  insert(text: string): void;
  toggleVoice(): void;
  /** Attaches files (from the file picker, drag & drop or paste). */
  addFiles(files: File[]): void;
}

interface Props {
  disabled?: boolean;
  onSubmit(text: string, attachmentIds: string[]): Promise<void>;
  onListeningChange?(listening: boolean): void;
}

interface PendingFile {
  key: string;
  name: string;
  size: number;
  status: 'uploading' | 'reading' | 'ready' | 'error';
  progress: number;
  attachment?: Attachment;
  error?: string;
}

const LEGACY_HINT: Record<string, string> = {
  '.doc': '.docx',
  '.xls': '.xlsx',
  '.ppt': '.pptx',
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

let keySeq = 0;

export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ disabled, onSubmit, onListeningChange }, ref) {
  const { config, sessionId, rememberAttachments } = useSolar();
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [preview, setPreview] = useState<Attachment | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const filesRef = useRef(files);
  filesRef.current = files;
  const aborts = useRef(new Map<string, () => void>());

  const limits = config?.attachments;
  const extensions = limits?.extensions ?? ATTACHMENT_EXTENSIONS;
  const maxFileMb = limits?.maxFileMb ?? 25;
  const maxPerTask = limits?.maxPerTask ?? 10;
  const busy = files.some((f) => f.status === 'uploading' || f.status === 'reading');

  const update = (key: string, patch: Partial<PendingFile>) => setFiles((list) => list.map((f) => (f.key === key ? { ...f, ...patch } : f)));

  /** Drops every pending file: aborts uploads and deletes uploaded-but-unsent documents on the server. */
  const discardAll = useCallback(() => {
    for (const abort of aborts.current.values()) abort();
    aborts.current.clear();
    for (const f of filesRef.current) if (f.attachment) void api.deleteAttachment(f.attachment.id).catch(() => undefined);
    setFiles([]);
  }, []);

  // attachments belong to one conversation: a new conversation starts without them
  const sessionRef = useRef(sessionId);
  useEffect(() => {
    if (sessionRef.current !== sessionId) {
      sessionRef.current = sessionId;
      discardAll();
    }
  }, [sessionId, discardAll]);
  useEffect(() => () => discardAll(), [discardAll]);

  const addFiles = useCallback(
    (incoming: File[]) => {
      if (incoming.length === 0) return;
      let count = filesRef.current.filter((f) => f.status !== 'error').length;
      const accepted: Array<{ key: string; file: File }> = [];
      const added: PendingFile[] = [];
      for (const file of incoming) {
        const key = `f${++keySeq}`;
        const ext = extensionOf(file.name);
        let problem: string | undefined;
        if (LEGACY_HINT[ext]) problem = `Format lama ${ext} belum didukung - simpan ulang sebagai ${LEGACY_HINT[ext]} atau PDF.`;
        else if (!extensions.includes(ext)) problem = 'Jenis file tidak didukung. Gunakan PDF, Word (.docx), Excel (.xlsx/.csv), PowerPoint (.pptx), Markdown atau .txt.';
        else if (file.size === 0) problem = 'File kosong.';
        else if (file.size > maxFileMb * 1024 * 1024) problem = `Terlalu besar (maks ${maxFileMb} MB).`;
        else if (count >= maxPerTask) problem = `Maksimal ${maxPerTask} lampiran per permintaan.`;
        if (problem) {
          added.push({ key, name: file.name, size: file.size, status: 'error', progress: 0, error: problem });
          continue;
        }
        count += 1;
        added.push({ key, name: file.name, size: file.size, status: 'uploading', progress: 0 });
        accepted.push({ key, file });
      }
      setFiles((list) => [...list, ...added]);
      setError('');

      for (const { key, file } of accepted) {
        const handle = uploadAttachment(file, sessionId, (phase, fraction) =>
          update(key, phase === 'upload' ? { status: 'uploading', progress: fraction } : { status: 'reading', progress: 1 }),
        );
        aborts.current.set(key, handle.abort);
        handle.promise
          .then((attachment) => {
            if (!filesRef.current.some((f) => f.key === key)) {
              // removed while it was being read: do not leave it on the server
              void api.deleteAttachment(attachment.id).catch(() => undefined);
              return;
            }
            rememberAttachments([attachment]);
            update(key, { status: 'ready', attachment });
          })
          .catch((err: unknown) => {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            update(key, { status: 'error', error: err instanceof Error ? err.message : String(err) });
          })
          .finally(() => aborts.current.delete(key));
      }
    },
    [extensions, maxFileMb, maxPerTask, sessionId, rememberAttachments],
  );

  const removeFile = (key: string) => {
    const f = filesRef.current.find((x) => x.key === key);
    aborts.current.get(key)?.();
    aborts.current.delete(key);
    if (f?.attachment) void api.deleteAttachment(f.attachment.id).catch(() => undefined);
    setFiles((list) => list.filter((x) => x.key !== key));
  };

  const send = useCallback(
    async (text: string) => {
      const prompt = text.trim();
      if (!prompt || sending) return;
      if (filesRef.current.some((f) => f.status === 'uploading' || f.status === 'reading')) {
        setError('Tunggu sampai semua lampiran selesai dibaca.');
        return;
      }
      const ids = filesRef.current.filter((f) => f.status === 'ready' && f.attachment).map((f) => f.attachment!.id);
      setSending(true);
      setError('');
      try {
        await onSubmit(prompt, ids);
        setValue('');
        // the documents now belong to the task: keep them on the server
        setFiles([]);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSending(false);
      }
    },
    [onSubmit, sending],
  );

  const voice = useVoice((transcript) => {
    const uploading = filesRef.current.some((f) => f.status === 'uploading' || f.status === 'reading');
    if (voice.prefs.autoSend && !uploading) {
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
    addFiles,
  }));

  // auto-grow
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(180, el.scrollHeight)}px`;
  }, [value]);

  const statusText =
    voice.error || (voice.listening ? voice.interim || voice.status || 'Mendengarkan…' : error || (busy ? 'Membaca dokumen lampiran…' : ''));
  const isError = Boolean(voice.error || (!voice.listening && error));

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send(value);
      }}
    >
      {files.length > 0 && (
        <div className="att-list" role="list" aria-label="Lampiran untuk permintaan ini">
          {files.map((f) => (
            <AttachmentChip
              key={f.key}
              name={f.name}
              size={f.size}
              busy={f.status === 'uploading' || f.status === 'reading'}
              status={f.status === 'uploading' ? `Mengunggah ${Math.round(f.progress * 100)}%` : f.status === 'reading' ? 'Membaca…' : undefined}
              error={f.error}
              warnings={f.attachment?.warnings}
              onOpen={f.attachment ? () => setPreview(f.attachment!) : undefined}
              onRemove={() => removeFile(f.key)}
            />
          ))}
        </div>
      )}
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
        <button
          type="button"
          className="attach-btn"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          aria-label="Lampirkan dokumen"
          title={`Lampirkan dokumen proyek: PDF, Word, Excel, PowerPoint, Markdown, teks (maks ${maxFileMb} MB, ${maxPerTask} file). Bisa juga seret file ke percakapan.`}
        >
          <PaperclipIcon />
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept={extensions.join(',')}
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
        <label className="sr-only" htmlFor="prompt">
          Perintah untuk SOLAR
        </label>
        <textarea
          id="prompt"
          ref={areaRef}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={files.length ? 'Apa yang harus dibuat dari dokumen ini?' : 'Ketik perintah… (Enter kirim, Shift+Enter baris baru)'}
          onChange={(e) => setValue(e.target.value)}
          onPaste={(e) => {
            const pasted = Array.from(e.clipboardData.files);
            if (pasted.length) {
              e.preventDefault();
              addFiles(pasted);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(value);
            }
          }}
        />
        <button type="submit" className="btn primary send" disabled={disabled || sending || busy || !value.trim()} aria-label="Kirim">
          <SendIcon />
        </button>
      </div>
      <div className="voice-status" role="status" style={isError ? { color: 'var(--critical-text)' } : undefined}>
        {statusText}
      </div>
      {preview && <AttachmentPreview attachment={preview} onClose={() => setPreview(null)} />}
    </form>
  );
});
