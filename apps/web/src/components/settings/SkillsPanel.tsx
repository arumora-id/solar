import { useCallback, useEffect, useState } from 'react';
import type { SkillDetail } from '@solar/shared';
import { api } from '../../lib/api';
import { PlusIcon } from '../Icons';

interface Draft {
  id: string | null;
  name: string;
  description: string;
  content: string;
}

const EMPTY: Draft = { id: null, name: '', description: '', content: '' };

export function SkillsPanel() {
  const [skills, setSkills] = useState<SkillDetail[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSkills(await api.skills());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (op: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await op();
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    const input = { name: draft.name.trim(), description: draft.description.trim(), content: draft.content };
    const ok = await run(() => (draft.id ? api.updateSkill(draft.id, input) : api.createSkill(input)));
    if (ok) setDraft(null);
  };

  const importFile = async (file: File) => {
    const text = await file.text();
    await run(() => api.importSkill(text));
  };

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        Skill adalah instruksi “house style” yang dimuat agent saat relevan (format <code>SKILL.md</code>: front matter <code>name</code> dan{' '}
        <code>description</code>, lalu isi Markdown). Skill bawaan bisa dinonaktifkan atau di-override.
      </p>
      <div className="row" style={{ marginBottom: 12 }}>
        <button type="button" className="btn primary small" onClick={() => setDraft({ ...EMPTY })}>
          <PlusIcon size={16} /> Tambah skill
        </button>
        <label className="btn small">
          Impor SKILL.md
          <input
            type="file"
            accept=".md,text/markdown,text/plain"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {error && (
        <div className="error-box" style={{ marginBottom: 10 }}>
          {error}
        </div>
      )}

      {draft && (
        <div className="card">
          <h4 style={{ marginTop: 0 }}>{draft.id ? `Edit skill: ${draft.id}` : 'Skill baru'}</h4>
          <label className="field">
            <span>Nama</span>
            <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="mis. Cloud Cost Review" />
          </label>
          <label className="field">
            <span>Deskripsi (kapan skill dipakai)</span>
            <input className="input" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </label>
          <label className="field">
            <span>Instruksi (Markdown)</span>
            <textarea className="textarea" rows={12} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
          </label>
          <div className="row">
            <button type="button" className="btn primary small" disabled={busy || !draft.name.trim() || !draft.content.trim()} onClick={() => void save()}>
              Simpan
            </button>
            <button type="button" className="btn small" onClick={() => setDraft(null)}>
              Batal
            </button>
          </div>
        </div>
      )}

      {skills.map((s) => (
        <div className="card" key={s.id}>
          <div className="card-head">
            <h4>{s.name}</h4>
            <span className="badge">{s.source === 'builtin' ? 'Bawaan' : 'Pengguna'}</span>
            <label className="toggle">
              <input type="checkbox" checked={s.enabled} disabled={busy} onChange={(e) => void run(() => api.updateSkill(s.id, { enabled: e.target.checked }))} />
              Aktif
            </label>
          </div>
          <p>{s.description || 'Tanpa deskripsi'}</p>
          <p className="hint">
            id: <code>{s.id}</code>
            {s.files.length ? ` · file: ${s.files.join(', ')}` : ''}
          </p>
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" className="btn small" onClick={() => setDraft({ id: s.id, name: s.name, description: s.description, content: s.content })}>
              Edit
            </button>
            {s.source === 'user' && (
              <button
                type="button"
                className="btn small danger"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Hapus skill "${s.name}"? Skill bawaan dengan id yang sama akan dipulihkan.`)) void run(() => api.deleteSkill(s.id));
                }}
              >
                Hapus
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
