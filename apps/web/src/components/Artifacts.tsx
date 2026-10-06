import gsap from 'gsap';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Artifact } from '@solar/shared';
import { api } from '../lib/api';
import { formatBytes } from '../lib/format';
import { renderMarkdown } from '../lib/markdown';
import { DownloadIcon, EyeIcon, XIcon } from './Icons';

const GROUP_TITLE: Record<string, string> = {
  archimate: 'ArchiMate',
  sequence: 'Sequence diagram',
  tsd: 'Technical Specification',
  other: 'Lainnya',
};

function family(a: Artifact): string {
  return a.kind.split('-')[0] ?? 'other';
}

export function ArtifactList({ taskId, artifacts }: { taskId: string; artifacts: Artifact[] }) {
  const [preview, setPreview] = useState<Artifact | null>(null);
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    if (modalRef.current) gsap.from(modalRef.current, { y: 16, opacity: 0, duration: 0.25, ease: 'power2.out' });
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
