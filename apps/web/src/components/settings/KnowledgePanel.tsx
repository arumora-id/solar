import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KnowledgeEntry, KnowledgeType } from '@solar/shared';
import { api, type SheetPreview } from '../../lib/api';
import { useSolar } from '../../lib/store';
import { PlusIcon } from '../Icons';

const TYPE_LABEL: Record<KnowledgeType, string> = {
  landscape: 'Landscape',
  system: 'Sistem',
  integration: 'Integrasi',
  standard: 'Standar',
  principle: 'Prinsip',
  nfr: 'NFR / keamanan',
  process: 'Proses',
  document: 'Struktur dokumen',
  decision: 'Keputusan (ADR)',
  glossary: 'Glosarium',
  reference: 'Referensi',
};
const TYPES = Object.keys(TYPE_LABEL) as KnowledgeType[];
const RETIRED = /^(sunset|retired?|retiring|decommission(ed)?|deprecated|inactive|obsolete|phase[- ]?out|end[- ]of[- ]life|eol|tidak aktif|non[- ]?aktif|pensiun|dihentikan)$/i;

const isGuide = (path: string) => path.split('/').some((s) => s.startsWith('_')) || /^readme\.md$/i.test(path);

interface Editor {
  path: string;
  content: string;
  isNew: boolean;
  source: 'builtin' | 'user' | null;
}

interface TableWizard {
  file: File;
  sheets: SheetPreview[];
  sheet: string;
  idColumn: string;
  titleColumn: string;
  statusColumn: string;
  aliasColumns: string[];
  folder: string;
  type: KnowledgeType;
  removeStale: boolean;
}

interface DocWizard {
  file: File;
  folder: string;
  type: KnowledgeType;
  split: 'none' | 1 | 2;
  title: string;
  removeStale: boolean;
}

const NEW_FILE = `---
id: NAMA
type: system
title: Nama lengkap
aliases: []
status: active
---

# Nama lengkap

Ringkasan.
`;

export function KnowledgePanel() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<KnowledgeType | ''>('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [table, setTable] = useState<TableWizard | null>(null);
  const [doc, setDoc] = useState<DocWizard | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { reloadConfig } = useSolar();

  const load = useCallback(async () => {
    try {
      setEntries(await api.knowledge());
      void reloadConfig();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [reloadConfig]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (op: () => Promise<string | void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const message = await op();
      if (message) setNotice(message);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const shown = useMemo(() => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    return entries.filter(
      (e) =>
        (!typeFilter || e.type === typeFilter) &&
        words.every((w) => [e.path, e.id, e.title, ...e.aliases].join(' ').toLowerCase().includes(w)),
    );
  }, [entries, filter, typeFilter]);

  const groups = useMemo(() => {
    const out = new Map<string, KnowledgeEntry[]>();
    for (const e of shown) {
      const key = isGuide(e.path) ? 'Panduan & template (tidak dibaca agent)' : TYPE_LABEL[e.type];
      out.set(key, [...(out.get(key) ?? []), e]);
    }
    return [...out.entries()].sort(([a], [b]) => (a.startsWith('Panduan') ? 1 : b.startsWith('Panduan') ? -1 : a.localeCompare(b)));
  }, [shown]);

  const open = async (e: KnowledgeEntry) => {
    try {
      const file = await api.knowledgeFile(e.path);
      setEditor({ path: e.path, content: file.content, isNew: false, source: e.source });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const importMarkdown = async (files: FileList) => {
    const list = await Promise.all(
      [...files]
        .filter((f) => /\.md$/i.test(f.name))
        .map(async (f) => {
          // a picked folder keeps its structure below the folder itself
          const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
          const path = rel.includes('/') ? rel.split('/').slice(1).join('/') : rel;
          return { path, content: await f.text() };
        }),
    );
    if (!list.length) {
      setError('Tidak ada file .md yang dipilih.');
      return;
    }
    await run(async () => {
      const r = await api.importKnowledge(list);
      return `${r.imported.length} file diimpor${r.failed.length ? `; gagal: ${r.failed.map((f) => `${f.path} (${f.error})`).join(', ')}` : ''}.`;
    });
  };

  const startTable = async (file: File) => {
    await run(async () => {
      const sheets = await api.previewTables(file);
      const first = sheets.find((s) => s.headers.length) ?? sheets[0];
      if (!first) throw new Error('File tidak berisi tabel.');
      setTable({
        file,
        sheets,
        sheet: first.name,
        idColumn: first.headers[0] ?? '',
        titleColumn: '',
        statusColumn: first.headers.find((h) => /^status$/i.test(h)) ?? '',
        aliasColumns: [],
        folder: 'systems',
        type: 'system',
        removeStale: true,
      });
    });
  };

  const sheet = table?.sheets.find((s) => s.name === table.sheet);

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        Knowledge base berisi aturan dan fakta Anda (sistem, integrasi, standar ArchiMate, PlantUML, API, prinsip). Agent membaca file yang
        relevan sebelum mendesain, dan isinya mengalahkan aturan bawaan. Registry besar (daftar sistem/API) cukup diimpor dari Excel: satu
        file per baris, sehingga agent hanya membaca yang dibutuhkan.
      </p>
      <div className="row" style={{ marginBottom: 12 }}>
        <button type="button" className="btn primary small" onClick={() => setEditor({ path: 'systems/NAMA.md', content: NEW_FILE, isNew: true, source: null })}>
          <PlusIcon size={16} /> File baru
        </button>
        <label className="btn small">
          Impor .md
          <input type="file" accept=".md,text/markdown" multiple hidden onChange={(e) => e.target.files && void importMarkdown(e.target.files).finally(() => (e.target.value = ''))} />
        </label>
        <label className="btn small">
          Impor folder
          <input
            type="file"
            hidden
            // webkitdirectory is not in React's input typings
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            onChange={(e) => e.target.files && void importMarkdown(e.target.files).finally(() => (e.target.value = ''))}
          />
        </label>
        <label className="btn small">
          Impor Excel/CSV
          <input
            type="file"
            accept=".xlsx,.xlsm,.csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void startTable(f);
              e.target.value = '';
            }}
          />
        </label>
        <label className="btn small">
          Impor dokumen
          <input
            type="file"
            accept=".docx,.pdf,.pptx,.md,.txt"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setDoc({ file: f, folder: 'standards', type: 'standard', split: 'none', title: f.name.replace(/\.[^.]+$/, ''), removeStale: true });
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
      {notice && (
        <div className="card" style={{ marginBottom: 10 }}>
          {notice}
        </div>
      )}

      {table && (
        <div className="card">
          <h4 style={{ marginTop: 0 }}>Impor tabel: {table.file.name}</h4>
          <label className="field">
            <span>Sheet</span>
            <select
              className="select"
              value={table.sheet}
              onChange={(e) => {
                const s = table.sheets.find((x) => x.name === e.target.value);
                setTable({ ...table, sheet: e.target.value, idColumn: s?.headers[0] ?? '', titleColumn: '', statusColumn: '', aliasColumns: [] });
              }}
            >
              {table.sheets.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} ({s.rows} baris{s.truncated ? ', dipotong' : ''})
                </option>
              ))}
            </select>
          </label>
          {sheet && (
            <>
              {(
                [
                  ['idColumn', 'Kolom ID / nama file (wajib)'],
                  ['titleColumn', 'Kolom nama lengkap'],
                  ['statusColumn', 'Kolom status (active / sunset / retired)'],
                ] as const
              ).map(([key, label]) => (
                <label className="field" key={key}>
                  <span>{label}</span>
                  <select className="select" value={table[key]} onChange={(e) => setTable({ ...table, [key]: e.target.value })}>
                    {key !== 'idColumn' && <option value="">(tidak ada)</option>}
                    {sheet.headers.filter(Boolean).map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <div className="field">
                <span>Kolom nama lain / alias (dicocokkan dengan nama di BRD)</span>
                <div className="row">
                  {sheet.headers.filter(Boolean).map((h) => (
                    <label className="toggle" key={h}>
                      <input
                        type="checkbox"
                        checked={table.aliasColumns.includes(h)}
                        onChange={(e) =>
                          setTable({ ...table, aliasColumns: e.target.checked ? [...table.aliasColumns, h] : table.aliasColumns.filter((x) => x !== h) })
                        }
                      />
                      {h}
                    </label>
                  ))}
                </div>
              </div>
              {sheet.sample.length > 0 && <p className="hint">Contoh baris: {sheet.sample[0]!.filter(Boolean).slice(0, 5).join(' · ')}</p>}
            </>
          )}
          <div className="row">
            <label className="field" style={{ flex: 1, minWidth: 140 }}>
              <span>Folder tujuan</span>
              <input className="input" value={table.folder} onChange={(e) => setTable({ ...table, folder: e.target.value })} />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 140 }}>
              <span>Jenis</span>
              <select className="select" value={table.type} onChange={(e) => setTable({ ...table, type: e.target.value as KnowledgeType })}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="toggle" style={{ display: 'flex', marginBottom: 10 }}>
            <input type="checkbox" checked={table.removeStale} onChange={(e) => setTable({ ...table, removeStale: e.target.checked })} />
            Hapus file dari impor sebelumnya (file & sheet yang sama) yang barisnya sudah tidak ada
          </label>
          <div className="row">
            <button
              type="button"
              className="btn primary small"
              disabled={busy || !table.idColumn || !table.folder.trim()}
              onClick={() =>
                void run(async () => {
                  const r = await api.importTable(table.file, {
                    sheet: table.sheet,
                    headerRow: 1,
                    idColumn: table.idColumn,
                    titleColumn: table.titleColumn || undefined,
                    statusColumn: table.statusColumn || undefined,
                    aliasColumns: table.aliasColumns,
                    folder: table.folder.trim(),
                    type: table.type,
                    removeStale: table.removeStale,
                  });
                  setTable(null);
                  return `${r.written.length} file ditulis ke ${table.folder}/ (indeks: ${r.index})${r.removed.length ? `, ${r.removed.length} file lama dihapus` : ''}${
                    r.skipped.length ? `. Catatan: ${r.skipped.slice(0, 5).map((s) => `baris ${s.row}: ${s.reason}`).join('; ')}` : ''
                  }.`;
                })
              }
            >
              Impor
            </button>
            <button type="button" className="btn small" onClick={() => setTable(null)}>
              Batal
            </button>
          </div>
        </div>
      )}

      {doc && (
        <div className="card">
          <h4 style={{ marginTop: 0 }}>Impor dokumen: {doc.file.name}</h4>
          <label className="field">
            <span>Judul</span>
            <input className="input" value={doc.title} onChange={(e) => setDoc({ ...doc, title: e.target.value })} />
          </label>
          <div className="row">
            <label className="field" style={{ flex: 1, minWidth: 140 }}>
              <span>Folder tujuan</span>
              <input className="input" value={doc.folder} onChange={(e) => setDoc({ ...doc, folder: e.target.value })} />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 140 }}>
              <span>Jenis</span>
              <select className="select" value={doc.type} onChange={(e) => setDoc({ ...doc, type: e.target.value as KnowledgeType })}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>Pecah dokumen</span>
            <select className="select" value={String(doc.split)} onChange={(e) => setDoc({ ...doc, split: e.target.value === 'none' ? 'none' : (Number(e.target.value) as 1 | 2) })}>
              <option value="none">Tidak, simpan sebagai satu file</option>
              <option value="1">Per bab (heading 1)</option>
              <option value="2">Per bab dan sub-bab (heading 1-2)</option>
            </select>
          </label>
          <label className="toggle" style={{ display: 'flex', marginBottom: 10 }}>
            <input type="checkbox" checked={doc.removeStale} onChange={(e) => setDoc({ ...doc, removeStale: e.target.checked })} />
            Ganti hasil impor sebelumnya dari dokumen yang sama
          </label>
          <div className="row">
            <button
              type="button"
              className="btn primary small"
              disabled={busy || !doc.folder.trim()}
              onClick={() =>
                void run(async () => {
                  const r = await api.importDocument(doc.file, { folder: doc.folder.trim(), type: doc.type, split: doc.split, title: doc.title.trim() || undefined, removeStale: doc.removeStale });
                  setDoc(null);
                  return `${r.written.length} file ditulis${r.removed.length ? `, ${r.removed.length} file lama dihapus` : ''}.${r.warnings.length ? ` Catatan: ${r.warnings.join(' ')}` : ''}`;
                })
              }
            >
              Impor
            </button>
            <button type="button" className="btn small" onClick={() => setDoc(null)}>
              Batal
            </button>
          </div>
        </div>
      )}

      {editor && (
        <div className="card">
          <h4 style={{ marginTop: 0 }}>{editor.isNew ? 'File baru' : `Edit: ${editor.path}`}</h4>
          {editor.isNew && (
            <label className="field">
              <span>Path (folder/nama.md)</span>
              <input className="input" value={editor.path} onChange={(e) => setEditor({ ...editor, path: e.target.value })} />
            </label>
          )}
          {editor.source === 'builtin' && <p className="hint">File bawaan: menyimpan membuat salinan milik Anda (versi bawaan kembali bila salinan dihapus).</p>}
          <label className="field">
            <span>Isi (Markdown dengan front matter)</span>
            <textarea className="textarea" rows={16} value={editor.content} onChange={(e) => setEditor({ ...editor, content: e.target.value })} spellCheck={false} />
          </label>
          <div className="row">
            <button
              type="button"
              className="btn primary small"
              disabled={busy || !editor.path.trim()}
              onClick={() =>
                void run(async () => {
                  await api.saveKnowledge(editor.path.trim(), editor.content);
                  setEditor(null);
                  return `${editor.path} disimpan.`;
                })
              }
            >
              Simpan
            </button>
            <button type="button" className="btn small" onClick={() => setEditor(null)}>
              Batal
            </button>
          </div>
        </div>
      )}

      <div className="row" style={{ marginBottom: 10 }}>
        <input className="input" style={{ flex: 2, minWidth: 160 }} placeholder="Cari path, nama atau alias…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select className="select" style={{ flex: 1, minWidth: 120 }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as KnowledgeType | '')}>
          <option value="">Semua jenis</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>
      <p className="hint">
        {entries.filter((e) => !isGuide(e.path)).length} file dibaca agent{shown.length !== entries.length ? ` · ${shown.length} cocok dengan filter` : ''}
      </p>

      {groups.map(([label, list]) => (
        <div key={label} style={{ marginBottom: 12 }}>
          <h4 style={{ margin: '8px 0' }}>
            {label} ({list.length})
          </h4>
          {list.slice(0, 300).map((e) => (
            <div className="card" key={e.path}>
              <div className="card-head">
                <h4 style={{ overflowWrap: 'anywhere' }}>{e.title}</h4>
                {e.status && <span className="badge">{RETIRED.test(e.status) ? `${e.status} (tidak dipakai untuk solusi baru)` : e.status}</span>}
                <span className="badge">{e.source === 'builtin' ? 'Bawaan' : 'Pengguna'}</span>
              </div>
              <p className="hint" style={{ overflowWrap: 'anywhere' }}>
                <code>{e.path}</code>
                {e.aliases.length ? ` · alias: ${e.aliases.join(', ')}` : ''}
              </p>
              {e.description && <p>{e.description}</p>}
              <div className="row" style={{ marginTop: 8 }}>
                <button type="button" className="btn small" onClick={() => void open(e)}>
                  {e.source === 'builtin' ? 'Lihat / override' : 'Edit'}
                </button>
                {e.source === 'user' && (
                  <button
                    type="button"
                    className="btn small danger"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Hapus ${e.path}?`)) void run(async () => `${e.path}: ${(await api.deleteKnowledge(e.path)).result === 'reverted' ? 'versi bawaan dipulihkan' : 'dihapus'}.`);
                    }}
                  >
                    Hapus
                  </button>
                )}
              </div>
            </div>
          ))}
          {list.length > 300 && <p className="hint">{list.length - 300} file lain - persempit dengan pencarian.</p>}
        </div>
      ))}
    </div>
  );
}
