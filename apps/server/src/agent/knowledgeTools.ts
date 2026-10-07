import { z } from 'zod';
import type { KnowledgeEntry } from '@solar/shared';
import { KNOWLEDGE_TYPES, type KnowledgeStore } from '../knowledge/knowledgeStore.js';
import { json, zodTool } from './zodTool.js';
import type { AgentTool } from './types.js';

/** Characters returned per read_knowledge call (follow next_offset for the rest). */
const READ_CHUNK = 40_000;
const MAX_MATCHES = 30;

const typeEnum = z.enum(KNOWLEDGE_TYPES as [string, ...string[]]);

const brief = (e: KnowledgeEntry) => ({
  path: e.path,
  id: e.id,
  type: e.type,
  title: e.title,
  ...(e.status ? { status: e.status } : {}),
  ...(e.aliases.length ? { aliases: e.aliases } : {}),
  ...(e.description ? { description: e.description } : {}),
});

export function createKnowledgeTools(knowledge: KnowledgeStore): AgentTool[] {
  return [
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
  ];
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
