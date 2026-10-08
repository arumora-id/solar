import gsap from 'gsap';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Artifact, KnowledgeType } from '@solar/shared';
import { api, ApiError } from '../lib/api';
import { formatBytes } from '../lib/format';
import { TYPE_FOLDERS, TYPE_LABEL, TYPES } from '../lib/knowledgeTypes';
import { renderMarkdown } from '../lib/markdown';
import { BookIcon, DownloadIcon, EyeIcon, XIcon } from './Icons';

const GROUP_TITLE: Record<string, string> = {
  archimate: 'ArchiMate',
  sequence: 'Sequence diagram',
  tsd: 'Technical Specification',
  other: 'Lainnya',
};

function family(a: Artifact): string {
  return a.kind.split('-')[0] ?? 'other';
}

const isMarkdown = (a: Artifact) => a.kind === 'tsd-markdown' || a.mimeType.startsWith('text/markdown') || /\.md$/i.test(a.name);

export function ArtifactList({ taskId, artifacts }: { taskId: string; artifacts: Artifact[] }) {
  const [preview, setPreview] = useState<Artifact | null>(null);
  const [saving, setSaving] = useState<Artifact | null>(null);
  const groups = useMemo(() => {
    const map = new Map<string, Artifact[]>();
    for (const a of artifacts) map.set(a.bundle, [...(map.get(a.bundle) ?? []), a]);
    return [...map.values()];
  }, [artifacts]);

  if (artifacts.length === 0) return null;
  return (
    <div className="artifacts">
      {groups.map((items) => {
        const first = items[0]!;
        const svgs = items.filter((a) => a.mimeType.startsWith('image/svg'));
        return (
          <section className="artifact-group" key={first.bundle}>
            <h4>
              {GROUP_TITLE[family(first)] ?? 'Artefak'} · {first.title.replace(/\s*\(.*\)$/, '')}
            </h4>
            {svgs.length > 0 && (
              <div className="thumbs">
                {svgs.map((a) => (
                  <button type="button" key={a.id} className="thumb" onClick={() => setPreview(a)} title={`Pratinjau ${a.name}`}>
                    <img src={api.artifactUrl(a.id)} alt={a.title} loading="lazy" />
                  </button>
                ))}
              </div>
            )}
            {items.map((a) => (
              <div className="artifact-row" key={a.id}>
                <span className="name" title={a.description ?? a.title}>
                  {a.name}
                </span>
                <span className="kind">{formatBytes(a.size)}</span>
                <button type="button" className="btn ghost small icon" onClick={() => setPreview(a)} aria-label={`Pratinjau ${a.name}`}>
                  <EyeIcon />
                </button>
                <a className="btn ghost small icon" href={api.artifactUrl(a.id, true)} aria-label={`Unduh ${a.name}`}>
                  <DownloadIcon />
                </a>
                {isMarkdown(a) && (
                  <button
                    type="button"
                    className="btn ghost small icon"
                    onClick={() => setSaving(a)}
                    aria-label={`Simpan ${a.name} ke knowledge base`}
                    title="Simpan ke knowledge base"
                  >
                    <BookIcon />
                  </button>
                )}
              </div>
            ))}
          </section>
        );
      })}
      <div className="row">
        <a className="btn small" href={api.zipUrl(taskId)}>
          <DownloadIcon /> Unduh semua (ZIP)
        </a>
      </div>
      {preview && <ArtifactPreview artifact={preview} siblings={artifacts} onClose={() => setPreview(null)} />}
      {saving && <SaveToKnowledge artifact={saving} onClose={() => setSaving(null)} />}
    </div>
  );
}

/** Saves a Markdown artifact (e.g. the .md of a TSD) as a knowledge file, so the agent uses it in later tasks. */
function SaveToKnowledge({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
  const fileName = artifact.name.replace(/[^A-Za-z0-9._ -]+/g, '-');
  const [type, setType] = useState<KnowledgeType>('document');
  const [path, setPath] = useState(`${TYPE_FOLDERS.document}/${fileName}`);
  const [pathEdited, setPathEdited] = useState(false);
  const [id, setId] = useState(fileName.replace(/\.md$/i, ''));
  const [title, setTitle] = useState(artifact.title);
  const [aliases, setAliases] = useState('');
  const [conflict, setConflict] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState('');

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const save = async () => {
    setBusy(true);
    setError('');
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
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label="Simpan ke knowledge base">
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h3>Simpan ke knowledge base</h3>
        {savedAt ? (
          <>
            <p>
              Tersimpan sebagai <code>{savedAt}</code>. Agent membacanya mulai task berikutnya; kelola di Pengaturan → Knowledge.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn primary" onClick={onClose} autoFocus>
                Tutup
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="hint" style={{ marginTop: 0 }}>
              {artifact.name} disalin ke knowledge base sebagai file Markdown. Isinya diikuti agent di atas aturan bawaan, jadi simpan hanya
              dokumen yang sudah Anda periksa.
            </p>
            <label className="field">
              <span>Jenis</span>
              <select
                className="select"
                value={type}
                onChange={(e) => {
                  const t = e.target.value as KnowledgeType;
                  setType(t);
                  if (!pathEdited) setPath(`${TYPE_FOLDERS[t]}/${fileName}`);
                }}
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Path</span>
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
              <span>ID (nama di diagram dan dokumen)</span>
              <input className="input" value={id} onChange={(e) => setId(e.target.value)} />
            </label>
            <label className="field">
              <span>Judul</span>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="field">
              <span>Alias (pisahkan dengan koma, opsional)</span>
              <input className="input" value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="mis. AD1 Gateway, ADI Gate" />
            </label>
            {conflict && (
              <div className="error-box">
                {conflict}
                <label className="toggle" style={{ display: 'flex', marginTop: 8 }}>
                  <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                  Ganti file yang sudah ada
                </label>
              </div>
            )}
            {error && <div className="error-box">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={onClose}>
                Batal
              </button>
              <button type="submit" className="btn primary" disabled={busy || !path.trim() || (Boolean(conflict) && !overwrite)}>
                {busy ? 'Menyimpan…' : 'Simpan'}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

export function ArtifactPreview({ artifact, siblings, onClose }: { artifact: Artifact; siblings: Artifact[]; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');
  const modalRef = useRef<HTMLDivElement>(null);
  const isSvg = artifact.mimeType.startsWith('image/svg');
  const isHtml = artifact.mimeType.startsWith('text/html');
  const isMarkdown = artifact.kind === 'tsd-markdown';

  useEffect(() => {
    if (isSvg || isHtml) return;
    api
      .artifactText(artifact.id)
      .then(setText)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [artifact.id, isSvg, isHtml]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    if (modalRef.current) gsap.fromTo(modalRef.current, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.25, ease: 'power2.out', overwrite: true });
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const html = useMemo(() => {
    if (!isMarkdown || text === null) return '';
    return renderMarkdown(text, (src) => {
      const name = src.replace(/^\.\//, '');
      const match = siblings.find((s) => s.name === name);
      return match ? api.artifactUrl(match.id) : null;
    });
  }, [isMarkdown, text, siblings]);

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={artifact.title}>
      <div className="modal wide" ref={modalRef}>
        <div className="row" style={{ marginBottom: 10 }}>
          <h3 style={{ flex: 1, margin: 0 }}>{artifact.title}</h3>
          <a className="btn small" href={api.artifactUrl(artifact.id, true)}>
            <DownloadIcon /> Unduh
          </a>
          <button type="button" className="btn small icon" onClick={onClose} aria-label="Tutup">
            <XIcon />
          </button>
        </div>
        {error && <div className="error-box">{error}</div>}
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
