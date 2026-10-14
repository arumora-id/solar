import { useCallback, useEffect, useState } from 'react';
import type { ContentProposal } from '@solar/shared';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { useLang } from '../../lib/i18n';

/** Staff see their own submissions only. Reviewers see the pending queue and immutable payloads. */
export function ContentProposalsPanel() {
  const { can } = useAuth();
  const lang = useLang();
  const english = lang === 'en';
  const canSubmit = can('content.propose');
  const canReview = can('content.review');
  const [items, setItems] = useState<ContentProposal[]>([]);
  const [kind, setKind] = useState<'skill' | 'knowledge'>('skill');
  const [title, setTitle] = useState('');
  const [path, setPath] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setItems(await api.contentProposals()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (job: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try { await job(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const submit = () => void run(async () => {
    await api.createContentProposal({
      kind, title: title.trim(), content,
      ...(kind === 'knowledge' ? { path: path.trim() } : { description: description.trim() }),
    });
    setTitle(''); setContent(''); setPath(''); setDescription('');
  });

  return (
    <div className="content-proposals">
      <p className="hint">
        {english
          ? 'Staff suggestions remain unpublished until a Superadmin AND a Head of IT SOLAR approve. Existing administrative Skills and Knowledge are not visible to Staff.'
          : 'Usulan Staff tidak diterbitkan sebelum disetujui Superadmin DAN Head of IT SOLAR. Skill dan Knowledge administrator tidak ditampilkan kepada Staff.'}
      </p>
      {error && <div className="error-box" role="alert">{error}</div>}
      {canSubmit && (
        <section className="card" aria-label={english ? 'New proposal' : 'Ajukan konten'}>
          <h3>{english ? 'Submit Skill / Knowledge' : 'Ajukan Skill / Knowledge'}</h3>
          <label className="field">
            <span>{english ? 'Category' : 'Jenis'}</span>
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value as 'skill' | 'knowledge')}>
              <option value="skill">Skill</option><option value="knowledge">Knowledge</option>
            </select>
          </label>
          <label className="field">
            <span>{english ? 'Title' : 'Judul'}</span>
            <input className="input" maxLength={kind === 'skill' ? 80 : 120} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          {kind === 'knowledge' ? (
            <label className="field">
              <span>{english ? 'Knowledge path (new Markdown file)' : 'Path Knowledge (file Markdown baru)'}</span>
              <input className="input" placeholder="systems/new-system.md" value={path} onChange={(e) => setPath(e.target.value)} />
            </label>
          ) : (
            <label className="field">
              <span>{english ? 'Description' : 'Deskripsi'}</span>
              <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
          )}
          <label className="field">
            <span>{english ? 'Markdown content' : 'Isi Markdown'}</span>
            <textarea className="textarea" rows={10} value={content} onChange={(e) => setContent(e.target.value)} />
          </label>
          <button className="btn primary small" type="button" disabled={busy || !title.trim() || !content.trim() || (kind === 'knowledge' && !path.trim())} onClick={submit}>
            {english ? 'Submit for dual review' : 'Kirim untuk dua persetujuan'}
          </button>
        </section>
      )}
      <h3>{canReview ? (english ? 'Review queue' : 'Antrean review') : (english ? 'My proposals' : 'Usulan saya')}</h3>
      {items.length === 0 && <p className="muted">{english ? 'No proposals yet.' : 'Belum ada usulan.'}</p>}
      {items.map((p) => (
        <section className="card" key={p.id}>
          <div className="card-head">
            <h4>{p.title}</h4>
            <span className="badge">{p.kind} · {p.status}</span>
          </div>
          {p.path && <p className="hint">Path: <code>{p.path}</code></p>}
          <p className="hint">{english ? 'Submitted by' : 'Pengusul'}: {p.authorId}</p>
          <p className="hint">
            Superadmin: {p.approvals.superadmin ? '✓' : '—'} · Head of IT: {p.approvals.head_of_it ? '✓' : '—'}
          </p>
          {p.publishedId && <p className="hint">{english ? 'Published' : 'Diterbitkan'}: <code>{p.publishedId}</code></p>}
          {p.rejectionReason && <p>{english ? 'Reason' : 'Alasan'}: {p.rejectionReason}</p>}
          {canReview && (
            <details>
              <summary>{english ? 'View submitted content' : 'Lihat isi usulan'}</summary>
              <pre className="json" style={{ overflow: 'auto', maxHeight: 300, whiteSpace: 'pre-wrap' }}>{p.content}</pre>
            </details>
          )}
          {canReview && p.status === 'pending' && (
            <div style={{ marginTop: 10 }}>
              <label className="field">
                <span>{english ? 'Reason (required when rejecting)' : 'Alasan (wajib saat menolak)'}</span>
                <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <div className="row">
                <button className="btn primary small" disabled={busy} type="button"
                  onClick={() => void run(() => api.reviewContentProposal(p.id, true, ''))}>
                  {english ? 'Approve' : 'Setujui'}
                </button>
                <button className="btn small danger" disabled={busy || !reason.trim()} type="button"
                  onClick={() => void run(async () => { await api.reviewContentProposal(p.id, false, reason); setReason(''); })}>
                  {english ? 'Reject' : 'Tolak'}
                </button>
              </div>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
