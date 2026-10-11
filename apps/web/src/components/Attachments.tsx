import gsap from 'gsap';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Attachment } from '@solar/shared';
import { api } from '../lib/api';
import { formatBytes } from '../lib/format';
import { t as dict, useT } from '../lib/i18n';
import { renderDocumentMarkdown } from '../lib/markdown';
import { useSolar } from '../lib/store';
import { AlertIcon, DownloadIcon, FileIcon, SpinnerIcon, XIcon } from './Icons';

/** Short type label from the file name (shown before the name). */
export function typeLabel(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toUpperCase();
  return ext === 'MARKDOWN' ? 'MD' : ext.slice(0, 4) || 'FILE';
}

/** Pages, slides or sheets of a read document in the current language (call while rendering). */
function partsText(a: Attachment): string {
  if (!a.parts) return '';
  const words = dict().agent.attachments;
  return a.kind === 'pdf' ? words.pages(a.parts) : a.kind === 'pptx' ? words.slides(a.parts) : words.sheets(a.parts);
}

/** What a chip shows for a read document: pages/slides/sheets and size, e.g. "4 halaman · 23,9 KB" / "4 pages · 23.9 KB". */
export function attachmentSummary(a: Attachment): string {
  return [partsText(a), formatBytes(a.size)].filter(Boolean).join(' · ');
}

export interface ChipProps {
  name: string;
  size: number;
  /** Status line instead of the size, e.g. "Mengunggah 40%" / "Uploading 40%". */
  status?: string;
  busy?: boolean;
  error?: string;
  warnings?: string[];
  onOpen?: () => void;
  onRemove?: () => void;
}

export function AttachmentChip({ name, size, status, busy, error, warnings, onOpen, onRemove }: ChipProps) {
  const t = useT();
  const warn = !error && warnings && warnings.length > 0;
  const title = error ?? (warn ? warnings!.join('\n') : name);
  const body = (
    <>
      <span className="att-type">{typeLabel(name)}</span>
      <span className="att-name">{name}</span>
      <span className="att-meta">
        {busy && <SpinnerIcon />}
        {error ? t.common.failed : (status ?? formatBytes(size))}
      </span>
      {(error || warn) && (
        <span className={error ? 'att-flag error' : 'att-flag warn'} aria-label={error ? t.common.error : t.agent.attachments.warning}>
          <AlertIcon />
        </span>
      )}
    </>
  );
  return (
    <div className={`att-chip${error ? ' error' : ''}`} role="listitem" title={title}>
      {onOpen && !error && !busy ? (
        <button type="button" className="att-open" onClick={onOpen} aria-label={t.agent.attachments.open(name)}>
          {body}
        </button>
      ) : (
        <span className="att-open">{body}</span>
      )}
      {onRemove && (
        <button type="button" className="att-remove" onClick={onRemove} aria-label={t.agent.attachments.remove(name)}>
          <XIcon size={14} />
        </button>
      )}
      {error && <span className="att-error">{error}</span>}
    </div>
  );
}

/** Read-only chips of a task's attachments (under the user's message). */
export function AttachmentStrip({ ids }: { ids: string[] }) {
  const { attachments } = useSolar();
  const t = useT();
  const [preview, setPreview] = useState<Attachment | null>(null);
  if (ids.length === 0) return null;
  return (
    <div className="att-strip" role="list" aria-label={t.agent.attachments.stripLabel}>
      {ids.map((id) => {
        const a = attachments[id];
        return a ? (
          <AttachmentChip key={id} name={a.name} size={a.size} status={attachmentSummary(a)} warnings={a.warnings} onOpen={() => setPreview(a)} />
        ) : (
          <AttachmentChip key={id} name={t.agent.attachments.placeholderName} size={0} status="…" />
        );
      })}
      {preview && <AttachmentPreview attachment={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

/** Attachment rows with preview and download (monitor task detail). */
export function AttachmentTable({ ids }: { ids: string[] }) {
  const { attachments } = useSolar();
  const t = useT();
  const [preview, setPreview] = useState<Attachment | null>(null);
  const list = ids.map((id) => attachments[id]).filter((a): a is Attachment => Boolean(a));
  if (list.length === 0) return <p className="muted">{t.agent.attachments.loadingList}</p>;
  return (
    <div className="artifacts">
      {list.map((a) => (
        <div className="artifact-row" key={a.id}>
          <span className="name" title={a.warnings.join('\n') || a.name}>
            <FileIcon /> {a.name}
          </span>
          <span className="kind">
            {[typeLabel(a.name), partsText(a), formatBytes(a.size)].filter(Boolean).join(' · ')}
            {a.warnings.length > 0 && (
              <span className="att-flag warn" title={a.warnings.join('\n')} aria-label={t.agent.attachments.warning}>
                {' '}
                <AlertIcon />
              </span>
            )}
          </span>
          <button type="button" className="btn ghost small" onClick={() => setPreview(a)}>
            {t.agent.attachments.viewText}
          </button>
          <a className="btn ghost small icon" href={api.attachmentDownloadUrl(a.id)} aria-label={t.agent.attachments.download(a.name)}>
            <DownloadIcon />
          </a>
        </div>
      ))}
      {preview && <AttachmentPreview attachment={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

const PREVIEW_CHARS = 200_000;

/** Shows the text SOLAR extracted from a document - exactly what the agent reads. */
export function AttachmentPreview({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  const t = useT();
  const words = t.agent.attachments;
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');
  // plain text documents are shown as they are; others can switch between formatted and raw Markdown
  const [raw, setRaw] = useState(attachment.kind === 'text');
  const modalRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    api
      .attachmentText(attachment.id)
      .then(setText)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [attachment.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    if (modalRef.current) gsap.fromTo(modalRef.current, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.25, ease: 'power2.out', overwrite: true });
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const shown = text === null ? '' : text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}\n\n${words.truncated}` : text;
  // `words` in the deps: the page separators and renderDocumentMarkdown's image placeholders follow the language
  const html = useMemo(() => {
    if (text === null || raw) return '';
    // page markers would otherwise appear as escaped comments: show them as separators
    return renderDocumentMarkdown(
      shown
        .replace(/^<!--\s*page\s+(\d+)\s*-->$/gim, (_, n: string) => `\n---\n\n*${words.page(n)}*\n`)
        .replace(
          /^<!--\s*truncated:\s*pages\s+(\d+)-(\d+)\s+not included\s*-->$/gim,
          (_, from: string, to: string) => `\n---\n\n*${words.pagesNotRead(from, to)}*\n`,
        ),
    );
  }, [text, raw, shown, words]);

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={attachment.name}>
      <div className="modal wide" ref={modalRef}>
        <div className="row" style={{ marginBottom: 6 }}>
          <h3 style={{ flex: 1, margin: 0, overflowWrap: 'anywhere' }}>{attachment.name}</h3>
          <a className="btn small" href={api.attachmentDownloadUrl(attachment.id)}>
            <DownloadIcon /> {words.originalFile}
          </a>
          <button type="button" className="btn small icon" onClick={onClose} aria-label={t.common.close}>
            <XIcon />
          </button>
        </div>
        <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
          {[typeLabel(attachment.name), partsText(attachment), formatBytes(attachment.size), t.common.characters(attachment.chars)].filter(Boolean).join(' · ')}
          {' - '}
          {words.previewNote}
        </p>
        {attachment.kind !== 'text' && (
          <div className="seg" role="group" aria-label={words.viewLabel} style={{ marginBottom: 10, alignSelf: 'flex-start' }}>
            <button type="button" aria-pressed={!raw} onClick={() => setRaw(false)}>
              {words.formatted}
            </button>
            <button type="button" aria-pressed={raw} onClick={() => setRaw(true)}>
              {words.raw}
            </button>
          </div>
        )}
        {attachment.warnings.length > 0 && (
          <div className="warn-box">
            {attachment.warnings.map((w) => (
              <div key={w}>
                <AlertIcon /> {w}
              </div>
            ))}
          </div>
        )}
        {error && <div className="error-box">{error}</div>}
        {text === null && !error && (
          <p className="muted">
            <SpinnerIcon /> {words.loadingText}
          </p>
        )}
        {text !== null && raw && (
          <pre className="json preview-text" style={{ maxHeight: 'none' }}>
            {shown}
          </pre>
        )}
        {text !== null && !raw && (
          <div className="preview-frame markdown" style={{ overflow: 'auto', padding: 20, color: '#1f2328' }} dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
    </div>
  );
}
