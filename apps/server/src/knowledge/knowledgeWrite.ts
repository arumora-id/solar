import { stringify as stringifyYaml } from 'yaml';
import type { Artifact, KnowledgeEntry, KnowledgeType } from '@solar/shared';
import type { ArtifactService } from '../tasks/artifactService.js';
import { isAgentKnowledge, normalizeKnowledgePath, parseFrontMatter, type KnowledgeStore } from './knowledgeStore.js';

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

/** A file already exists at the path and `overwrite` was not set. */
export class KnowledgeConflictError extends Error {
  constructor(
    readonly path: string,
    readonly existing: KnowledgeEntry,
  ) {
    super(
      `Knowledge "${path}" sudah ada (${existing.source === 'builtin' ? 'file bawaan' : 'file pengguna'}: ${existing.title}). Baca dulu isinya, lalu simpan ulang dengan overwrite bila memang ingin menggantinya.`,
    );
  }
}

/** An input the import cannot use (unknown artifact, not Markdown); `status` is the HTTP status to answer with. */
export class KnowledgeInputError extends Error {
  constructor(
    readonly status: 400 | 404,
    message: string,
  ) {
    super(message);
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
}

export interface SaveKnowledgeResult {
  entry: KnowledgeEntry;
  /** What was at the path before: a user file, a built-in file (now overridden), or nothing. */
  replaced: 'user' | 'builtin' | null;
}

export function savePathOf(input: Pick<SaveKnowledgeInput, 'path' | 'meta' | 'defaultName'>): string {
  return knowledgePathFor(input.meta.type, input.path, input.meta.id || input.meta.title || input.defaultName || 'knowledge');
}

/**
 * The file already at `path`, also when only the letter case differs: Windows and macOS file systems treat
 * systems/ad1gate.md and systems/AD1GATE.md as the same file.
 */
export async function existingKnowledge(store: KnowledgeStore, path: string): Promise<KnowledgeEntry | null> {
  const exact = await store.read(path);
  if (exact) return exact.entry;
  const lower = path.toLowerCase();
  return (await store.listAll()).find((e) => e.path.toLowerCase() === lower) ?? null;
}

export async function saveKnowledgeFile(store: KnowledgeStore, input: SaveKnowledgeInput): Promise<SaveKnowledgeResult> {
  const path = savePathOf(input);
  if (input.agentReadable && !isAgentKnowledge(path)) {
    throw new KnowledgeInputError(400, `"${path}" adalah panduan untuk manusia (folder/file berawalan "_" atau README.md) dan tidak dibaca agent; pilih path lain.`);
  }
  const existing = await existingKnowledge(store, path);
  if (existing && !input.overwrite) throw new KnowledgeConflictError(existing.path, existing);
  const text = composeKnowledgeFile(input.content, input.meta);
  if (input.dryRun) return { entry: existing ?? ({ path } as KnowledgeEntry), replaced: existing ? existing.source : null };
  // replacing keeps the existing file's spelling, so a case-insensitive file system does not end up with two names
  const entry = await store.write(existing?.path ?? path, text);
  return { entry, replaced: existing ? existing.source : null };
}

export function isMarkdownArtifact(a: Artifact): boolean {
  return a.kind === 'tsd-markdown' || a.mimeType.startsWith('text/markdown') || /\.md$/i.test(a.name);
}

/** The Markdown artifact to import, or an error naming the .md file of the same deliverable. */
export async function markdownArtifact(artifacts: ArtifactService, artifactId: string): Promise<Artifact> {
  const artifact = await artifacts.get(artifactId);
  if (!artifact) throw new KnowledgeInputError(404, `Artefak ${artifactId} tidak ditemukan.`);
  if (isMarkdownArtifact(artifact)) return artifact;
  const sibling = (await artifacts.list(artifact.taskId)).find((a) => a.bundle === artifact.bundle && isMarkdownArtifact(a));
  throw new KnowledgeInputError(
    400,
    `${artifact.name} bukan file Markdown; knowledge base hanya berisi Markdown.${sibling ? ` Pakai ${sibling.name} (${sibling.id}) dari paket yang sama.` : ''}`,
  );
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
