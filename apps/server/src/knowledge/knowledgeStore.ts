import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { KnowledgeEntry, KnowledgeFile, KnowledgeSearchHit, KnowledgeType } from '@solar/shared';
import { resolveInside, writeFileAtomic } from '../util/fs.js';

export const MAX_KNOWLEDGE_FILE_BYTES = 512 * 1024;

/** Lifecycle values meaning "do not use in new solutions" (English and Indonesian). */
const RETIRED = /^(sunset|retired?|retiring|decommission(ed)?|deprecated|inactive|obsolete|phase[- ]?out|end[- ]of[- ]life|eol|tidak aktif|non[- ]?aktif|pensiun|dihentikan)$/i;

export function isRetired(status: string): boolean {
  return RETIRED.test(status.trim());
}
const MAX_FILES = 2000;

export const KNOWLEDGE_TYPES: readonly KnowledgeType[] = [
  'system',
  'integration',
  'standard',
  'principle',
  'nfr',
  'process',
  'document',
  'decision',
  'glossary',
  'landscape',
  'reference',
];

/** Top-level folder -> type (front matter `type` wins). */
const FOLDER_TYPES: Record<string, KnowledgeType> = {
  systems: 'system',
  system: 'system',
  integrations: 'integration',
  integration: 'integration',
  standards: 'standard',
  standard: 'standard',
  principles: 'principle',
  nfr: 'nfr',
  process: 'process',
  processes: 'process',
  documents: 'document',
  decisions: 'decision',
  adr: 'decision',
  glossary: 'glossary',
  landscape: 'landscape',
};

/** Root-level file names -> type (e.g. ARCHIMATE.md, api-specification.md, LANDSCAPE.md). */
function typeFromName(name: string): KnowledgeType | undefined {
  const n = name.toLowerCase().replace(/\.md$/, '');
  if (/landscape|catalog|katalog/.test(n)) return 'landscape';
  if (/glossary|glosarium|istilah/.test(n)) return 'glossary';
  if (/principle|prinsip|guardrail/.test(n)) return 'principle';
  if (/security|keamanan|nfr|performance|availability|compliance/.test(n)) return 'nfr';
  if (/^(hld|tsd)$|template-|document/.test(n)) return 'document';
  if (/^adr[-_]/.test(n)) return 'decision';
  if (/archimate|sequence|plantuml|api|naming|data|error|standard|openapi/.test(n)) return 'standard';
  if (/backlog|brd|option|opsi|approval/.test(n)) return 'process';
  return undefined;
}

/** Relative knowledge path: folders and a .md file name, no hidden or parent segments. */
export const KNOWLEDGE_PATH = /^(?:[A-Za-z0-9_][A-Za-z0-9._ -]{0,79}\/){0,4}[A-Za-z0-9_][A-Za-z0-9._ -]{0,99}\.md$/;

export function normalizeKnowledgePath(path: string): string {
  const p = path.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!KNOWLEDGE_PATH.test(p) || p.split('/').some((seg) => seg === '..' || seg.startsWith('.'))) {
    throw new Error(`Invalid knowledge path "${path}": use folders and a .md file name, e.g. systems/AD1GATE.md`);
  }
  return p;
}

interface ParsedFile {
  meta: Record<string, unknown>;
  body: string;
}

export function parseFrontMatter(raw: string): ParsedFile {
  const text = raw.replace(/^﻿/, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return { meta: {}, body: text };
  try {
    const parsed: unknown = parseYaml(match[1] ?? '');
    const mapping = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
    // a non-empty block that is not a YAML mapping (rules around a heading, text or a list) is content, not front matter
    if (!mapping && (match[1] ?? '').trim()) return { meta: {}, body: text };
    return { meta: mapping ? (parsed as Record<string, unknown>) : {}, body: match[2] ?? '' };
  } catch {
    return { meta: {}, body: text };
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter(Boolean) : typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];

export function describeKnowledge(path: string, raw: string, source: 'builtin' | 'user', size: number, updatedAt: string): KnowledgeEntry {
  const { meta, body } = parseFrontMatter(raw);
  const segments = path.split('/');
  const fileName = segments[segments.length - 1]!;
  const baseName = fileName.replace(/\.md$/i, '');
  const metaType = str(meta.type).toLowerCase() as KnowledgeType;
  const type: KnowledgeType = KNOWLEDGE_TYPES.includes(metaType)
    ? metaType
    : (segments.length > 1 ? FOLDER_TYPES[segments[0]!.toLowerCase()] : undefined) ?? typeFromName(fileName) ?? 'reference';
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  const paragraph = body
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.trim())
    .find((block) => block && !block.startsWith('#') && !block.startsWith('|') && !block.startsWith('```') && !block.startsWith('<!--'));
  const description = str(meta.description) || (paragraph ? paragraph.replace(/\s+/g, ' ').slice(0, 240) : '');
  return {
    path,
    id: str(meta.id) || baseName,
    type,
    title: str(meta.title) || str(meta.name) || heading || baseName,
    description,
    aliases: strList(meta.aliases),
    tags: strList(meta.tags),
    status: str(meta.status).toLowerCase(),
    source,
    size,
    updatedAt,
  };
}

async function listMarkdown(dir: string, root = dir, depth = 0, out: string[] = []): Promise<string[]> {
  if (depth > 5 || out.length >= MAX_FILES) return out;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await listMarkdown(full, root, depth + 1, out);
    else if (entry.isFile() && /\.md$/i.test(entry.name)) out.push(relative(root, full).split(sep).join('/'));
    if (out.length >= MAX_FILES) break;
  }
  return out;
}

/** Folders/files starting with "_" (e.g. _templates/) and README.md are guidance for people, not agent knowledge. */
export function isAgentKnowledge(path: string): boolean {
  return !path.split('/').some((seg) => seg.startsWith('_')) && !/^readme\.md$/i.test(path);
}

function words(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}_.-]+/u).filter((w) => w.length >= 2))].slice(0, 20);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The architect's knowledge base: Markdown files describing their systems, integrations and standards.
 * Built-in examples ship in `knowledge/`; the user's files live in `<dataDir>/knowledge/` and override a
 * built-in file with the same path.
 */
export class KnowledgeStore {
  constructor(
    private readonly builtinDir: string,
    private readonly userDir: string,
  ) {}

  async init(): Promise<void> {
    await mkdir(this.userDir, { recursive: true });
  }

  private async scan(): Promise<Map<string, { full: string; source: 'builtin' | 'user' }>> {
    const out = new Map<string, { full: string; source: 'builtin' | 'user' }>();
    for (const [dir, source] of [
      [this.builtinDir, 'builtin'],
      [this.userDir, 'user'],
    ] as const) {
      if (!existsSync(dir)) continue;
      for (const rel of await listMarkdown(dir)) {
        if (KNOWLEDGE_PATH.test(rel)) out.set(rel, { full: join(dir, rel), source });
      }
    }
    return out;
  }

  private async describe(path: string, file: { full: string; source: 'builtin' | 'user' }): Promise<KnowledgeFile | null> {
    const info = await stat(file.full);
    if (info.size > MAX_KNOWLEDGE_FILE_BYTES) return null;
    const content = await readFile(file.full, 'utf8');
    return { entry: describeKnowledge(path, content, file.source, info.size, info.mtime.toISOString()), content };
  }

  /** Every file, including guidance files (README, _templates). */
  async listAll(): Promise<KnowledgeEntry[]> {
    const out: KnowledgeEntry[] = [];
    for (const [path, file] of await this.scan()) {
      const described = await this.describe(path, file);
      if (described) out.push(described.entry);
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** The files the agent uses (guidance files excluded). */
  async list(): Promise<KnowledgeEntry[]> {
    return (await this.listAll()).filter((e) => isAgentKnowledge(e.path));
  }

  async read(path: string): Promise<KnowledgeFile | null> {
    const p = normalizeKnowledgePath(path);
    const file = (await this.scan()).get(p);
    return file ? this.describe(p, file) : null;
  }

  /**
   * The file on disk at `path` (user copy first), also when only the letter case differs. Unlike read() and
   * listAll() it also finds the files those leave out: larger than MAX_KNOWLEDGE_FILE_BYTES or past MAX_FILES.
   */
  async locate(path: string): Promise<{ path: string; source: 'builtin' | 'user'; size: number; updatedAt: string } | null> {
    const segments = normalizeKnowledgePath(path).split('/');
    for (const [dir, source] of [
      [this.userDir, 'user'],
      [this.builtinDir, 'builtin'],
    ] as const) {
      let full = dir;
      const found: string[] = [];
      for (const seg of segments) {
        const names = await readdir(full).catch(() => [] as string[]);
        const name = names.find((n) => n === seg) ?? names.find((n) => n.toLowerCase() === seg.toLowerCase());
        if (!name) break;
        found.push(name);
        full = join(full, name);
      }
      if (found.length < segments.length) continue;
      const info = await stat(full).catch(() => null);
      if (info?.isFile()) return { path: found.join('/'), source, size: info.size, updatedAt: info.mtime.toISOString() };
    }
    return null;
  }

  async write(path: string, content: string): Promise<KnowledgeEntry> {
    const p = normalizeKnowledgePath(path);
    if (Buffer.byteLength(content, 'utf8') > MAX_KNOWLEDGE_FILE_BYTES) throw new Error(`File is larger than ${MAX_KNOWLEDGE_FILE_BYTES / 1024} KB`);
    const full = resolveInside(this.userDir, p);
    const text = content.replace(/\r\n/g, '\n');
    await writeFileAtomic(full, text);
    // describe what was written: a read-back through scan() misses files past MAX_FILES or spelled in another case
    const info = await stat(full);
    return describeKnowledge(p, text, 'user', info.size, info.mtime.toISOString());
  }

  /** Deletes a user file. For a file that overrides a built-in one, the built-in version comes back. */
  async remove(path: string): Promise<'deleted' | 'reverted'> {
    const p = normalizeKnowledgePath(path);
    const full = resolveInside(this.userDir, p);
    if (!existsSync(full)) throw new Error(`"${p}" is not a user file (built-in files can be overridden, not deleted)`);
    await rm(full, { force: true });
    return existsSync(resolveInside(this.builtinDir, p)) ? 'reverted' : 'deleted';
  }

  /** Keyword search: metadata matches weigh more than body matches. Returns up to 3 matching lines per file. */
  async search(query: string, opts: { type?: KnowledgeType; limit?: number } = {}): Promise<KnowledgeSearchHit[]> {
    const terms = words(query);
    if (!terms.length) return [];
    const hits: KnowledgeSearchHit[] = [];
    for (const [path, file] of await this.scan()) {
      if (!isAgentKnowledge(path)) continue;
      const described = await this.describe(path, file);
      if (!described) continue;
      const { entry, content } = described;
      if (opts.type && entry.type !== opts.type) continue;
      const meta = [entry.id, entry.title, entry.path, ...entry.aliases].join(' ').toLowerCase();
      const tags = entry.tags.join(' ').toLowerCase();
      const lower = content.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (meta.includes(t)) score += 10;
        if (tags.includes(t)) score += 5;
        const count = lower.split(t).length - 1;
        score += Math.min(count, 10);
      }
      if (score === 0) continue;
      // body lines matching the most distinct terms (front matter is already in the entry), in file order
      const lines = content.split('\n');
      const bodyStart = lines[0]?.replace(/^\uFEFF/, '') === '---' ? lines.indexOf('---', 1) + 1 : 0;
      const snippets = lines
        .map((text, i) => ({ line: i + 1, text: text.trim().slice(0, 300), n: terms.filter((t) => text.toLowerCase().includes(t)).length }))
        .filter((l) => l.n > 0 && l.line > bodyStart)
        .sort((a, b) => b.n - a.n || a.line - b.line)
        .slice(0, 3)
        .sort((a, b) => a.line - b.line)
        .map(({ line, text }) => ({ line, text }));
      hits.push({ entry, score, snippets });
    }
    return hits.sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path)).slice(0, opts.limit ?? 10);
  }

  /** System and integration files whose id, title or alias is mentioned (as a whole word) in the text. */
  matchMentions(entries: KnowledgeEntry[], text: string): KnowledgeEntry[] {
    if (!text.trim()) return [];
    return entries.filter((e) =>
      (e.type === 'system' || e.type === 'integration') &&
      [e.id, e.title, ...e.aliases]
        .filter((name) => name.length >= 2)
        .some((name) => new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRe(name)}($|[^\\p{L}\\p{N}_])`, 'iu').test(text)),
    );
  }
}
