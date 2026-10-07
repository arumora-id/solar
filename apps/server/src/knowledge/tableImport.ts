import { stringify as stringifyYaml } from 'yaml';
import type { KnowledgeEntry, KnowledgeType } from '@solar/shared';
import type { SheetTable } from '../documents/index.js';
import { normalizeKnowledgePath, parseFrontMatter, type KnowledgeStore } from './knowledgeStore.js';

export const MAX_IMPORT_ROWS = 5000;

export interface SheetPreview {
  name: string;
  headers: string[];
  rows: number;
  sample: string[][];
  truncated: boolean;
}

export interface TableImportOptions {
  sheet: string;
  /** 1-based row of the column headers inside the sheet's table (default 1). */
  headerRow: number;
  /** Header of the column that names each item (file name and id). */
  idColumn: string;
  titleColumn?: string;
  /** Columns holding other names of the item (comma/semicolon/newline separated). */
  aliasColumns: string[];
  /** Column with the lifecycle status (active, sunset, retired, ...). */
  statusColumn?: string;
  /** Target folder, e.g. "systems" or "apis". */
  folder: string;
  type?: KnowledgeType;
  /** Remove files created by an earlier import of the same file + sheet that are no longer in it. */
  removeStale: boolean;
}

export interface TableImportResult {
  written: KnowledgeEntry[];
  removed: string[];
  skipped: Array<{ row: number; reason: string }>;
  index: string;
}

const clean = (v: string | undefined) => (v ?? '').replace(/\r\n?/g, '\n').trim();

export function previewTables(tables: SheetTable[]): SheetPreview[] {
  return tables.map((t) => ({
    name: t.name,
    headers: (t.rows[0] ?? []).map(clean),
    rows: Math.max(0, t.rows.length - 1),
    sample: t.rows.slice(1, 4).map((r) => r.map(clean)),
    truncated: t.truncated,
  }));
}

/** Item id -> safe file name (keeps letters, digits, dot, dash, underscore). */
export function fileNameOf(id: string): string {
  const base = id
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 90);
  return base || 'item';
}

function folderOf(folder: string): string {
  const f = folder.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  normalizeKnowledgePath(`${f}/x.md`); // validates the folder segments
  if (f.split('/').some((seg) => seg.startsWith('_'))) throw new Error('The folder must not start with "_" (those files are not read by the agent)');
  return f;
}

function cellValue(v: string): string {
  const t = clean(v);
  return t.includes('\n') ? `\n  ${t.split('\n').join('\n  ')}` : t;
}

const mdEscape = (s: string) => s.replace(/\|/g, '\\|').replace(/\n+/g, ' ');

/**
 * Turns one spreadsheet table (one row per system / API / integration) into one Markdown file per row plus an
 * INDEX.md, so the agent reads only the rows that matter instead of the whole workbook.
 */
export async function importTable(
  store: KnowledgeStore,
  table: SheetTable,
  sourceFile: string,
  opts: TableImportOptions,
): Promise<TableImportResult> {
  const folder = folderOf(opts.folder);
  const headerIndex = Math.max(1, opts.headerRow) - 1;
  const headers = (table.rows[headerIndex] ?? []).map(clean);
  const col = (name: string | undefined) => (name ? headers.findIndex((h) => h.toLowerCase() === name.trim().toLowerCase()) : -1);
  const idCol = col(opts.idColumn);
  if (idCol < 0) throw new Error(`Kolom "${opts.idColumn}" tidak ada di baris header ${opts.headerRow} sheet "${table.name}"`);
  const titleCol = col(opts.titleColumn);
  const aliasCols = opts.aliasColumns.map(col).filter((i) => i >= 0);
  const statusCol = col(opts.statusColumn);
  const source = `excel:${sourceFile}#${table.name}`;

  const rows = table.rows.slice(headerIndex + 1);
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`Sheet berisi ${rows.length} baris; maksimum ${MAX_IMPORT_ROWS} per impor`);

  const written: KnowledgeEntry[] = [];
  const skipped: TableImportResult['skipped'] = [];
  const usedNames = new Map<string, number>();
  const indexRows: string[][] = [];
  // the first other columns describe the item in the index
  const summaryCols = headers
    .map((_, i) => i)
    .filter((i) => i !== idCol && i !== titleCol && i !== statusCol && !aliasCols.includes(i))
    .slice(0, 2);

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    const sheetRow = headerIndex + r + 2;
    const id = clean(row[idCol]);
    if (!id) {
      if (row.some((v) => clean(v))) skipped.push({ row: sheetRow, reason: `kolom "${opts.idColumn}" kosong` });
      continue;
    }
    let name = fileNameOf(id);
    const seen = usedNames.get(name.toLowerCase()) ?? 0;
    usedNames.set(name.toLowerCase(), seen + 1);
    if (seen) {
      name = `${name}-${seen + 1}`;
      skipped.push({ row: sheetRow, reason: `id "${id}" duplikat; disimpan sebagai ${name}.md` });
    }
    const title = clean(row[titleCol]) || id;
    const aliases = [...new Set(aliasCols.flatMap((i) => clean(row[i]).split(/[,;\n]/).map((a) => a.trim()).filter((a) => a && a !== id)))];
    const front: Record<string, unknown> = { id, title };
    if (opts.type) front.type = opts.type;
    if (aliases.length) front.aliases = aliases;
    const status = clean(row[statusCol]);
    if (status) front.status = status.toLowerCase();
    const summary = summaryCols
      .map((i) => [headers[i], clean(row[i]).replace(/\s+/g, ' ')] as const)
      .filter(([, v]) => v)
      .map(([h, v]) => `${h}: ${v}`)
      .join(' · ');
    if (summary) front.description = summary.slice(0, 240);
    front.source = `${source} (baris ${sheetRow})`;
    const fields = headers
      .map((h, i) => [h || `Kolom ${i + 1}`, clean(row[i])] as const)
      .filter(([, v]) => v)
      .map(([h, v]) => `- **${h}**: ${cellValue(v)}`);
    const content = `---\n${stringifyYaml(front).trim()}\n---\n\n# ${title}\n\n${fields.join('\n')}\n`;
    written.push(await store.write(`${folder}/${name}.md`, content));
    indexRows.push([
      `[${mdEscape(id)}](${name}.md)`,
      mdEscape(title),
      ...(statusCol >= 0 ? [mdEscape(status)] : []),
      ...summaryCols.map((i) => mdEscape(clean(row[i]))),
    ]);
  }

  const indexPath = `${folder}/INDEX.md`;
  const indexHeader = ['ID', 'Nama', ...(statusCol >= 0 ? ['Status'] : []), ...summaryCols.map((i) => mdEscape(headers[i] || `Kolom ${i + 1}`))];
  const index = [
    '---',
    stringifyYaml({ id: `${folder}-index`, type: 'reference', title: `Indeks ${folder} (${written.length} item)`, source }).trim(),
    '---',
    '',
    `# Indeks ${folder}`,
    '',
    `Dibuat dari ${sourceFile}, sheet "${table.name}". Satu file per baris di folder \`${folder}/\`; baca file itemnya untuk detail.`,
    '',
    `| ${indexHeader.join(' | ')} |`,
    `| ${indexHeader.map(() => '---').join(' | ')} |`,
    ...indexRows.map((r) => `| ${r.join(' | ')} |`),
    '',
  ].join('\n');
  await store.write(indexPath, index);

  const removed: string[] = [];
  if (opts.removeStale) {
    const keep = new Set([...written.map((e) => e.path), indexPath]);
    for (const entry of await store.listAll()) {
      if (entry.source !== 'user' || !entry.path.startsWith(`${folder}/`) || keep.has(entry.path)) continue;
      const file = await store.read(entry.path);
      const origin = file ? String(parseFrontMatter(file.content).meta.source ?? '') : '';
      if (origin === source || origin.startsWith(`${source} (baris `)) {
        await store.remove(entry.path);
        removed.push(entry.path);
      }
    }
  }
  return { written, removed, skipped, index: indexPath };
}
