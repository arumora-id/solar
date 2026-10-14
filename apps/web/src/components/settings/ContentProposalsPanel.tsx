import { useCallback, useEffect, useState } from 'react';
import type { ContentProposal, ContentProposalInput, ContentProposalStatus } from '@solar/shared';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { useLang } from '../../lib/i18n';

const STATUS_LABELS: Record<ContentProposalStatus, { id: string; en: string }> = {
  draft: { id: 'Draft', en: 'Draft' },
  submitted: { id: 'Diajukan', en: 'Submitted' },
  approved: { id: 'Disetujui', en: 'Approved' },
  rejected: { id: 'Ditolak', en: 'Rejected' },
  published: { id: 'Diterbitkan', en: 'Published' },
};

/** Admin-managed content stays private; Staff see only their own draft and submission records. */
export function ContentProposalsPanel() {
  const { can, role } = useAuth();
  const english = useLang() === 'en';
  const canSubmit = can('content.propose');
  const canReview = can('content.review');
  const [items, setItems] = useState<ContentProposal[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
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
    setBusy(true); setError('');
    try { await job(); await load(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; }
    finally { setBusy(false); }
  };

  const resetDraft = () => {
    setEditingId(null); setKind('skill'); setTitle(''); setContent(''); setPath(''); setDescription('');
  };
  const editDraft = (p: ContentProposal) => {
    setEditingId(p.id); setKind(p.kind); setTitle(p.title);
    setContent(p.content); setPath(p.path ?? ''); setDescription(p.description ?? '');
  };
  const input = (): ContentProposalInput => ({
    kind, title: title.trim(), content: content.trim(),
    ...(kind === 'knowledge' ? { path: path.trim() } : { description: description.trim() }),
  });
  const saveDraft = async () => {
    const data = input();
    if (await run(() => editingId ? api.updateContentProposal(editingId, data) : api.createContentProposal(data))) resetDraft();
  };

  return (
    <div className="content-proposals">
      <p className="hint">
        {english
          ? 'Draft → Submitted → Approved / Rejected → Published. Staff suggestions remain private and inactive until both Superadmin and Head of IT SOLAR approve, then a reviewer explicitly publishes.'
          : 'Draft → Submitted → Approved / Rejected → Published. Usulan Staff tetap privat dan belum aktif sampai Superadmin dan Head of IT SOLAR menyetujui, lalu salah satu reviewer menerbitkannya secara terpisah.'}
      </p>
      {error && <div className="error-box" role="alert">{error}</div>}
      {canSubmit && (
        <section className="card" aria-label={english ? 'Draft editor' : 'Editor draft'}>
          <h3>{editingId ? (english ? 'Edit Draft' : 'Edit Draft') : (english ? 'New Draft' : 'Draft Baru')}</h3>
          <label className="field"><span>{english ? 'Category' : 'Jenis'}</span>
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value as 'skill' | 'knowledge')}>
              <option value="skill">Skill</option><option value="knowledge">Knowledge</option>
            </select>
          </label>
          <label className="field"><span>{english ? 'Title' : 'Judul'}</span>
            <input className="input" maxLength={kind === 'skill' ? 80 : 120} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          {kind === 'knowledge'
            ? <label className="field"><span>{english ? 'New Markdown path' : 'Path Markdown baru'}</span>
                <input className="input" placeholder="systems/new-system.md" value={path} onChange={(e) => setPath(e.target.value)} />
              </label>
            : <label className="field"><span>{english ? 'Description' : 'Deskripsi'}</span>
                <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
              </label>}
          <label className="field"><span>{english ? 'Markdown content' : 'Isi Markdown'}</span>
            <textarea className="textarea" rows={9} value={content} onChange={(e) => setContent(e.target.value)} />
          </label>
          <div className="row">
            <button className="btn primary small" type="button" disabled={busy || !title.trim() || !content.trim() || (kind === 'knowledge' && !path.trim())}
              onClick={() => void saveDraft()}>{english ? 'Save Draft' : 'Simpan Draft'}</button>
            {editingId && <button className="btn small" type="button" onClick={resetDraft}>{english ? 'Cancel editing' : 'Batal mengedit'}</button>}
          </div>
        </section>
      )}
      <h3>{canReview ? (english ? 'Review and publication queue' : 'Antrean review dan publikasi') : (english ? 'My Drafts and proposals' : 'Draft dan usulan saya')}</h3>
      {items.length === 0 && <p className="muted">{english ? 'No proposals yet.' : 'Belum ada usulan.'}</p>}
      {items.map((p) => {
        const alreadyApprovedByRole = role === 'superadmin' || role === 'head_of_it' ? Boolean(p.approvals[role]) : false;
        return (
          <section className="card" key={p.id}>
            <div className="card-head"><h4>{p.title}</h4>
              <span className="badge" aria-label={p.status}>{p.kind} · {STATUS_LABELS[p.status][english ? 'en' : 'id']}</span>
            </div>
            {p.path && <p className="hint">Path: <code>{p.path}</code></p>}
            <p className="hint">{english ? 'Author' : 'Pengusul'}: {p.authorId}</p>
            <p className="hint">Superadmin: {p.approvals.superadmin ? '✓' : '—'} · Head of IT: {p.approvals.head_of_it ? '✓' : '—'}</p>
            {p.publishedId && <p className="hint">{english ? 'Published as' : 'Diterbitkan sebagai'}: <code>{p.publishedId}</code></p>}
            {p.rejectionReason && <p>{english ? 'Rejection reason' : 'Alasan penolakan'}: {p.rejectionReason}</p>}
            <details><summary>{english ? 'View submitted content' : 'Lihat isi konten'}</summary>
              <pre className="json" style={{ overflow: 'auto', maxHeight: 300, whiteSpace: 'pre-wrap' }}>{p.content}</pre>
            </details>
            {canSubmit && p.status === 'draft' && (
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn small" disabled={busy} type="button" onClick={() => editDraft(p)}>
                  {english ? 'Edit Draft' : 'Edit Draft'}
                </button>
                <button className="btn primary small" disabled={busy} type="button"
                  onClick={() => void run(() => api.submitContentProposal(p.id))}>
                  {english ? 'Submit for review' : 'Ajukan untuk review'}
                </button>
              </div>
            )}
            {canReview && p.status === 'submitted' && !alreadyApprovedByRole && (
              <div style={{ marginTop: 10 }}>
                <label className="field"><span>{english ? 'Rejection reason (required)' : 'Alasan penolakan (wajib)'}</span>
                  <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
                </label>
                <div className="row">
                  <button className="btn primary small" type="button" disabled={busy}
                    onClick={() => void run(() => api.reviewContentProposal(p.id, true, ''))}>
                    {english ? 'Approve' : 'Setujui'}
                  </button>
                  <button className="btn small danger" type="button" disabled={busy || !reason.trim()}
                    onClick={() => void run(async () => { await api.reviewContentProposal(p.id, false, reason); setReason(''); })}>
                    {english ? 'Reject' : 'Tolak'}
                  </button>
                </div>
              </div>
            )}
            {canReview && p.status === 'approved' && (
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn primary small" type="button" disabled={busy}
                  onClick={() => {
                    if (window.confirm(english ? 'Publish this approved content into the live Skill/Knowledge store?' : 'Terbitkan konten yang disetujui ke Skill/Knowledge aktif?')) {
                      void run(() => api.publishContentProposal(p.id));
                    }
                  }}>
                  {english ? 'Publish' : 'Terbitkan'}
                </button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
