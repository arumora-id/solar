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
  /** Cancels an upload: aborts it while the body is being sent, otherwise marks it to be deleted once the server answers. */
  const cancels = useRef(new Map<string, () => void>());
  /** Keys whose document must be deleted when its upload completes (removed while the server was reading it). */
  const discarded = useRef(new Set<string>());
  /** Keys of the chips submitted with the request in flight (they cannot be removed meanwhile). */
  const [sentKeys, setSentKeys] = useState<Set<string>>(() => new Set());

  const limits = config?.attachments;
  const extensions = limits?.extensions ?? ATTACHMENT_EXTENSIONS;
  const maxFileMb = limits?.maxFileMb ?? 25;
  const maxPerTask = limits?.maxPerTask ?? 10;
  const busy = files.some((f) => f.status === 'uploading' || f.status === 'reading');

  const update = (key: string, patch: Partial<PendingFile>) => setFiles((list) => list.map((f) => (f.key === key ? { ...f, ...patch } : f)));

  /** Drops every pending file: cancels uploads and deletes uploaded-but-unsent documents on the server. */
  const discardAll = useCallback(() => {
    for (const cancel of cancels.current.values()) cancel();
    cancels.current.clear();
    for (const f of filesRef.current) if (f.attachment) void api.deleteAttachment(f.attachment.id).catch(() => undefined);
    setFiles([]);
  }, []);

  // attachments belong to one conversation: a new conversation starts without them; documents uploaded earlier
  // in this conversation but never sent (page reload, app restart) come back as chips
  const sessionRef = useRef(sessionId);
  useEffect(() => {
    if (sessionRef.current !== sessionId) {
      sessionRef.current = sessionId;
      discardAll();
    }
    let alive = true;
    api
      .listAttachments(sessionId, true)
      .then((unsent) => {
        if (!alive || unsent.length === 0) return;
        rememberAttachments(unsent);
        setFiles((list) => [
          ...unsent
            .filter((a) => !list.some((f) => f.attachment?.id === a.id))
            .map((a): PendingFile => ({ key: `f${++keySeq}`, name: a.name, size: a.size, status: 'ready', progress: 1, attachment: a })),
          ...list,
        ]);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [sessionId, discardAll, rememberAttachments]);

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
        let bodySent = false;
        const handle = uploadAttachment(file, sessionId, (phase, fraction) => {
          if (phase === 'read') bodySent = true;
          update(key, phase === 'upload' ? { status: 'uploading', progress: fraction } : { status: 'reading', progress: 1 });
        });
        // once the body is on the server it will be stored anyway: wait for the id and delete it instead of aborting
        cancels.current.set(key, () => (bodySent ? discarded.current.add(key) : handle.abort()));
        handle.promise
          .then((attachment) => {
            if (discarded.current.delete(key)) {
              void api.deleteAttachment(attachment.id).catch(() => undefined);
              return;
            }
            rememberAttachments([attachment]);
            // the restore of unsent documents may already show this one: keep a single chip
            setFiles((list) =>
              list.some((f) => f.key !== key && f.attachment?.id === attachment.id)
                ? list.filter((f) => f.key !== key)
                : list.map((f) => (f.key === key ? { ...f, status: 'ready', attachment } : f)),
            );
          })
          .catch((err: unknown) => {
            discarded.current.delete(key);
            if (err instanceof DOMException && err.name === 'AbortError') return;
            update(key, { status: 'error', error: err instanceof Error ? err.message : String(err) });
          })
          .finally(() => cancels.current.delete(key));
      }
    },
    [extensions, maxFileMb, maxPerTask, sessionId, rememberAttachments],
  );

  const removeFile = (key: string) => {
    if (sentKeys.has(key)) return;
    const f = filesRef.current.find((x) => x.key === key);
    cancels.current.get(key)?.();
    cancels.current.delete(key);
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
      const sent = filesRef.current.filter((f) => f.status === 'ready' && f.attachment);
      const keys = new Set(sent.map((f) => f.key));
      setSending(true);
      setSentKeys(keys);
      setError('');
      try {
        await onSubmit(
          prompt,
          sent.map((f) => f.attachment!.id),
        );
        setValue('');
        // the sent documents now belong to the task (kept on the server); chips added meanwhile stay
        setFiles((list) => list.filter((f) => !keys.has(f.key)));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSending(false);
        setSentKeys(new Set());
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
              onRemove={sentKeys.has(f.key) ? undefined : () => removeFile(f.key)}
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
            if (pasted.length === 0) return;
            // Excel/Word/PowerPoint put a picture next to the copied text: that is a text paste, not an attachment
            const types = Array.from(e.clipboardData.types);
            const hasText = types.includes('text/plain') || types.includes('text/html');
            if (hasText && pasted.every((f) => f.type.startsWith('image/'))) return;
            e.preventDefault();
            addFiles(pasted);
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
