import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KnowledgeEntry, KnowledgeType } from '@solar/shared';
import { api, type SheetPreview } from '../../lib/api';
import { useT, type Dict } from '../../lib/i18n';
import { TYPES } from '../../lib/knowledgeTypes';
import { useSolar } from '../../lib/store';
import { PlusIcon } from '../Icons';
import { messageText, type Message } from './richText';


/** Status values (of the user's data, in English or Indonesian) meaning a system is no longer in use. */
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

/** An error whose text is in the dictionary, so it is shown in the current language. */
class MessageError extends Error {
  readonly text: (t: Dict) => string;
  constructor(text: (t: Dict) => string) {
    super('');
    this.text = text;
  }
}

/** Group key: a knowledge type, or the guides and templates (listed last). */
type GroupKey = KnowledgeType | 'guides';

export function KnowledgePanel() {
  const t = useT();
  const words = t.settings.knowledge;
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<KnowledgeType | ''>('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [table, setTable] = useState<TableWizard | null>(null);
  const [doc, setDoc] = useState<DocWizard | null>(null);
  const [notice, setNotice] = useState<Message>('');
  const [error, setError] = useState<Message>('');
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

  const run = async (op: () => Promise<Message | void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const message = await op();
      // a function is a state updater for React: wrap the message
      if (message) setNotice(() => message);
      await load();
      return true;
    } catch (e) {
      const message: Message = e instanceof MessageError ? e.text : e instanceof Error ? e.message : String(e);
      setError(() => message);
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

  const groupLabel = (key: GroupKey) => (key === 'guides' ? words.guides : t.artifacts.knowledgeType[key]);

  // sorted by the label in the current language, guides last
  const groups = useMemo(() => {
    const out = new Map<GroupKey, KnowledgeEntry[]>();
    for (const e of shown) {
      const key: GroupKey = isGuide(e.path) ? 'guides' : e.type;
      out.set(key, [...(out.get(key) ?? []), e]);
    }
    const label = (key: GroupKey) => (key === 'guides' ? '' : t.artifacts.knowledgeType[key]);
    return [...out.entries()].sort(([a], [b]) => (a === 'guides' ? 1 : b === 'guides' ? -1 : label(a).localeCompare(label(b))));
  }, [shown, t]);

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
      setError(() => (d: Dict) => d.settings.knowledge.noMarkdownPicked);
      return;
    }
    await run(async () => {
      const r = await api.importKnowledge(list);
      const failures = r.failed.map((f) => `${f.path} (${f.error})`).join(', ');
      return (d: Dict) =>
        failures ? d.settings.knowledge.importedWithFailures(r.imported.length, failures) : d.settings.knowledge.imported(r.imported.length);
    });
  };

  const startTable = async (file: File) => {
    await run(async () => {
      const sheets = await api.previewTables(file);
      const first = sheets.find((s) => s.headers.length) ?? sheets[0];
      if (!first) throw new MessageError((d) => d.settings.knowledge.noTable);
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
        {words.intro}
      </p>
      <div className="row" style={{ marginBottom: 12 }}>
        <button type="button" className="btn primary small" onClick={() => setEditor({ path: words.template.path, content: words.template.content, isNew: true, source: null })}>
          <PlusIcon size={16} /> {words.newFile}
        </button>
        <label className="btn small">
          {words.importMarkdown}
          <input type="file" accept=".md,text/markdown" multiple hidden onChange={(e) => e.target.files && void importMarkdown(e.target.files).finally(() => (e.target.value = ''))} />
        </label>
        <label className="btn small">
          {words.importFolder}
          <input
            type="file"
            hidden
            // webkitdirectory is not in React's input typings
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            onChange={(e) => e.target.files && void importMarkdown(e.target.files).finally(() => (e.target.value = ''))}
          />
        </label>
        <label className="btn small">
          {words.importTable}
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
          {words.importDocument}
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
          {messageText(error, t)}
        </div>
      )}
      {notice && (
        <div className="card" style={{ marginBottom: 10 }}>
          {messageText(notice, t)}
        </div>
      )}

      {table && (
        <div className="card">
          <h4 style={{ marginTop: 0, overflowWrap: 'anywhere' }}>{words.table.title(table.file.name)}</h4>
          <label className="field">
            <span>{words.table.sheet}</span>
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
                  {words.table.sheetOption(s.name, s.rows, s.truncated)}
                </option>
              ))}
            </select>
          </label>
          {sheet?.truncated && (
            <p className="hint">
              {sheet.rows || sheet.headers.length
                ? words.table.truncatedRows
                : words.table.truncatedWorkbook}
            </p>
          )}
          {sheet && (
            <>
              {(
                [
                  ['idColumn', words.table.idColumn],
                  ['titleColumn', words.table.titleColumn],
                  ['statusColumn', words.table.statusColumn],
                ] as const
              ).map(([key, label]) => (
                <label className="field" key={key}>
                  <span>{label}</span>
                  <select className="select" value={table[key]} onChange={(e) => setTable({ ...table, [key]: e.target.value })}>
                    {key !== 'idColumn' && <option value="">{words.table.noColumn}</option>}
                    {sheet.headers.filter(Boolean).map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <div className="field">
                <span>{words.table.aliasColumns}</span>
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
              {sheet.sample.length > 0 && <p className="hint">{words.table.sampleRow(sheet.sample[0]!.filter(Boolean).slice(0, 5).join(' · '))}</p>}
            </>
          )}
          <div className="row">
            <label className="field" style={{ flex: 1, minWidth: 140 }}>
              <span>{words.targetFolder}</span>
              <input className="input" value={table.folder} onChange={(e) => setTable({ ...table, folder: e.target.value })} />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 140 }}>
              <span>{t.common.type}</span>
              <select className="select" value={table.type} onChange={(e) => setTable({ ...table, type: e.target.value as KnowledgeType })}>
                {TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t.artifacts.knowledgeType[type]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="toggle" style={{ display: 'flex', marginBottom: 10 }}>
            <input type="checkbox" checked={table.removeStale} onChange={(e) => setTable({ ...table, removeStale: e.target.checked })} />
            {words.table.removeStale}
          </label>
          <div className="row">
            <button
              type="button"
              className="btn primary small"
              disabled={busy || !table.idColumn || !table.folder.trim() || Boolean(sheet?.truncated)}
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
                  const folder = table.folder.trim();
                  return (d: Dict) =>
                    d.settings.knowledge.table.done(
                      r.written.length,
                      folder,
                      r.index,
                      r.removed.length,
                      r.skipped
                        .slice(0, 5)
                        .map((s) => d.settings.knowledge.table.skippedRow(s.row, s.reason))
                        .join('; '),
                    );
                })
              }
            >
              {t.common.import}
            </button>
            <button type="button" className="btn small" onClick={() => setTable(null)}>
              {t.common.cancel}
            </button>
          </div>
        </div>
      )}

      {doc && (
        <div className="card">
          <h4 style={{ marginTop: 0, overflowWrap: 'anywhere' }}>{words.document.title(doc.file.name)}</h4>
          <label className="field">
            <span>{t.common.title}</span>
            <input className="input" value={doc.title} onChange={(e) => setDoc({ ...doc, title: e.target.value })} />
          </label>
          <div className="row">
            <label className="field" style={{ flex: 1, minWidth: 140 }}>
              <span>{words.targetFolder}</span>
              <input className="input" value={doc.folder} onChange={(e) => setDoc({ ...doc, folder: e.target.value })} />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 140 }}>
              <span>{t.common.type}</span>
              <select className="select" value={doc.type} onChange={(e) => setDoc({ ...doc, type: e.target.value as KnowledgeType })}>
                {TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t.artifacts.knowledgeType[type]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>{words.document.split}</span>
            <select className="select" value={String(doc.split)} onChange={(e) => setDoc({ ...doc, split: e.target.value === 'none' ? 'none' : (Number(e.target.value) as 1 | 2) })}>
              <option value="none">{words.document.splitNone}</option>
              <option value="1">{words.document.splitChapters}</option>
              <option value="2">{words.document.splitSections}</option>
            </select>
          </label>
          <label className="toggle" style={{ display: 'flex', marginBottom: 10 }}>
            <input type="checkbox" checked={doc.removeStale} onChange={(e) => setDoc({ ...doc, removeStale: e.target.checked })} />
            {words.document.removeStale}
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
                  return (d: Dict) => d.settings.knowledge.document.done(r.written.length, r.removed.length, r.warnings.join(' '));
                })
              }
            >
              {t.common.import}
            </button>
            <button type="button" className="btn small" onClick={() => setDoc(null)}>
              {t.common.cancel}
            </button>
          </div>
        </div>
      )}

      {editor && (
        <div className="card">
          <h4 style={{ marginTop: 0, overflowWrap: 'anywhere' }}>{editor.isNew ? words.newFile : words.editor.edit(editor.path)}</h4>
          {editor.isNew && (
            <label className="field">
              <span>{words.editor.path}</span>
              <input className="input" value={editor.path} onChange={(e) => setEditor({ ...editor, path: e.target.value })} />
            </label>
          )}
          {editor.source === 'builtin' && <p className="hint">{words.editor.builtinHint}</p>}
          <label className="field">
            <span>{words.editor.content}</span>
            <textarea className="textarea" rows={16} value={editor.content} onChange={(e) => setEditor({ ...editor, content: e.target.value })} spellCheck={false} />
          </label>
          <div className="row">
            <button
              type="button"
              className="btn primary small"
              disabled={busy || !editor.path.trim()}
              onClick={() =>
                void run(async () => {
                  const path = editor.path.trim();
                  await api.saveKnowledge(path, editor.content);
                  setEditor(null);
                  return (d: Dict) => d.settings.knowledge.editor.saved(path);
                })
              }
            >
              {t.common.save}
            </button>
            <button type="button" className="btn small" onClick={() => setEditor(null)}>
              {t.common.cancel}
            </button>
          </div>
        </div>
      )}

      <div className="row" style={{ marginBottom: 10 }}>
        <input className="input" style={{ flex: 2, minWidth: 160 }} placeholder={words.searchPlaceholder} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select className="select" style={{ flex: 1, minWidth: 120 }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as KnowledgeType | '')}>
          <option value="">{words.allTypes}</option>
          {TYPES.map((type) => (
            <option key={type} value={type}>
              {t.artifacts.knowledgeType[type]}
            </option>
          ))}
        </select>
      </div>
      <p className="hint">
        {words.readByAgent(entries.filter((e) => !isGuide(e.path)).length)}
        {shown.length !== entries.length ? ` · ${words.matching(shown.length)}` : ''}
      </p>

      {groups.map(([key, list]) => (
        <div key={key} style={{ marginBottom: 12 }}>
          <h4 style={{ margin: '8px 0' }}>{words.groupHeading(groupLabel(key), list.length)}</h4>
          {list.slice(0, 300).map((e) => (
            <div className="card" key={e.path}>
              <div className="card-head">
                {/* a basis wide enough that long badges (e.g. a retired status in English) wrap below the title on a phone */}
                <h4 style={{ overflowWrap: 'anywhere', flexBasis: '12em' }}>{e.title}</h4>
                {e.status && <span className="badge">{RETIRED.test(e.status) ? words.retired(e.status) : e.status}</span>}
                <span className="badge">{t.settings.source[e.source]}</span>
              </div>
              <p className="hint" style={{ overflowWrap: 'anywhere' }}>
                <code>{e.path}</code>
                {e.aliases.length ? ` · ${words.aliases(e.aliases.join(', '))}` : ''}
              </p>
              {e.description && <p>{e.description}</p>}
              <div className="row" style={{ marginTop: 8 }}>
                <button type="button" className="btn small" onClick={() => void open(e)}>
                  {e.source === 'builtin' ? words.viewOrOverride : t.common.edit}
                </button>
                {e.source === 'user' && (
                  <button
                    type="button"
                    className="btn small danger"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(words.confirmDelete(e.path)))
                        void run(async () => {
                          const reverted = (await api.deleteKnowledge(e.path)).result === 'reverted';
                          return (d: Dict) => (reverted ? d.settings.knowledge.reverted(e.path) : d.settings.knowledge.deleted(e.path));
                        });
                    }}
                  >
                    {t.common.delete}
                  </button>
                )}
              </div>
            </div>
          ))}
          {list.length > 300 && <p className="hint">{words.more(list.length - 300)}</p>}
        </div>
      ))}
    </div>
  );
}
