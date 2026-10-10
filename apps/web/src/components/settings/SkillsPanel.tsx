import { useCallback, useEffect, useState } from 'react';
import type { SkillDetail } from '@solar/shared';
import { api } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { PlusIcon } from '../Icons';
import { rich } from './richText';

interface Draft {
  id: string | null;
  name: string;
  description: string;
  content: string;
}

const EMPTY: Draft = { id: null, name: '', description: '', content: '' };

export function SkillsPanel() {
  const t = useT();
  const words = t.settings.skills;
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
        {rich(words.intro)}
      </p>
      <div className="row" style={{ marginBottom: 12 }}>
        <button type="button" className="btn primary small" onClick={() => setDraft({ ...EMPTY })}>
          <PlusIcon size={16} /> {words.add}
        </button>
        <label className="btn small">
          {words.importFile}
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
          <h4 style={{ marginTop: 0 }}>{draft.id ? words.editSkill(draft.id) : words.newSkill}</h4>
          <label className="field">
            <span>{t.common.name}</span>
            <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={words.namePlaceholder} />
          </label>
          <label className="field">
            <span>{words.description}</span>
            <input className="input" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </label>
          <label className="field">
            <span>{words.content}</span>
            <textarea className="textarea" rows={12} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
          </label>
          <div className="row">
            <button type="button" className="btn primary small" disabled={busy || !draft.name.trim() || !draft.content.trim()} onClick={() => void save()}>
              {t.common.save}
            </button>
            <button type="button" className="btn small" onClick={() => setDraft(null)}>
              {t.common.cancel}
            </button>
          </div>
        </div>
      )}

      {skills.map((s) => (
        <div className="card" key={s.id}>
          <div className="card-head">
            <h4>{s.name}</h4>
            <span className="badge">{t.settings.source[s.source]}</span>
            <label className="toggle">
              <input type="checkbox" checked={s.enabled} disabled={busy} onChange={(e) => void run(() => api.updateSkill(s.id, { enabled: e.target.checked }))} />
              {t.common.active}
            </label>
          </div>
          <p>{s.description || words.noDescription}</p>
          <p className="hint">
            id: <code>{s.id}</code>
            {s.files.length ? ` · ${words.files(s.files.join(', '))}` : ''}
          </p>
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" className="btn small" onClick={() => setDraft({ id: s.id, name: s.name, description: s.description, content: s.content })}>
              {t.common.edit}
            </button>
            {s.source === 'user' && (
              <button
                type="button"
                className="btn small danger"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(words.confirmDelete(s.name))) void run(() => api.deleteSkill(s.id));
                }}
              >
                {t.common.delete}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
