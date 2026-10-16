import { can, type ContentProposalInput } from '@solar/shared';
import { z } from 'zod';
import type { ContentProposalStore } from '../approvals/contentProposalStore.js';
import type { TaskRunContext } from '../tasks/taskManager.js';
import type { AgentTool, ToolOutput } from './types.js';
import { json, zodTool } from './zodTool.js';

// Conversation only stages private proposals. Publishing still requires both administrator reviews.
const proposalInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('skill'),
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().max(1000).optional(),
    content: z.string().trim().min(1).max(100_000),
  }),
  z.object({
    kind: z.literal('knowledge'),
    title: z.string().trim().min(1).max(120),
    path: z.string().trim().min(1).max(300),
    content: z.string().trim().min(1).max(100_000),
  }),
]);

const deny = (): ToolOutput => ({
  isError: true,
  content: 'This action is not available to this requester.',
  summary: 'Access denied',
});

function requester(ctx: TaskRunContext): string | null {
  return ctx.requester && can(ctx.requester.role, 'content.propose') ? ctx.requester.id : null;
}

function ownDrafts(store: ContentProposalStore, authorId: string) {
  // Use the Staff view deliberately; never grant a conversation access to another author's queue.
  return store.list('staff', authorId);
}

export function createContentProposalTools(store: ContentProposalStore): AgentTool[] {
  return [
    zodTool({
      name: 'list_my_content_proposals',
      displayName: { id: 'Lihat usulan saya', en: 'Listing my proposals' },
      description: 'List ONLY the requesting user’s own Skill/Knowledge draft and submission records, including statuses. This does not read published administrator Knowledge or Skills.',
      schema: z.object({}),
      authorize: async (_input, ctx) => requester(ctx) ? null : deny(),
      async execute(_input, ctx) {
        const author = requester(ctx);
        if (!author) return deny();
        const items = ownDrafts(store, author).map((p) => ({
          id: p.id, kind: p.kind, title: p.title, status: p.status,
          path: p.path, description: p.description,
          approvals: p.approvals, rejectionReason: p.rejectionReason,
        }));
        return { content: json(items), summary: 'My proposals: ' + items.length };
      },
    }),
    zodTool({
      name: 'create_content_proposal_draft',
      displayName: { id: 'Simpan draft usulan', en: 'Saving a proposed draft' },
      description: 'Create a PRIVATE draft Skill or Knowledge proposal for the requester. For attached documents, read them first with read_document and identify any unverified facts/formulas in the draft. Never claim that this tool publishes or enables a Skill/Knowledge. The user must confirm saving the draft.',
      schema: z.object({ proposal: proposalInput }),
      authorize: async (_input, ctx) => requester(ctx) ? null : deny(),
      confirmation: (input, lang) => lang === 'id'
        ? 'Simpan draft usulan ' + input.proposal.kind + ' "' + input.proposal.title + '" milik Anda? Draft belum diajukan atau diterbitkan.'
        : 'Save your private ' + input.proposal.kind + ' draft "' + input.proposal.title + '"? This does not submit or publish it.',
      confirmationPreview: async (input) => input.proposal,
      async execute(input, ctx) {
        const author = requester(ctx);
        if (!author) return deny();
        const saved = await store.create(input.proposal as ContentProposalInput, author);
        return {
          content: json({ id: saved.id, kind: saved.kind, status: saved.status, title: saved.title,
            note: 'Private draft saved; explicitly request submit_content_proposal to send for dual review.' }),
          summary: 'Draft saved: ' + saved.title,
        };
      },
    }),
    zodTool({
      name: 'update_content_proposal_draft',
      displayName: { id: 'Revisi draft usulan', en: 'Updating my draft proposal' },
      description: 'Replace the contents of one of the requester’s own DRAFT Skill/Knowledge proposals. Submitted, rejected and published items cannot be modified. Requires user confirmation.',
      schema: z.object({ proposal_id: z.string().trim().min(1).max(100), proposal: proposalInput }),
      authorize: async (input, ctx) => {
        const author = requester(ctx);
        if (!author) return deny();
        const own = ownDrafts(store, author).find((p) => p.id === input.proposal_id && p.authorId === author);
        return own?.status === 'draft' ? null : deny();
      },
      confirmation: (input, lang) => lang === 'id'
        ? 'Timpa isi draft "' + input.proposal.title + '" milik Anda?'
        : 'Replace the contents of your draft "' + input.proposal.title + '"?',
      confirmationPreview: async (input) => input,
      async execute(input, ctx) {
        const author = requester(ctx);
        if (!author) return deny();
        const saved = await store.update(input.proposal_id, author, input.proposal as ContentProposalInput);
        return { content: json({ id: saved.id, status: saved.status, title: saved.title }),
          summary: 'Draft updated: ' + saved.title };
      },
    }),
    zodTool({
      name: 'submit_content_proposal',
      displayName: { id: 'Ajukan draft untuk review', en: 'Submitting proposal for review' },
      description: 'Submit the requester’s own saved Draft for review by BOTH Superadmin and Head of IT SOLAR. Submission locks the draft. Never submit without an explicit confirmation from the user. Does not approve, publish or enable the content.',
      schema: z.object({ proposal_id: z.string().trim().min(1).max(100) }),
      authorize: async (input, ctx) => {
        const author = requester(ctx);
        if (!author) return deny();
        const own = ownDrafts(store, author).find((p) => p.id === input.proposal_id && p.authorId === author);
        return own?.status === 'draft' ? null : deny();
      },
      confirmation: (input, lang) => lang === 'id'
        ? 'Ajukan draft ' + input.proposal_id + ' untuk review Superadmin dan Head of IT SOLAR? Draft tidak bisa diedit setelah Submit.'
        : 'Submit draft ' + input.proposal_id + ' for both Superadmin and Head of IT review? It cannot be edited after submission.',
      confirmationPreview: async (input) => {
        const own = store.list('staff', '').find((p) => p.id === input.proposal_id);
        // The draft body is intentionally not fetched through an administrator view here.
        return own ? { proposal_id: own.id, title: own.title, content: own.content } : input;
      },
      async execute(input, ctx) {
        const author = requester(ctx);
        if (!author) return deny();
        const sent = await store.submit(input.proposal_id, author);
        return { content: json({ id: sent.id, status: sent.status, title: sent.title,
          note: 'Awaiting separate Superadmin and Head of IT reviews; no publication or activation occurred.' }),
          summary: 'Submitted for review: ' + sent.title };
      },
    }),
  ];
}
