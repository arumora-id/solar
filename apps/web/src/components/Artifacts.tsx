import gsap from 'gsap';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Artifact, KnowledgeType } from '@solar/shared';
import { api, ApiError } from '../lib/api';
import { formatBytes } from '../lib/format';
import { useT, type Dict } from '../lib/i18n';
import { TYPE_FOLDERS, TYPES } from '../lib/knowledgeTypes';
import { renderMarkdown } from '../lib/markdown';
import { useSolar } from '../lib/store';
import { BookIcon, DownloadIcon, EyeIcon, SpinnerIcon, WordIcon, XIcon } from './Icons';

function family(a: Artifact): string {
  return a.kind.split('-')[0] ?? 'other';
}

/** Heading of a group by the family of its kind ("ArchiMate", "Technical Specification"); unknown families too. */
function groupTitle(a: Artifact, t: Dict): string {
  const groups = t.artifacts.groups;
  const f = family(a);
  return Object.hasOwn(groups, f) ? groups[f as keyof typeof groups] : t.artifacts.groupFallback;
}

const isMarkdown = (a: Artifact) => a.kind === 'tsd-markdown' || a.mimeType.startsWith('text/markdown') || /\.md$/i.test(a.name);
const isWord = (a: Artifact) => a.kind === 'tsd-docx' || /\.docx$/i.test(a.name);
/** Files the browser can show as text or image; anything else (e.g. .docx) is offered as a download only. */
const isViewable = (a: Artifact) => /^(text\/|image\/svg)|[/+](json|xml)\b/.test(a.mimeType);

/** Splits "order-platform-tsd.tsd.json" into "order-platform-tsd" and ".tsd.json": a long name wraps before the extension. */
function splitName(name: string): [string, string] {
  const ext = /(\.[A-Za-z][A-Za-z0-9]{0,11}){1,2}$/.exec(name)?.[0] ?? '';
  return ext && ext.length < name.length ? [name.slice(0, -ext.length), ext] : [name, ''];
}

/** The tools title every file "<name> (<format>)"; the group shows the name once ("Order Platform (Word)" -> "Order Platform"). */
const baseTitle = (a: Artifact) => a.title.replace(/\s*\([^()]*\)$/, '');

/**
 * Moves focus into a dialog when it opens (to its `data-autofocus` element, else the dialog itself, unless an element
 * inside already took it with autoFocus) and keeps Tab and Shift+Tab inside it, so keyboard users neither stay on the
 * page behind the backdrop nor wander back to it.
 */
function useDialogFocus(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.contains(document.activeElement)) (dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, iframe, [tabindex]:not([tabindex="-1"])')];
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const inside = dialog.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first || document.activeElement === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ref]);
}

type WordErrorReason = keyof Dict['artifacts']['word']['errors'];

/**
 * Why a "Buat Word" request failed, as a key of `t.artifacts.word.errors` (translated while rendering, so it follows
 * a language switch); the server's own message is kept as detail.
 */
function wordError(e: unknown): { reason: WordErrorReason; detail?: string } {
  if (!(e instanceof ApiError)) return { reason: 'offline' };
  if (e.status === 400) return { reason: 'invalid', detail: e.message };
  if (e.status === 404) return { reason: 'notFound', detail: e.message };
  return { reason: 'server', detail: e.message };
}

/**
 * A failed request: the server's own message (already in the interface language), or none when the server was not
 * reached (fetch's own message is browser jargon); shown as `failure.message ?? t.artifacts.offline`, so the
 * fallback follows a language switch.
 */
type Failure = { message?: string };

function failure(e: unknown): Failure {
  return e instanceof ApiError ? { message: e.message } : {};
}

/** Splits a text at its "{path}" marker, so the path can be shown as code in the middle of a translated sentence. */
function aroundPath(text: string): [string, string] {
  const at = text.indexOf('{path}');
  return at < 0 ? [`${text} `, ''] : [text.slice(0, at), text.slice(at + '{path}'.length)];
}

export function ArtifactList({ taskId, artifacts, active = false }: { taskId: string; artifacts: Artifact[]; active?: boolean }) {
  const t = useT();
  const { rememberArtifact } = useSolar();
  const [preview, setPreview] = useState<Artifact | null>(null);
  const [saving, setSaving] = useState<Artifact | null>(null);
  // where focus returns when a dialog closes (also after the Word dialog switched to the HTML preview)
  const opener = useRef<HTMLElement | null>(null);
  const remember = () => {
    if (!preview && !saving) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const restoreFocus = () => {
    const target = opener.current;
    opener.current = null;
    if (target?.isConnected) requestAnimationFrame(() => target.focus());
  };
  const openPreview = (a: Artifact) => {
    remember();
    setPreview(a);
  };
  const openSave = (a: Artifact) => {
    remember();
    setSaving(a);
  };
  const groups = useMemo(() => {
    const map = new Map<string, Artifact[]>();
    for (const a of artifacts) map.set(a.bundle, [...(map.get(a.bundle) ?? []), a]);
    return [...map.values()];
  }, [artifacts]);

  if (artifacts.length === 0) return null;
  return (
    <div className="artifacts">
      {groups.map((items) => (
        <ArtifactGroup
          key={items[0]!.bundle}
          items={items}
          active={active}
          onPreview={openPreview}
          onSave={openSave}
          onCreated={(a) => rememberArtifact(taskId, a)}
        />
      ))}
      <div className="row">
        <a className="btn small" href={api.zipUrl(taskId)}>
          <DownloadIcon /> {t.artifacts.downloadAll}
        </a>
      </div>
      {/* dialogs go to <body>: inside an animated chat bubble (a transformed ancestor) a fixed backdrop would be clipped to the bubble */}
      {preview &&
        createPortal(
          <ArtifactPreview
            key={preview.id}
            artifact={preview}
            siblings={artifacts}
            onOpen={setPreview}
            onClose={() => {
              setPreview(null);
              restoreFocus();
            }}
          />,
          document.body,
        )}
      {saving &&
        createPortal(
          <SaveToKnowledge
            artifact={saving}
            onClose={() => {
              setSaving(null);
              restoreFocus();
            }}
          />,
          document.body,
        )}
    </div>
  );
}

/**
 * The files of one bundle (one tool call). A Technical Specification's Word file is its delivery document: it is
 * listed first and downloadable from the group header; a TSD made before Word files existed gets a button that
 * creates one from its .tsd.json. While the task still runs the button is not offered: the agent's tool saves the
 * Word file itself (before the .tsd.json), and a click in between would make a second one.
 */
function ArtifactGroup({
  items,
  active,
  onPreview,
  onSave,
  onCreated,
}: {
  items: Artifact[];
  active: boolean;
  onPreview: (a: Artifact) => void;
  onSave: (a: Artifact) => void;
  onCreated: (a: Artifact) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ reason: WordErrorReason; detail?: string } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  // after "Buat Word" the button is replaced by the download link, which then takes over the keyboard focus
  const focusWord = useRef(false);
  const wordLink = useRef<HTMLAnchorElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const first = items[0]!;
  const svgs = items.filter((a) => a.mimeType.startsWith('image/svg'));
  const word = items.find((a) => a.kind === 'tsd-docx');
  const model = items.find((a) => a.kind === 'tsd-model');
  const rows = word ? [word, ...items.filter((a) => a !== word)] : items;
  const anyMarkdown = items.some(isMarkdown);

  useEffect(() => {
    if (!word || !focusWord.current) return;
    focusWord.current = false;
    // only when the focus was lost with the button (the user did not move on to something else meanwhile)
    if (!document.activeElement || document.activeElement === document.body) wordLink.current?.focus();
  }, [word]);

  const createWord = async () => {
    // the button stays focusable while busy (aria-disabled), so a second press is ignored here
    if (!model || busy) return;
    // decided now: the stream's 'artifact' event usually adds the Word file (and removes this button) before the answer
    focusWord.current = document.activeElement === createButton.current;
    setBusy(true);
    setError(null);
    setWarnings([]);
    setReady(false);
    try {
      const result = await api.exportWord(model.id);
      onCreated(result.artifact);
      setWarnings(result.warnings);
      setReady(true);
    } catch (e) {
      focusWord.current = false;
      // anything but an HTTP answer means the request did not get through (fetch's own message is browser jargon)
      setError(wordError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="artifact-group">
      <div className="artifact-group-head">
        <h4>
          {groupTitle(first, t)} · {baseTitle(first)}
        </h4>
        {word ? (
          <a className="btn small primary" ref={wordLink} href={api.artifactUrl(word.id, true)} title={t.artifacts.word.downloadTitle(word.name)}>
            <WordIcon /> {t.artifacts.word.download}
          </a>
        ) : (
          model &&
          !active && (
            <button
              type="button"
              ref={createButton}
              className="btn small"
              onClick={() => void createWord()}
              aria-disabled={busy || undefined}
              aria-busy={busy || undefined}
              title={t.artifacts.word.createTitle}
            >
              {busy ? <SpinnerIcon size={16} /> : <WordIcon />} {busy ? t.artifacts.word.creating : t.artifacts.word.create}
            </button>
          )
        )}
      </div>
      {error && (
        <div className="error-box artifact-note" role="alert">
          {t.artifacts.word.failed(t.artifacts.word.errors[error.reason])}
          {error.detail && (
            <details className="artifact-note-detail">
              <summary>{t.common.details}</summary>
              {error.detail}
            </details>
          )}
        </div>
      )}
      {model && (
        // always rendered: a live region inserted together with its text is not announced by every screen reader
        <div role="status">
          {warnings.length > 0 ? (
            <div className="hint artifact-note">
              {t.artifacts.word.createdWithNotes(warnings.length)}
              <details className="artifact-note-detail">
                <summary>{t.common.details}</summary>
                <ul>
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            </div>
          ) : (
            ready && <span className="sr-only">{t.artifacts.word.ready}</span>
          )}
        </div>
      )}
      {svgs.length > 0 && (
        <div className="thumbs">
          {svgs.map((a) => (
            <button type="button" key={a.id} className="thumb" onClick={() => onPreview(a)} title={t.artifacts.row.preview(a.name)}>
              <img src={api.artifactUrl(a.id)} alt={a.title} loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {rows.map((a) => {
        const [stem, ext] = splitName(a.name);
        return (
          <div className="artifact-row" key={a.id}>
            {isWord(a) && <WordIcon className="row-icon" />}
            <span className="name" title={a.description ? `${a.name} · ${a.description}` : a.name}>
              {stem}
              {ext && <wbr />}
              {ext}
            </span>
            <span className="kind">{formatBytes(a.size)}</span>
            <button
              type="button"
              className="btn ghost small icon"
              onClick={() => onPreview(a)}
              aria-label={isViewable(a) ? t.artifacts.row.preview(a.name) : t.artifacts.row.info(a.name)}
              title={isViewable(a) ? undefined : t.artifacts.row.notViewable}
            >
              <EyeIcon />
            </button>
            <a className="btn ghost small icon" href={api.artifactUrl(a.id, true)} aria-label={t.artifacts.row.download(a.name)}>
              <DownloadIcon />
            </a>
            {isMarkdown(a) ? (
              <button
                type="button"
                className="btn ghost small icon"
                onClick={() => onSave(a)}
                aria-label={t.artifacts.row.saveToKnowledge(a.name)}
                title={t.artifacts.saveToKnowledge.title}
              >
                <BookIcon />
              </button>
            ) : (
              anyMarkdown && <span className="btn-slot" aria-hidden="true" />
            )}
          </div>
        );
      })}
    </section>
  );
}

/** Folders/files starting with "_" (e.g. _templates/) and README.md are guidance for people; the agent does not read them. */
const isGuidancePath = (path: string) => path.split('/').some((seg) => seg.startsWith('_')) || /^readme\.md$/i.test(path);

/** Saves a Markdown artifact (e.g. the .md of a TSD) as a knowledge file, so the agent uses it in later tasks. */
function SaveToKnowledge({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
  const t = useT();
  const fileName = artifact.name.replace(/[^A-Za-z0-9._ -]+/g, '-');
  const [type, setType] = useState<KnowledgeType>('document');
  const [path, setPath] = useState(`${TYPE_FOLDERS.document}/${fileName}`);
  const [pathEdited, setPathEdited] = useState(false);
  const [id, setId] = useState(fileName.replace(/\.md$/i, ''));
  // empty: the server keeps the document's own title (the artifact title carries a "(Markdown)" suffix)
  const [title, setTitle] = useState('');
  const [aliases, setAliases] = useState('');
  const [conflict, setConflict] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [savedAt, setSavedAt] = useState('');

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const formRef = useRef<HTMLFormElement>(null);
  useDialogFocus(formRef);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const { entry } = await api.importArtifactToKnowledge({
        artifactId: artifact.id,
        type,
        path: path.trim(),
        id: id.trim() || undefined,
        title: title.trim() || undefined,
        aliases: aliases.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean),
        overwrite,
      });
      setSavedAt(entry.path);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(e.message);
      else setError(failure(e));
    } finally {
      setBusy(false);
    }
  };

  const st = t.artifacts.saveToKnowledge;
  const [savedBefore, savedAfter] = aroundPath(st.savedAs);
  // where the knowledge base is managed: "Pengaturan → Knowledge"
  const manageAt = `${t.app.settings.title} → ${t.app.settings.tabs.knowledge}`;

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={st.title}>
      <form
        className="modal"
        ref={formRef}
        tabIndex={-1}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h3>{st.title}</h3>
        {savedAt ? (
          <>
            <p>
              {savedBefore}
              <code>{savedAt}</code>
              {savedAfter} {isGuidancePath(savedAt) ? st.savedGuidance(manageAt) : st.savedForAgent(manageAt)}
            </p>
            <div className="modal-actions">
              <button type="button" className="btn primary" onClick={onClose} autoFocus>
                {t.common.close}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="hint" style={{ marginTop: 0 }}>
              {st.intro(artifact.name)}
            </p>
            <label className="field">
              <span>{t.common.type}</span>
              <select
                className="select"
                value={type}
                onChange={(e) => {
                  const next = e.target.value as KnowledgeType;
                  setType(next);
                  if (!pathEdited) {
                    setPath(`${TYPE_FOLDERS[next]}/${fileName}`);
                    // the 409 and the consent to replace were for the old path
                    setConflict('');
                    setOverwrite(false);
                  }
                }}
              >
                {TYPES.map((k) => (
                  <option key={k} value={k}>
                    {t.artifacts.knowledgeType[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t.common.path}</span>
              <input
                className="input"
                value={path}
                onChange={(e) => {
                  setPath(e.target.value);
                  setPathEdited(true);
                  setConflict('');
                  setOverwrite(false);
                }}
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>{st.idLabel}</span>
              <input className="input" value={id} onChange={(e) => setId(e.target.value)} />
            </label>
            <label className="field">
              <span>{t.common.title}</span>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={st.titlePlaceholder} />
            </label>
            <label className="field">
              <span>{st.aliasesLabel}</span>
              <input className="input" value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder={st.aliasesPlaceholder} />
            </label>
            {conflict && (
              <div className="error-box">
                {conflict}
                <label className="toggle" style={{ display: 'flex', marginTop: 8 }}>
                  <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                  {st.overwrite}
                </label>
              </div>
            )}
            {error && <div className="error-box">{error.message ?? t.artifacts.offline}</div>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={onClose}>
                {t.common.cancel}
              </button>
              <button type="submit" className="btn primary" disabled={busy || !path.trim() || (Boolean(conflict) && !overwrite)}>
                {busy ? t.common.saving : t.common.save}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

export function ArtifactPreview({
  artifact,
  siblings,
  onOpen,
  onClose,
}: {
  artifact: Artifact;
  siblings: Artifact[];
  /** Shows another artifact instead (the HTML version of a Word file). */
  onOpen?: (a: Artifact) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<Failure | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const isSvg = artifact.mimeType.startsWith('image/svg');
  const isHtml = artifact.mimeType.startsWith('text/html');
  const isMarkdown = artifact.kind === 'tsd-markdown';
  // binary files (Word) are never fetched as text: the dialog offers the download instead
  const isFile = !isViewable(artifact);

  useEffect(() => {
    if (isSvg || isHtml || isFile) return;
    api
      .artifactText(artifact.id)
      .then(setText)
      .catch((e: unknown) => setError(failure(e)));
  }, [artifact.id, isSvg, isHtml, isFile]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    if (modalRef.current) gsap.fromTo(modalRef.current, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.25, ease: 'power2.out', overwrite: true });
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useDialogFocus(modalRef);

  const html = useMemo(() => {
    if (!isMarkdown || text === null) return '';
    return renderMarkdown(text, (src) => {
      const name = src.replace(/^\.\//, '');
      const match = siblings.find((s) => s.name === name);
      return match ? api.artifactUrl(match.id) : null;
    });
  }, [isMarkdown, text, siblings]);

  if (isFile) {
    const word = isWord(artifact);
    // the .html of the same TSD has the same content and can be shown here
    const html = word ? siblings.find((s) => s.bundle === artifact.bundle && s.kind === 'tsd-html') : undefined;
    return (
      <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={artifact.title}>
        <div className="modal" ref={modalRef} tabIndex={-1}>
          <div className="row" style={{ marginBottom: 10, flexWrap: 'nowrap' }}>
            <h3 style={{ flex: 1, margin: 0, minWidth: 0 }}>{artifact.title}</h3>
            <button type="button" className="btn small icon" onClick={onClose} aria-label={t.common.close}>
              <XIcon />
            </button>
          </div>
          <div className="file-panel">
            {word ? <WordIcon size={44} className="file-panel-icon" /> : <DownloadIcon size={40} className="file-panel-icon" />}
            <div className="file-panel-name">
              {artifact.name} · {formatBytes(artifact.size)}
            </div>
            <p>
              {word ? t.artifacts.word.noPreview : t.artifacts.preview.noPreview}
            </p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <a className="btn primary" href={api.artifactUrl(artifact.id, true)} data-autofocus>
                <DownloadIcon /> {word ? t.artifacts.word.download : t.common.download}
              </a>
              {html && onOpen && (
                <button type="button" className="btn" onClick={() => onOpen(html)}>
                  <EyeIcon /> {t.artifacts.word.previewHtml}
                </button>
              )}
            </div>
            {html && onOpen && <p className="hint">{t.artifacts.word.htmlHint}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={artifact.title}>
      <div className="modal wide" ref={modalRef} tabIndex={-1}>
        <div className="row" style={{ marginBottom: 10 }}>
          <h3 style={{ flex: 1, margin: 0 }}>{artifact.title}</h3>
          <a className="btn small" href={api.artifactUrl(artifact.id, true)}>
            <DownloadIcon /> {t.common.download}
          </a>
          <button type="button" className="btn small icon" onClick={onClose} aria-label={t.common.close}>
            <XIcon />
          </button>
        </div>
        {error && <div className="error-box">{error.message ?? t.artifacts.offline}</div>}
        {isSvg && (
          <div className="preview-frame" style={{ overflow: 'auto', padding: 8 }}>
            <img src={api.artifactUrl(artifact.id)} alt={artifact.title} style={{ maxWidth: 'none' }} />
          </div>
        )}
        {isHtml && <iframe className="preview-frame" src={api.artifactUrl(artifact.id)} sandbox="" title={artifact.title} />}
        {isMarkdown && text !== null && <div className="preview-frame markdown" style={{ overflow: 'auto', padding: 20, color: '#1f2328' }} dangerouslySetInnerHTML={{ __html: html }} />}
        {!isSvg && !isHtml && !isMarkdown && text !== null && (
          <pre className="json preview-text" style={{ maxHeight: 'none' }}>
            {text}
          </pre>
        )}
      </div>
    </div>
  );
}
