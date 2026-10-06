import { useCallback, useEffect, useState } from 'react';
import type { ConfirmPolicy, PluginConfig, PluginTransport, PluginView } from '@solar/shared';
import { api } from '../../lib/api';
import { useSolar } from '../../lib/store';
import { PlusIcon, RefreshIcon, TrashIcon } from '../Icons';

const POLICY_LABEL: Record<ConfirmPolicy, string> = {
  never: 'Tanpa konfirmasi',
  writes: 'Konfirmasi untuk operasi tulis',
  always: 'Selalu konfirmasi setiap pemanggilan',
};

const STATE_LABEL: Record<string, string> = {
  disabled: 'Nonaktif',
  unconfigured: 'Belum dikonfigurasi',
  connecting: 'Menghubungkan…',
  connected: 'Terhubung',
  error: 'Error',
};

interface Draft {
  id: string;
  name: string;
  description: string;
  transport: PluginTransport;
  url: string;
  command: string;
  args: string;
  headers: string;
  env: string;
  confirm: ConfirmPolicy;
  toolAllowlist: string;
  isNew: boolean;
}

const toLines = (rec?: Record<string, string>) =>
  Object.entries(rec ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

function fromLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf('=');
    if (i <= 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function toDraft(p?: PluginConfig): Draft {
  return {
    id: p?.id ?? '',
    name: p?.name ?? '',
    description: p?.description ?? '',
    transport: p?.transport ?? 'http',
    url: p?.url ?? '',
    command: p?.command ?? '',
    args: (p?.args ?? []).join('\n'),
    headers: toLines(p?.headers),
    env: toLines(p?.env),
    confirm: p?.confirm ?? 'writes',
    toolAllowlist: (p?.toolAllowlist ?? []).join(', '),
    isNew: !p,
  };
}

export function PluginsPanel() {
  const { plugins: liveStatus } = useSolar();
  const [plugins, setPlugins] = useState<PluginView[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setPlugins(await api.plugins());
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
    const body: Partial<PluginConfig> = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      transport: draft.transport,
      confirm: draft.confirm,
      toolAllowlist: draft.toolAllowlist
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      ...(draft.transport === 'stdio'
        ? { command: draft.command.trim(), args: draft.args.split('\n').map((s) => s.trim()).filter(Boolean), env: fromLines(draft.env) }
        : { url: draft.url.trim(), headers: fromLines(draft.headers) }),
    };
    const ok = await run(() =>
      draft.isNew ? api.createPlugin({ ...body, id: draft.id.trim() || undefined, enabled: true, preset: 'custom' }) : api.updatePlugin(draft.id, body),
    );
    if (ok) setDraft(null);
  };

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        Plugin MCP memberi SOLAR akses ke sistem lain. Nilai seperti <code>{'${GITHUB_TOKEN}'}</code> diambil dari file <code>.env</code> sehingga rahasia
        tidak tersimpan di sini. Visual Paradigm diset <strong>selalu konfirmasi</strong>.
      </p>
      <div className="row" style={{ marginBottom: 12 }}>
        <button type="button" className="btn primary small" onClick={() => setDraft(toDraft())}>
          <PlusIcon size={16} /> Tambah plugin MCP
        </button>
      </div>
      {error && (
        <div className="error-box" style={{ marginBottom: 10 }}>
          {error}
        </div>
      )}

      {draft && (
        <div className="card">
          <h4 style={{ marginTop: 0 }}>{draft.isNew ? 'Plugin baru' : `Edit plugin: ${draft.id}`}</h4>
          <div className="grid-2">
            <label className="field">
              <span>Nama</span>
              <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            {draft.isNew && (
              <label className="field">
                <span>Id (huruf kecil, angka, -)</span>
                <input className="input" value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} placeholder="otomatis dari nama" />
              </label>
            )}
            <label className="field">
              <span>Transport</span>
              <select className="select" value={draft.transport} onChange={(e) => setDraft({ ...draft, transport: e.target.value as PluginTransport })}>
                <option value="http">Streamable HTTP (remote)</option>
                <option value="sse">SSE (remote, lama)</option>
                <option value="stdio">stdio (proses lokal, mis. npx)</option>
              </select>
            </label>
            <label className="field">
              <span>Kebijakan konfirmasi</span>
              <select className="select" value={draft.confirm} onChange={(e) => setDraft({ ...draft, confirm: e.target.value as ConfirmPolicy })}>
                {(Object.keys(POLICY_LABEL) as ConfirmPolicy[]).map((p) => (
                  <option key={p} value={p}>
                    {POLICY_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>Deskripsi</span>
            <input className="input" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </label>
          {draft.transport === 'stdio' ? (
            <>
              <label className="field">
                <span>Command</span>
                <input className="input" value={draft.command} onChange={(e) => setDraft({ ...draft, command: e.target.value })} placeholder="npx" />
              </label>
              <label className="field">
                <span>Argumen (satu per baris)</span>
                <textarea className="textarea" rows={3} value={draft.args} onChange={(e) => setDraft({ ...draft, args: e.target.value })} placeholder={'-y\n@scope/mcp-server'} />
              </label>
              <label className="field">
                <span>Environment (KEY=VALUE per baris, boleh {'${VAR}'})</span>
                <textarea className="textarea" rows={3} value={draft.env} onChange={(e) => setDraft({ ...draft, env: e.target.value })} />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span>URL endpoint MCP</span>
                <input className="input" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://example.com/mcp" />
              </label>
              <label className="field">
                <span>Header (KEY=VALUE per baris, boleh {'${VAR}'})</span>
                <textarea className="textarea" rows={3} value={draft.headers} onChange={(e) => setDraft({ ...draft, headers: e.target.value })} placeholder="Authorization=Bearer ${MY_TOKEN}" />
              </label>
            </>
          )}
          <label className="field">
            <span>Batasi tool (opsional, pisahkan koma)</span>
            <input className="input" value={draft.toolAllowlist} onChange={(e) => setDraft({ ...draft, toolAllowlist: e.target.value })} placeholder="kosong = semua tool" />
          </label>
          <div className="row">
            <button type="button" className="btn primary small" disabled={busy || !draft.name.trim()} onClick={() => void save()}>
              Simpan &amp; hubungkan
            </button>
            <button type="button" className="btn small" onClick={() => setDraft(null)}>
              Batal
            </button>
          </div>
        </div>
      )}

      {plugins.map((p) => {
        const status = liveStatus.find((s) => s.id === p.id) ?? p.status;
        return (
          <div className="card" key={p.id}>
            <div className="card-head">
              <h4>{p.name}</h4>
              <span className="badge" data-status={status.state === 'connected' ? 'completed' : status.state === 'error' ? 'failed' : status.state === 'connecting' ? 'running' : 'cancelled'}>
                {STATE_LABEL[status.state] ?? status.state}
                {status.state === 'connected' ? ` · ${status.tools.length} tool` : ''}
              </span>
              <label className="toggle">
                <input type="checkbox" checked={p.enabled} disabled={busy} onChange={(e) => void run(() => api.updatePlugin(p.id, { enabled: e.target.checked }))} />
                Aktif
              </label>
            </div>
            <p>{p.description}</p>
            <p className="hint">
              {p.transport} · {p.transport === 'stdio' ? `${p.command} ${(p.args ?? []).join(' ')}` : p.url}
            </p>
            {status.error && <p className="hint" style={{ color: status.state === 'error' ? 'var(--critical-text)' : undefined }}>{status.error}</p>}
            <div className="row" style={{ marginTop: 8 }}>
              <select
                className="select"
                style={{ width: 'auto' }}
                value={p.confirm}
                disabled={busy}
                aria-label="Kebijakan konfirmasi"
                onChange={(e) => void run(() => api.updatePlugin(p.id, { confirm: e.target.value as ConfirmPolicy }))}
              >
                {(Object.keys(POLICY_LABEL) as ConfirmPolicy[]).map((c) => (
                  <option key={c} value={c}>
                    {POLICY_LABEL[c]}
                  </option>
                ))}
              </select>
              <button type="button" className="btn small" disabled={busy} onClick={() => void run(() => api.reconnectPlugin(p.id))}>
                <RefreshIcon /> Hubungkan ulang
              </button>
              <button type="button" className="btn small" onClick={() => setDraft(toDraft(p))}>
                Edit
              </button>
              <button
                type="button"
                className="btn small danger icon"
                aria-label={`Hapus ${p.name}`}
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Hapus plugin "${p.name}"?`)) void run(() => api.deletePlugin(p.id));
                }}
              >
                <TrashIcon />
              </button>
            </div>
            {status.tools.length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary className="hint">Daftar tool ({status.tools.length})</summary>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5 }}>
                  {status.tools.map((t) => (
                    <li key={t.name}>
                      <code>{t.name}</code> <span className="hint">{t.description}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
