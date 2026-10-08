import { z } from 'zod';
import type { Artifact, KnowledgeEntry } from '@solar/shared';
import { isAgentKnowledge, KNOWLEDGE_TYPES, MAX_KNOWLEDGE_FILE_BYTES, normalizeKnowledgePath, type KnowledgeStore } from '../knowledge/knowledgeStore.js';
import {
  composeKnowledgeFile,
  importArtifactToKnowledge,
  existingKnowledge,
  KnowledgeConflictError,
  KnowledgeInputError,
  knowledgeFileName,
  knowledgeState,
  KnowledgeStateChangedError,
  markdownArtifact,
  savePathOf,
  saveKnowledgeFile,
  TYPE_FOLDERS,
  type KnowledgeMeta,
  type SaveKnowledgeResult,
} from '../knowledge/knowledgeWrite.js';
import type { ArtifactService } from '../tasks/artifactService.js';
import { json, zodTool } from './zodTool.js';
import type { AgentTool, ToolOutput } from './types.js';

/** Characters returned per read_knowledge call (follow next_offset for the rest). */
const READ_CHUNK = 40_000;
const MAX_MATCHES = 30;

const typeEnum = z.enum(KNOWLEDGE_TYPES as [string, ...string[]]);

const pathField = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine((p) => {
    try {
      normalizeKnowledgePath(p);
      return true;
    } catch {
      return false;
    }
  }, 'Use folders and a .md file name, e.g. systems/AD1GATE.md');

/** Front matter fields shared by save_knowledge and import_artifact_to_knowledge. */
const metaFields = {
  type: typeEnum.describe('Knowledge type (also picks the default folder): system, integration, standard, document, ...'),
  id: z.string().trim().max(100).optional().describe('Name used in diagrams and documents, e.g. AD1GATE (default: the file name)'),
  title: z.string().trim().max(200).optional(),
  description: z.string().trim().max(500).optional().describe('One-line summary shown in lists'),
  aliases: z.array(z.string().trim().min(1).max(100)).max(30).optional().describe('Other names that may appear in requests or BRDs'),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  status: z.string().trim().max(40).optional().describe('Lifecycle, e.g. active, planned, sunset, retired'),
  overwrite: z.boolean().default(false).describe('Replace an existing file at this path. Read it first and only replace it when the user wants that.'),
};

const metaOf = (input: { type: string; id?: string; title?: string; description?: string; aliases?: string[]; tags?: string[]; status?: string }): KnowledgeMeta => ({
  type: input.type as KnowledgeEntry['type'],
  id: input.id,
  title: input.title,
  description: input.description,
  aliases: input.aliases,
  tags: input.tags,
  status: input.status,
});

interface Approval {
  reason: string;
  /** What was at the path when the user was asked (knowledgeState); the write is refused when it changed since. */
  state: string | null;
}

/**
 * What the user approves: where the file goes, and whether it replaces one. Null when nothing will be written
 * (the write would be refused, so execute only reports why).
 */
async function writeApproval(knowledge: KnowledgeStore, path: string, what: string, overwrite: boolean, text: string): Promise<Approval | null> {
  // guidance paths and files over the size limit are refused before anything is written
  if (!isAgentKnowledge(path) || Buffer.byteLength(text, 'utf8') > MAX_KNOWLEDGE_FILE_BYTES) return null;
  const existing = await existingKnowledge(knowledge, path).catch(() => null);
  // without overwrite an existing file is refused before anything is written: nothing to approve
  if (existing && !overwrite) return null;
  const replaces = existing ? ` - MENGGANTI ${existing.source === 'builtin' ? 'file bawaan' : 'file yang sudah ada'} "${existing.title}" (${existing.path})` : '';
  return {
    reason: `Menyimpan ${what} ke knowledge base: ${path}${replaces}. Isi knowledge base diikuti agent di atas aturan bawaan pada task berikutnya.`,
    state: knowledgeState(existing),
  };
}

/** Output when the knowledge base changed between the approval check and the write. */
const STATE_CHANGED: ToolOutput = {
  isError: true,
  content: 'The knowledge base changed while this call was checked, so nothing was written. Call the tool again.',
  summary: 'tidak ditulis',
};

function saved(result: SaveKnowledgeResult, extra: Record<string, unknown> = {}): ToolOutput {
  const { entry, replaced } = result;
  return {
    content: json({
      status: 'saved',
      path: entry.path,
      id: entry.id,
      type: entry.type,
      title: entry.title,
      replaced,
      ...extra,
      note: 'The file is in the knowledge base now: list_knowledge, search_knowledge and read_knowledge find it, and new tasks get it in their instructions.',
    }),
    summary: `${replaced ? 'diganti' : 'disimpan'}: ${entry.path}`,
  };
}

function refused(err: unknown): ToolOutput {
  if (err instanceof KnowledgeStateChangedError) return STATE_CHANGED;
  if (err instanceof KnowledgeConflictError) {
    return {
      isError: true,
      content: `${err.message}\nNothing was written. Read "${err.path}" with read_knowledge; call again with overwrite: true only if the user wants it replaced, or choose another path.`,
      summary: 'sudah ada',
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: `${message}\nNothing was written.`, summary: err instanceof KnowledgeInputError ? 'ditolak' : 'gagal' };
}

const brief = (e: KnowledgeEntry) => ({
  path: e.path,
  id: e.id,
  type: e.type,
  title: e.title,
  ...(e.status ? { status: e.status } : {}),
  ...(e.aliases.length ? { aliases: e.aliases } : {}),
  ...(e.description ? { description: e.description } : {}),
});

export function createKnowledgeTools(knowledge: KnowledgeStore, artifacts?: ArtifactService): AgentTool[] {
  /**
   * Inputs the user was asked to approve, with what was at the path then. A write tool executes either after an
   * approval or, when its confirmation returned null, only to report why nothing is written: such a call writes
   * nothing, even if the knowledge base changed in between. An approved write is refused when the file at the path
   * changed after the user was asked, so the user never approves one file and gets another replaced.
   */
  const asked = new WeakMap<object, string | null>();
  const ask = (input: object, approval: Approval | null) => {
    if (approval) asked.set(input, approval.state);
    return approval?.reason ?? null;
  };
  const tools: AgentTool[] = [
    zodTool({
      name: 'list_knowledge',
      displayName: 'Daftar knowledge',
      description:
        "List the user's knowledge base files (their own systems, integrations, standards and rules), optionally filtered by type or by words in the id/title/aliases.",
      schema: z.object({
        type: typeEnum.optional().describe('Only files of this type'),
        filter: z.string().max(200).optional().describe('Words that must appear in path, id, title or aliases'),
      }),
      async execute(input) {
        const filter = input.filter?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
        const entries = (await knowledge.list()).filter(
          (e) =>
            (!input.type || e.type === input.type) &&
            filter.every((w) => [e.path, e.id, e.title, ...e.aliases].join(' ').toLowerCase().includes(w)),
        );
        return { content: json({ count: entries.length, files: entries.map(brief) }), summary: `${entries.length} file` };
      },
    }),
    zodTool({
      name: 'search_knowledge',
      displayName: 'Cari knowledge',
      description:
        'Keyword search over the knowledge base. Returns the best files with matching lines (line numbers) - then read the relevant files with read_knowledge.',
      schema: z.object({
        query: z.string().min(2).max(300),
        type: typeEnum.optional(),
        limit: z.number().int().min(1).max(20).default(8),
      }),
      async execute(input) {
        const hits = await knowledge.search(input.query, { type: input.type as KnowledgeEntry['type'] | undefined, limit: input.limit });
        return {
          content: hits.length
            ? json(hits.map((h) => ({ ...brief(h.entry), score: h.score, matches: h.snippets })))
            : `No knowledge file matches "${input.query}". If the request depends on it, record an assumption or open issue instead of inventing facts.`,
          summary: `${hits.length} hasil untuk "${input.query.slice(0, 40)}"`,
        };
      },
    }),
    zodTool({
      name: 'read_knowledge',
      displayName: 'Baca knowledge',
      description: `Read a knowledge base file by path (from list_knowledge / search_knowledge). Long files come in chunks of ${READ_CHUNK} characters: call again with next_offset.`,
      schema: z.object({
        path: z.string().min(1).max(300),
        offset: z.number().int().min(0).default(0),
      }),
      async execute(input) {
        let file;
        try {
          file = await knowledge.read(input.path);
        } catch (err) {
          return { isError: true, content: err instanceof Error ? err.message : String(err), summary: 'path tidak valid' };
        }
        if (!file) return { isError: true, content: `Knowledge file "${input.path}" not found. Use list_knowledge to see the available files.`, summary: 'tidak ditemukan' };
        const chunk = file.content.slice(input.offset, input.offset + READ_CHUNK);
        const end = input.offset + chunk.length;
        const more = end < file.content.length;
        return {
          content: `# ${file.entry.path} (${file.entry.type}: ${file.entry.title})\n\n${chunk}\n\n${more ? `[... more content: call read_knowledge with offset=${end} (next_offset)]` : '[end of file]'}`,
          summary: file.entry.path,
        };
      },
    }),
    zodTool({
      name: 'save_knowledge',
      displayName: 'Simpan knowledge',
      description: [
        'Create or update a Markdown file in the knowledge base (the user approves every write).',
        'Use it only when the user asks to register or update knowledge, e.g. a system, integration, standard or document structure.',
        `Without a path the file goes to "<type folder>/<id or title>.md" (folders: ${Object.entries(TYPE_FOLDERS)
          .map(([t, f]) => `${t} -> ${f}/`)
          .join(', ')}).`,
        'Without path, id and title the name comes from the content (its front matter id/title or first heading).',
        'Front matter (id, type, title, aliases, tags, status) is written for you; content is the Markdown body.',
        'To keep a generated document (e.g. the .md of a TSD) use import_artifact_to_knowledge instead of copying its text.',
      ].join(' '),
      schema: z.object({
        path: pathField.optional().describe('e.g. systems/AD1GATE.md'),
        ...metaFields,
        content: z.string().min(1).max(500_000).describe('Markdown body of the file'),
      }),
      confirmation: async (input) => {
        const path = savePathOf({ path: input.path, meta: metaOf(input), content: input.content });
        const text = composeKnowledgeFile(input.content, metaOf(input));
        return ask(input, await writeApproval(knowledge, path, `${input.type}${input.title ? ` "${input.title}"` : ''}`, input.overwrite, text));
      },
      // the whole file the user approves, shown as text instead of the shortened tool input
      confirmationPreview: async (input) => composeKnowledgeFile(input.content, metaOf(input)),
      async execute(input) {
        const dryRun = !asked.has(input);
        try {
          const result = await saveKnowledgeFile(knowledge, {
            path: input.path,
            meta: metaOf(input),
            content: input.content,
            overwrite: input.overwrite,
            agentReadable: true,
            dryRun,
            approvedState: asked.get(input),
          });
          return dryRun ? STATE_CHANGED : saved(result);
        } catch (err) {
          return refused(err);
        }
      },
    }),
  ];

  if (artifacts) {
    /** The knowledge file an import writes: the artifact's text with the front matter (as importArtifactToKnowledge). */
    const artifactFile = async (artifact: Artifact, input: Parameters<typeof metaOf>[0]) =>
      composeKnowledgeFile(await artifacts.readText(artifact), { ...metaOf(input), source: `artifact:${artifact.id}/${artifact.name}` });
    tools.push(
      zodTool({
        name: 'import_artifact_to_knowledge',
        displayName: 'Simpan artefak ke knowledge',
        description: [
          'Save a Markdown artifact (from this or a previous task, e.g. the .md file of a TSD) as a knowledge base file, so later tasks use it.',
          'Generated artifacts are NOT knowledge until saved with this tool. The user approves every write.',
          'Without a path the file keeps the artifact name in the type folder, e.g. systems/AD1GATE.md. The artifact id is recorded as the source.',
        ].join(' '),
        schema: z.object({
          artifact_id: z.string().regex(/^art_[A-Za-z0-9]+$/),
          path: pathField.optional().describe('e.g. systems/AD1GATE.md (default: <type folder>/<artifact name>)'),
          ...metaFields,
        }),
        confirmation: async (input) => {
          // an unknown or non-Markdown artifact is refused in execute, before anything is written
          const artifact = await markdownArtifact(artifacts, input.artifact_id).catch(() => null);
          if (!artifact) return null;
          const path = input.path ?? `${TYPE_FOLDERS[input.type as KnowledgeEntry['type']]}/${knowledgeFileName(artifact.name)}`;
          let normalized: string;
          try {
            normalized = normalizeKnowledgePath(path);
          } catch {
            return null;
          }
          const text = await artifactFile(artifact, input).catch(() => null);
          if (text === null) return null;
          return ask(input, await writeApproval(knowledge, normalized, `artefak ${artifact.name}`, input.overwrite, text));
        },
        // the artifact and the whole file the user approves (the tool input itself only carries the artifact id)
        confirmationPreview: async (input) => {
          const artifact = await markdownArtifact(artifacts, input.artifact_id);
          return `Artefak ${artifact.name} (${artifact.id}, task ${artifact.taskId}, ${artifact.createdAt}):\n\n${await artifactFile(artifact, input)}`;
        },
        async execute(input) {
          const dryRun = !asked.has(input);
          try {
            const result = await importArtifactToKnowledge(knowledge, artifacts, {
              artifactId: input.artifact_id,
              path: input.path,
              meta: metaOf(input),
              overwrite: input.overwrite,
              agentReadable: true,
              dryRun,
              approvedState: asked.get(input),
            });
            return dryRun ? STATE_CHANGED : saved(result, { source_artifact: { id: result.artifact.id, name: result.artifact.name } });
          } catch (err) {
            return refused(err);
          }
        },
      }),
    );
  }
  return tools;
}

/** Per-task hint: knowledge files whose system/integration names appear in the request or document names. */
export async function knowledgeIntro(store: KnowledgeStore, entries: KnowledgeEntry[], prompt: string, documentNames: string[]): Promise<string> {
  if (!entries.length) return '';
  const matches = store.matchMentions(entries, [prompt, ...documentNames].join('\n')).slice(0, MAX_MATCHES);
  if (!matches.length) return '';
  return `<knowledge_matches>\nKnowledge files that match names in the request (read them with read_knowledge before designing):\n${matches
    .map((e) => `- ${e.path} (${e.type}: ${e.title}${e.status ? `; status ${e.status}` : ''})`)
    .join('\n')}\n</knowledge_matches>`;
}
