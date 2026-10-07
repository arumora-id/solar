import { stringify as stringifyYaml } from 'yaml';
import type { KnowledgeEntry, KnowledgeType } from '@solar/shared';
import { normalizeKnowledgePath, parseFrontMatter, type KnowledgeStore } from './knowledgeStore.js';
import { fileNameOf } from './tableImport.js';

export interface DocumentImportOptions {
  /** Target folder, e.g. "standards". */
  folder: string;
  /** none = one file; 1/2 = one file per heading of that level (and above). */
  split: 'none' | 1 | 2;
  type?: KnowledgeType;
  /** Title / file name (default: the document's file name). */
  title?: string;
  removeStale: boolean;
}

export interface DocumentImportResult {
  written: KnowledgeEntry[];
  removed: string[];
  warnings: string[];
}

interface Section {
  heading: string;
  body: string;
}

/** Splits Markdown at headings of `level` or higher (ignores "#" inside fenced code). */
export function splitSections(markdown: string, level: 1 | 2): Section[] {
  const sections: Section[] = [];
  let current: Section = { heading: '', body: '' };
  let fence = false;
  const re = level === 1 ? /^#\s+(.+)$/ : /^#{1,2}\s+(.+)$/;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const m = fence ? null : re.exec(line);
    if (m) {
      if (current.heading || current.body.trim()) sections.push(current);
      current = { heading: m[1]!.replace(/[*_`]/g, '').trim(), body: `${line}\n` };
    } else {
      current.body += `${line}\n`;
    }
  }
  if (current.heading || current.body.trim()) sections.push(current);
  return sections;
}

function front(meta: Record<string, unknown>): string {
  return `---\n${stringifyYaml(meta).trim()}\n---\n\n`;
}

/** Stores an extracted document (Word, PDF, PowerPoint, Markdown, text) as knowledge, whole or one file per chapter. */
export async function importDocument(
  store: KnowledgeStore,
  markdown: string,
  sourceFile: string,
  opts: DocumentImportOptions,
): Promise<DocumentImportResult> {
  const folder = opts.folder.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  normalizeKnowledgePath(`${folder}/x.md`);
  if (folder.split('/').some((seg) => seg.startsWith('_'))) throw new Error('The folder must not start with "_" (those files are not read by the agent)');
  const title = opts.title?.trim() || sourceFile.replace(/\.[^.]+$/, '');
  const base = fileNameOf(title);
  const source = `doc:${sourceFile}`;
  const typeMeta = opts.type ? { type: opts.type } : {};
  const written: KnowledgeEntry[] = [];
  const warnings: string[] = [];

  // one title heading with chapters below it: split one level deeper
  let sections = opts.split === 'none' ? [] : splitSections(markdown, opts.split);
  if (opts.split === 1 && sections.length <= 1) sections = splitSections(markdown, 2);
  if (opts.split !== 'none' && sections.length <= 1) warnings.push('Dokumen tidak punya heading untuk dipecah; disimpan sebagai satu file.');

  if (sections.length <= 1) {
    written.push(await store.write(`${folder}/${base}.md`, `${front({ id: title, title, ...typeMeta, source })}${markdown.trim()}\n`));
  } else {
    const pad = String(sections.length).length;
    const used = new Set<string>();
    const index: string[] = [];
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i]!;
      const heading = s.heading || 'Pendahuluan';
      let name = `${String(i + 1).padStart(Math.max(2, pad), '0')}-${fileNameOf(heading).slice(0, 60)}`;
      while (used.has(name)) name = `${name}-x`;
      used.add(name);
      const body = s.heading ? s.body : `# ${heading}\n\n${s.body}`;
      const entry = await store.write(
        `${folder}/${base}/${name}.md`,
        `${front({ id: `${base}-${String(i + 1).padStart(2, '0')}`, title: `${title}: ${heading}`, ...typeMeta, source: `${source} (bab ${i + 1})` })}${body.trim()}\n`,
      );
      written.push(entry);
      index.push(`- [${heading.replace(/[[\]]/g, '')}](${name}.md)`);
    }
    written.push(
      await store.write(
        `${folder}/${base}/INDEX.md`,
        `${front({ id: base, title, ...typeMeta, source })}# ${title}\n\nDiimpor dari ${sourceFile}, dipecah per bab. Baca bab yang relevan:\n\n${index.join('\n')}\n`,
      ),
    );
  }

  const removed: string[] = [];
  if (opts.removeStale) {
    const keep = new Set(written.map((e) => e.path));
    for (const entry of await store.listAll()) {
      if (entry.source !== 'user' || !entry.path.startsWith(`${folder}/`) || keep.has(entry.path)) continue;
      const file = await store.read(entry.path);
      const origin = file ? String(parseFrontMatter(file.content).meta.source ?? '') : '';
      if (origin === source || origin.startsWith(`${source} (bab `)) {
        await store.remove(entry.path);
        removed.push(entry.path);
      }
    }
  }
  return { written, removed, warnings };
}
