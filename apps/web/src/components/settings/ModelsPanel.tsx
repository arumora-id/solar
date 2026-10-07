import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LlmModelConfig, LlmProviderConfig, LlmProviderKind, LlmProviderView, LlmSettingsView } from '@solar/shared';
import { SECRET_MASK } from '@solar/shared';
import { api } from '../../lib/api';
import { useSolar } from '../../lib/store';
import { PlusIcon, RefreshIcon, TrashIcon } from '../Icons';

const KIND_LABEL: Record<LlmProviderKind, string> = {
  'openai-chat': 'Chat Completions (OpenAI-compatible)',
  'openai-responses': 'OpenAI Responses API',
};

/** Starting points; the base URL of self-hosted gateways must be adjusted. */
const PRESETS: Array<{ label: string; name: string; kind: LlmProviderKind; baseUrl: string; apiKey: string; hint: string }> = [
  { label: 'OmniRoute', name: 'OmniRoute', kind: 'openai-chat', baseUrl: 'http://localhost:PORT/v1', apiKey: '', hint: 'Ganti host/port sesuai instalasi OmniRoute Anda.' },
  { label: 'OpenAI', name: 'OpenAI (Chat)', kind: 'openai-chat', baseUrl: 'https://api.openai.com/v1', apiKey: '', hint: '' },
  { label: 'OpenRouter', name: 'OpenRouter', kind: 'openai-chat', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '', hint: '' },
  { label: 'Anthropic', name: 'Anthropic (OpenAI-compatible)', kind: 'openai-chat', baseUrl: 'https://api.anthropic.com/v1', apiKey: '', hint: '' },
  { label: 'Gemini', name: 'Google Gemini (OpenAI-compatible)', kind: 'openai-chat', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: '', hint: '' },
  { label: 'Ollama', name: 'Ollama (lokal)', kind: 'openai-chat', baseUrl: 'http://localhost:11434/v1', apiKey: '', hint: 'Tanpa API key. Tambahkan model yang sudah di-pull.' },
];

interface Draft {
  id: string;
  name: string;
  kind: LlmProviderKind;
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  headers: string;
  maxTokensParam: '' | 'max_tokens' | 'max_completion_tokens';
  vision: boolean;
  models: string;
  isNew: boolean;
  hint: string;
}

/** One model per line: "id; max=16384; reasoning; effort=high; price=0.5/0.05/2; label=Nama" */
export function modelsToLines(models: LlmModelConfig[]): string {
  return models
    .map((m) =>
      [
        m.id,
        m.label ? `label=${m.label}` : '',
        m.maxOutputTokens ? `max=${m.maxOutputTokens}` : '',
        m.reasoning === true ? 'reasoning' : m.reasoning === false ? 'no-reasoning' : '',
        m.effort ? `effort=${m.effort}` : '',
        m.price ? `price=${m.price.input}/${m.price.cachedInput}/${m.price.output}` : '',
      ]
        .filter(Boolean)
        .join('; '),
    )
    .join('\n');
}

export function linesToModels(text: string): LlmModelConfig[] {
  const out: LlmModelConfig[] = [];
  for (const line of text.split('\n')) {
    const [id, ...opts] = line.split(';').map((s) => s.trim());
    if (!id) continue;
    const m: LlmModelConfig = { id };
    for (const o of opts) {
      const [k, v = ''] = o.split('=').map((s) => s.trim());
      if (k === 'label' && v) m.label = v;
      else if (k === 'max' && Number(v) > 0) m.maxOutputTokens = Math.round(Number(v));
      else if (k === 'reasoning') m.reasoning = true;
      else if (k === 'no-reasoning') m.reasoning = false;
      else if (k === 'effort' && v) m.effort = v;
      else if (k === 'price') {
        const [input, cachedInput, output] = v.split('/').map(Number);
        if ([input, cachedInput, output].every((n) => Number.isFinite(n) && n! >= 0)) m.price = { input: input!, cachedInput: cachedInput!, output: output! };
      }
    }
    out.push(m);
  }
  return out;
}

const toLines = (rec?: Record<string, string>) =>
  Object.entries(rec ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

function fromLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function toDraft(p?: LlmProviderView): Draft {
  return {
    id: p?.id ?? '',
    name: p?.name ?? '',
    kind: p?.kind ?? 'openai-chat',
    enabled: p?.enabled ?? true,
    baseUrl: p?.baseUrl ?? '',
    apiKey: p?.apiKey ?? '',
    headers: toLines(p?.headers),
    maxTokensParam: p?.maxTokensParam ?? '',
    vision: p?.vision ?? true,
    models: modelsToLines(p?.models ?? []),
    isNew: !p,
    hint: '',
  };
}

export function ModelsPanel() {
  const [view, setView] = useState<LlmSettingsView | null>(null);
  const [route, setRoute] = useState<string[]>([]);
  const [routeDirty, setRouteDirty] = useState(false);
  const [newEntry, setNewEntry] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tests, setTests] = useState<Record<string, { ok: boolean; text: string; models?: string[] }>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { reloadConfig } = useSolar();

  const apply = useCallback(
    (v: LlmSettingsView) => {
      setView(v);
      setRoute(v.routes.default ?? []);
      setRouteDirty(false);
      // the status bubble and System tab show whether the primary model is ready
      void reloadConfig();
    },
    [reloadConfig],
  );

  const load = useCallback(async () => {
    try {
      apply(await api.llm());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [apply]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (op: () => Promise<LlmSettingsView | void>) => {
    setBusy(true);
    setError('');
    try {
      const v = await op();
      if (v) apply(v);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const choices = useMemo(() => {
    const out: string[] = [];
    for (const p of view?.providers ?? []) {
      if (!p.enabled) continue;
      for (const m of p.models) out.push(`${p.id}/${m.id}`);
      for (const m of tests[p.id]?.models ?? []) out.push(`${p.id}/${m}`);
    }
    return [...new Set(out)].filter((c) => !route.includes(c));
  }, [view, tests, route]);

  const move = (i: number, d: number) => {
    const next = [...route];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    setRoute(next);
    setRouteDirty(true);
  };

  const save = async () => {
    if (!draft) return;
    const input: Partial<LlmProviderConfig> = {
      name: draft.name.trim(),
      kind: draft.kind,
      enabled: draft.enabled,
      baseUrl: draft.baseUrl.trim() || undefined,
      apiKey: draft.apiKey,
      headers: fromLines(draft.headers),
      maxTokensParam: draft.maxTokensParam || undefined,
      vision: draft.vision,
      models: linesToModels(draft.models),
    };
    const ok = await run(() => (draft.isNew ? api.createProvider({ ...input, id: draft.id.trim() || undefined }) : api.updateProvider(draft.id, input)));
    if (ok) setDraft(null);
  };

  const test = async (id: string) => {
    setTests((t) => ({ ...t, [id]: { ok: true, text: 'Menguji…' } }));
    try {
      const r = await api.testProvider(id);
      setTests((t) => ({
        ...t,
        [id]: r.ok ? { ok: true, text: `Terhubung · ${r.models?.length ?? 0} model tersedia`, models: r.models } : { ok: false, text: r.error ?? 'Gagal' },
      }));
    } catch (e) {
      setTests((t) => ({ ...t, [id]: { ok: false, text: e instanceof Error ? e.message : String(e) } }));
    }
  };

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        SOLAR bisa memakai beberapa provider LLM sekaligus: OpenAI, gateway seperti OmniRoute/OpenRouter/LiteLLM, Claude, Gemini, atau
        model lokal (Ollama). <b>Rute default</b> menentukan model utama dan cadangannya: bila model utama gagal (koneksi, kuota, limit,
        key salah), task otomatis pindah ke model berikutnya.
      </p>
      {error && (
        <div className="error-box" style={{ marginBottom: 10 }}>
          {error}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h4>Rute default (utama → cadangan)</h4>
        </div>
        {route.map((entry, i) => (
          <div className="row" key={entry} style={{ marginTop: 8 }}>
            <span className="badge">{i === 0 ? 'Utama' : `Cadangan ${i}`}</span>
            <code style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{entry}</code>
            <button type="button" className="btn small ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Naikkan">
              ↑
            </button>
            <button type="button" className="btn small ghost" disabled={i === route.length - 1} onClick={() => move(i, 1)} aria-label="Turunkan">
              ↓
            </button>
            <button
              type="button"
              className="btn small ghost"
              disabled={route.length === 1}
              onClick={() => {
                setRoute(route.filter((_, j) => j !== i));
                setRouteDirty(true);
              }}
              aria-label="Hapus dari rute"
            >
              <TrashIcon size={14} />
            </button>
          </div>
        ))}
        <div className="row" style={{ marginTop: 10 }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 180 }}
            list="solar-model-choices"
            placeholder="provider/model, mis. omniroute/claude-sonnet"
            value={newEntry}
            onChange={(e) => setNewEntry(e.target.value)}
          />
          <datalist id="solar-model-choices">
            {choices.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <button
            type="button"
            className="btn small"
            disabled={!/^[a-z0-9][a-z0-9-]*\/.+/.test(newEntry.trim()) || route.includes(newEntry.trim())}
            onClick={() => {
              setRoute([...route, newEntry.trim()]);
              setNewEntry('');
              setRouteDirty(true);
            }}
          >
            <PlusIcon size={14} /> Tambah
          </button>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button type="button" className="btn primary small" disabled={busy || !routeDirty || !route.length} onClick={() => void run(() => api.setRoutes({ ...view?.routes, default: route }))}>
            Simpan rute
          </button>
          <button
            type="button"
            className="btn small"
            disabled={busy}
            onClick={() => {
              const rest = Object.fromEntries(Object.entries(view?.routes ?? {}).filter(([k]) => k !== 'default'));
              void run(() => api.setRoutes(rest));
            }}
          >
            Kembali ke model .env
          </button>
        </div>
        <p className="hint">Berlaku untuk task berikutnya, tanpa restart.</p>
      </div>

      <div className="row" style={{ margin: '14px 0 8px' }}>
        <h4 style={{ margin: 0, flex: 1 }}>Provider</h4>
        <button type="button" className="btn primary small" onClick={() => setDraft(toDraft())}>
          <PlusIcon size={16} /> Tambah provider
        </button>
      </div>

      {draft && (
        <div className="card">
          <h4 style={{ marginTop: 0 }}>{draft.isNew ? 'Provider baru' : `Edit provider: ${draft.id}`}</h4>
          {draft.isNew && (
            <div className="row" style={{ marginBottom: 10 }}>
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className="btn small"
                  onClick={() => setDraft({ ...draft, name: p.name, kind: p.kind, baseUrl: p.baseUrl, apiKey: p.apiKey, hint: p.hint })}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
          {draft.hint && <p className="hint">{draft.hint}</p>}
          <label className="field">
            <span>Nama</span>
            <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          {draft.isNew && (
            <label className="field">
              <span>Id (dipakai di rute, mis. omniroute) - kosong = dari nama</span>
              <input className="input" value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value.toLowerCase() })} />
            </label>
          )}
          <label className="field">
            <span>Jenis API</span>
            <select className="select" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as LlmProviderKind })}>
              {(Object.keys(KIND_LABEL) as LlmProviderKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Base URL (termasuk /v1)</span>
            <input className="input" value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} placeholder="https://host/v1" />
          </label>
          <label className="field">
            <span>API key (atau referensi variabel .env, mis. {'${OMNIROUTE_API_KEY}'}; kosong untuk model lokal)</span>
            <input
              className="input"
              type="password"
              autoComplete="off"
              value={draft.apiKey}
              onFocus={() => draft.apiKey === SECRET_MASK && setDraft({ ...draft, apiKey: '' })}
              onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Model (satu per baris). Opsi: max=16384; reasoning; effort=high; price=input/cached/output (USD per 1 juta token)</span>
            <textarea
              className="textarea"
              rows={4}
              value={draft.models}
              onChange={(e) => setDraft({ ...draft, models: e.target.value })}
              placeholder={'claude-sonnet; max=64000\nqwen3:32b; price=0/0/0'}
            />
          </label>
          <details>
            <summary className="hint" style={{ cursor: 'pointer' }}>
              Lanjutan
            </summary>
            <label className="field">
              <span>Header tambahan (KEY=nilai per baris)</span>
              <textarea className="textarea" rows={2} value={draft.headers} onChange={(e) => setDraft({ ...draft, headers: e.target.value })} />
            </label>
            {draft.kind === 'openai-chat' && (
              <label className="field">
                <span>Parameter batas output</span>
                <select className="select" value={draft.maxTokensParam} onChange={(e) => setDraft({ ...draft, maxTokensParam: e.target.value as Draft['maxTokensParam'] })}>
                  <option value="">Otomatis (max_completion_tokens untuk api.openai.com, selain itu max_tokens)</option>
                  <option value="max_tokens">max_tokens</option>
                  <option value="max_completion_tokens">max_completion_tokens</option>
                </select>
              </label>
            )}
            <label className="toggle" style={{ display: 'flex', marginBottom: 8 }}>
              <input type="checkbox" checked={draft.vision} onChange={(e) => setDraft({ ...draft, vision: e.target.checked })} />
              Model menerima gambar
            </label>
          </details>
          <label className="toggle" style={{ display: 'flex', margin: '8px 0' }}>
            <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
            Aktif
          </label>
          <div className="row">
            <button type="button" className="btn primary small" disabled={busy || !draft.name.trim()} onClick={() => void save()}>
              Simpan
            </button>
            <button type="button" className="btn small" onClick={() => setDraft(null)}>
              Batal
            </button>
          </div>
        </div>
      )}

      {view?.providers.map((p) => {
        const t = tests[p.id];
        return (
          <div className="card" key={p.id}>
            <div className="card-head">
              <h4>{p.name}</h4>
              <span className="badge">{p.source === 'env' ? '.env' : p.enabled ? 'Aktif' : 'Nonaktif'}</span>
              <span className="badge">{p.ready ? 'Siap' : 'Belum ada API key'}</span>
            </div>
            <p>
              <code>{p.id}</code> · {KIND_LABEL[p.kind]}
              {p.baseUrl ? ` · ${p.baseUrl}` : ''}
            </p>
            {p.models.length > 0 && <p className="hint">Model: {p.models.map((m) => m.id).join(', ')}</p>}
            {p.missingVars.length > 0 && <p className="hint">Variabel belum diisi: {p.missingVars.join(', ')}</p>}
            {p.source === 'env' && <p className="hint">Diatur lewat OPENAI_API_KEY, OPENAI_BASE_URL dan SOLAR_MODEL di .env.</p>}
            {t && (
              <p className="hint" style={{ color: t.ok ? undefined : 'var(--danger, #c0392b)' }}>
                {t.text}
              </p>
            )}
            <div className="row" style={{ marginTop: 8 }}>
              <button type="button" className="btn small" onClick={() => void test(p.id)}>
                <RefreshIcon size={14} /> Tes koneksi
              </button>
              {p.source === 'user' && (
                <>
                  <button type="button" className="btn small" onClick={() => setDraft(toDraft(p))}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn small danger"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Hapus provider "${p.name}"?`)) void run(() => api.deleteProvider(p.id));
                    }}
                  >
                    Hapus
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
