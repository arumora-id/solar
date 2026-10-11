import { stringify as stringifyYaml } from 'yaml';
import type { Artifact, KnowledgeEntry, KnowledgeType } from '@solar/shared';
import { both, LocalizedError, type Localized } from '../i18n.js';
import type { ArtifactService } from '../tasks/artifactService.js';
import { describeKnowledge, isAgentKnowledge, MAX_KNOWLEDGE_FILE_BYTES, normalizeKnowledgePath, parseFrontMatter, type KnowledgeStore } from './knowledgeStore.js';

/** Folder for each type when no path is given. The front matter `type` decides the type; the folder only sorts. */
export const TYPE_FOLDERS: Record<KnowledgeType, string> = {
  system: 'systems',
  integration: 'integrations',
  standard: 'standards',
  principle: 'principles',
  nfr: 'nfr',
  process: 'process',
  document: 'documents',
  decision: 'decisions',
  glossary: 'glossary',
  landscape: 'landscape',
  reference: 'references',
};

/** Front matter written with the file. Fields left out keep the value from the content's own front matter. */
export interface KnowledgeMeta {
  type: KnowledgeType;
  id?: string;
  title?: string;
  description?: string;
  aliases?: string[];
  tags?: string[];
  status?: string;
  /** Where the content came from, e.g. "artifact:art_123/AD1GATE.md". */
  source?: string;
}

const KEY_ORDER = ['id', 'type', 'title', 'description', 'aliases', 'tags', 'status', 'source'];

/** Markdown with front matter: the fields in `meta` replace the same fields of the content's own front matter. */
export function composeKnowledgeFile(content: string, meta: KnowledgeMeta): string {
  const { meta: existing, body } = parseFrontMatter(content);
  const merged: Record<string, unknown> = { ...existing };
  const set = (key: string, value: string | string[] | undefined) => {
    const v = Array.isArray(value) ? value.map((s) => s.trim()).filter(Boolean) : value?.trim();
    if (v && v.length) merged[key] = v;
  };
  set('id', meta.id);
  set('type', meta.type);
  set('title', meta.title);
  set('description', meta.description);
  set('aliases', meta.aliases);
  set('tags', meta.tags);
  set('status', meta.status);
  set('source', meta.source);
  const ordered = Object.fromEntries([
    ...KEY_ORDER.filter((k) => k in merged).map((k) => [k, merged[k]] as const),
    ...Object.entries(merged).filter(([k]) => !KEY_ORDER.includes(k)),
  ]);
  return `---\n${stringifyYaml(ordered).trimEnd()}\n---\n\n${body.replace(/^\s+/, '').trimEnd()}\n`;
}

/** A file name allowed in the knowledge base (letters, digits, dot, dash, underscore, space; ends in .md). */
export function knowledgeFileName(name: string): string {
  const base = name
    .replace(/\.(md|markdown)$/i, '')
    .replace(/[^A-Za-z0-9._ -]+/g, '-')
    .replace(/^[^A-Za-z0-9_]+/, '')
    .replace(/[-. ]+$/, '')
    .slice(0, 96);
  return `${base || 'knowledge'}.md`;
}

/** The path a file is saved at: the given one, or "<type folder>/<name>.md". */
export function knowledgePathFor(type: KnowledgeType, path: string | undefined, fallbackName: string): string {
  return normalizeKnowledgePath(path?.trim() ? path : `${TYPE_FOLDERS[type]}/${knowledgeFileName(fallbackName)}`);
}

/**
 * A file already exists at the path and `overwrite` was not set. Like the other errors below it carries its message in
 * both languages: `message` is Indonesian (what the agent tools return, as before), the API answers with `in(lang)`.
 */
export class KnowledgeConflictError extends LocalizedError {
  constructor(
    readonly path: string,
    readonly existing: KnowledgeEntry,
  ) {
    super(both(existing.source === 'builtin' ? 'knowledge.conflict.builtin' : 'knowledge.conflict.user', { path, title: existing.title }));
  }
}

/** An input the import cannot use (unknown artifact, not Markdown); `status` is the HTTP status to answer with. */
export class KnowledgeInputError extends LocalizedError {
  constructor(
    readonly status: 400 | 404,
    text: Localized,
  ) {
    super(text);
  }
}

export interface SaveKnowledgeInput {
  /** Relative path, e.g. systems/AD1GATE.md; default "<type folder>/<id, title or name>.md". */
  path?: string;
  meta: KnowledgeMeta;
  /** Markdown (may have its own front matter; `meta` wins). */
  content: string;
  /** Replace an existing file at the path (a built-in file gets a user copy that overrides it). */
  overwrite?: boolean;
  /** File name to use when there is no path, id or title. */
  defaultName?: string;
  /** Refuse guidance paths (_templates/, README.md): the agent saves knowledge in order to use it. */
  agentReadable?: boolean;
  /** Run every check (and throw the same errors) without writing. */
  dryRun?: boolean;
  /** What was at the path when the user approved (knowledgeState); the save is refused when that changed since. */
  approvedState?: string | null;
}

export interface SaveKnowledgeResult {
  entry: KnowledgeEntry;
  /** What was at the path before: a user file, a built-in file (now overridden), or nothing. */
  replaced: 'user' | 'builtin' | null;
}

export function savePathOf(input: Pick<SaveKnowledgeInput, 'path' | 'meta' | 'defaultName'> & { content?: string }): string {
  return knowledgePathFor(input.meta.type, input.path, input.meta.id || input.meta.title || input.defaultName || contentName(input.content) || 'knowledge');
}

/** The name a file is known by in its own text: the front matter id or title, else the first heading. */
function contentName(content: string | undefined): string {
  if (!content) return '';
  const { meta, body } = parseFrontMatter(content);
  const name = [meta.id, meta.title].find((v): v is string => typeof v === 'string' && v.trim() !== '');
  return name?.trim() ?? /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? '';
}

/**
 * The file already at `path`, also when only the letter case differs: Windows and macOS file systems treat
 * systems/ad1gate.md and systems/AD1GATE.md as the same file.
 */
export async function existingKnowledge(store: KnowledgeStore, path: string): Promise<KnowledgeEntry | null> {
  const exact = await store.read(path);
  if (exact) return exact.entry;
  const lower = path.toLowerCase();
  const listed = (await store.listAll()).find((e) => e.path.toLowerCase() === lower);
  if (listed) return listed;
  // a file the store does not list (too large to read, or past the file limit) is still there and must not be replaced silently
  const onDisk = await store.locate(path);
  return onDisk ? describeKnowledge(onDisk.path, '', onDisk.source, onDisk.size, onDisk.updatedAt) : null;
}

/** Identifies what is at a path, so a write can tell whether it changed after the user approved it. */
export function knowledgeState(existing: KnowledgeEntry | null): string | null {
  return existing ? `${existing.source}:${existing.path}:${existing.size}:${existing.updatedAt}` : null;
}

/** The file at the path changed (was created, replaced or removed) after the user was asked to approve the write. */
export class KnowledgeStateChangedError extends LocalizedError {
  constructor(readonly path: string) {
    super(both('knowledge.stateChanged', { path }));
  }
}

/** One check-and-write at a time per store (agent tools and the API), so two saves cannot both see "nothing there". */
const writeQueues = new WeakMap<KnowledgeStore, Promise<unknown>>();
function serialized<T>(store: KnowledgeStore, run: () => Promise<T>): Promise<T> {
  const next = (writeQueues.get(store) ?? Promise.resolve()).then(run);
  writeQueues.set(store, next.catch(() => undefined));
  return next;
}

export async function saveKnowledgeFile(store: KnowledgeStore, input: SaveKnowledgeInput): Promise<SaveKnowledgeResult> {
  const path = savePathOf(input);
  if (input.agentReadable && !isAgentKnowledge(path)) {
    throw new KnowledgeInputError(400, both('knowledge.guidancePath', { path }));
  }
  const text = composeKnowledgeFile(input.content, input.meta);
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_KNOWLEDGE_FILE_BYTES) {
    throw new KnowledgeInputError(400, both('knowledge.fileTooLarge', { kb: Math.ceil(bytes / 1024), max: MAX_KNOWLEDGE_FILE_BYTES / 1024 }));
  }
  return serialized(store, async () => {
    const existing = await existingKnowledge(store, path);
    if (existing && !input.overwrite) throw new KnowledgeConflictError(existing.path, existing);
    if (input.approvedState !== undefined && knowledgeState(existing) !== input.approvedState) throw new KnowledgeStateChangedError(path);
    if (input.dryRun) return { entry: existing ?? ({ path } as KnowledgeEntry), replaced: existing ? existing.source : null };
    // replacing keeps the existing file's spelling, so a case-insensitive file system does not end up with two names
    const entry = await store.write(existing?.path ?? path, text);
    return { entry, replaced: existing ? existing.source : null };
  });
}

export function isMarkdownArtifact(a: Artifact): boolean {
  return a.kind === 'tsd-markdown' || a.mimeType.startsWith('text/markdown') || /\.md$/i.test(a.name);
}

/** The Markdown artifact to import, or an error naming the .md file of the same deliverable. */
export async function markdownArtifact(artifacts: ArtifactService, artifactId: string): Promise<Artifact> {
  const artifact = await artifacts.get(artifactId);
  if (!artifact) throw new KnowledgeInputError(404, both('knowledge.artifactNotFound', { id: artifactId }));
  if (isMarkdownArtifact(artifact)) return artifact;
  const sibling = (await artifacts.list(artifact.taskId)).find((a) => a.bundle === artifact.bundle && isMarkdownArtifact(a));
  const notMarkdown = both('knowledge.notMarkdown', { name: artifact.name });
  const hint = sibling ? both('knowledge.useSibling', { name: sibling.name, id: sibling.id }) : { id: '', en: '' };
  throw new KnowledgeInputError(400, { id: notMarkdown.id + hint.id, en: notMarkdown.en + hint.en });
}

export interface ImportArtifactInput extends Omit<SaveKnowledgeInput, 'content' | 'defaultName'> {
  artifactId: string;
}

/** Saves a Markdown artifact (e.g. the .md of a TSD) as a knowledge file, recording the artifact as its source. */
export async function importArtifactToKnowledge(
  store: KnowledgeStore,
  artifacts: ArtifactService,
  input: ImportArtifactInput,
): Promise<SaveKnowledgeResult & { artifact: Artifact }> {
  const artifact = await markdownArtifact(artifacts, input.artifactId);
  const content = await artifacts.readText(artifact);
  const result = await saveKnowledgeFile(store, {
    ...input,
    content,
    defaultName: artifact.name,
    // without an explicit path the file keeps the artifact's name (AD1GATE.md), not its id or title
    path: input.path ?? `${TYPE_FOLDERS[input.meta.type]}/${knowledgeFileName(artifact.name)}`,
    meta: { ...input.meta, source: input.meta.source ?? `artifact:${artifact.id}/${artifact.name}` },
  });
  return { ...result, artifact };
}
