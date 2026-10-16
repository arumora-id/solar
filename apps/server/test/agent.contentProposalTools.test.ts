import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '@solar/shared';
import { ContentProposalStore } from '../src/approvals/contentProposalStore.js';
import { createContentProposalTools } from '../src/agent/contentProposalTools.js';
import type { AgentTool } from '../src/agent/types.js';
import type { TaskRunContext } from '../src/tasks/taskManager.js';

const folder = mkdtempSync(join(tmpdir(), 'solar-agent-proposals-'));
const store = new ContentProposalStore(folder);
const tools = new Map(createContentProposalTools(store).map((tool) => [tool.name, tool]));

const ctx = (id: string, role: Role = 'staff') =>
  ({ requester: { id, name: id, role } }) as unknown as TaskRunContext;

function tool(name: string): AgentTool {
  const found = tools.get(name);
  if (!found) throw new Error('Missing tool ' + name);
  return found;
}

async function invoke(name: string, input: unknown, who: TaskRunContext) {
  const action = tool(name);
  const parsed = action.parse(input);
  if (!parsed.ok) throw new Error(parsed.error);
  const denied = await action.authorize?.(parsed.value, who);
  return denied ?? action.execute(parsed.value, who);
}

const skill = (title: string) => ({
  kind: 'skill', title, description: 'Test procedure', content: '# ' + title + '\n\nSteps and validation.',
});

beforeAll(async () => store.init());
afterAll(() => rmSync(folder, { recursive: true, force: true }));

describe('agent proposals: permissions and governance', () => {
  it('requires a visible confirmation before creating or submitting proposals', async () => {
    const draft = tool('create_content_proposal_draft');
    const parsed = draft.parse({ proposal: skill('Runbook') });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(await draft.confirmation(parsed.value, 'id')).toContain('Simpan draft');
    expect(await draft.confirmationPreview?.(parsed.value, 'id')).toMatchObject({ kind: 'skill', title: 'Runbook' });
    const submit = tool('submit_content_proposal');
    const sub = submit.parse({ proposal_id: 'proposal_test' });
    expect(sub.ok).toBe(true);
    if (sub.ok) expect(await submit.confirmation(sub.value, 'id')).toContain('Ajukan draft');
  });

  it('creates a private draft, allows own previews and revisions, then submits without publishing', async () => {
    const alice = ctx('alice');
    const created = await invoke('create_content_proposal_draft', { proposal: skill('Team SOP') }, alice);
    expect(created.isError).not.toBe(true);
    const id = (JSON.parse(created.content as string) as { id: string }).id;
    const own = await invoke('list_my_content_proposals', {}, alice);
    expect(JSON.parse(own.content as string)).toMatchObject([{ id, status: 'draft' }]);
    const preview = await invoke('read_my_content_proposal', { proposal_id: id }, alice);
    expect(JSON.parse(preview.content as string).content).toContain('Team SOP');
    const updated = await invoke('update_content_proposal_draft',
      { proposal_id: id, proposal: skill('Team SOP revised') }, alice);
    expect(updated.isError).not.toBe(true);
    const sent = await invoke('submit_content_proposal', { proposal_id: id }, alice);
    expect(JSON.parse(sent.content as string)).toMatchObject({ id, status: 'submitted' });
    expect((await store.list('staff', 'alice')).find((p) => p.id === id)?.status).toBe('submitted');
    expect((await store.list('staff', 'bob')).some((p) => p.id === id)).toBe(false);
    expect((await invoke('update_content_proposal_draft',
      { proposal_id: id, proposal: skill('Changed after submit') }, alice)).isError).toBe(true);
    expect((await invoke('submit_content_proposal', { proposal_id: id }, alice)).isError).toBe(true);
  });

  it('blocks access to proposals by another account, including administrators', async () => {
    const created = await invoke('create_content_proposal_draft', { proposal: skill('Private') }, ctx('owner'));
    const id = (JSON.parse(created.content as string) as { id: string }).id;
    for (const who of [ctx('other'), ctx('admin', 'superadmin'), ctx('head', 'head_of_it')]) {
      expect((await invoke('read_my_content_proposal', { proposal_id: id }, who)).isError).toBe(true);
      expect((await invoke('update_content_proposal_draft',
        { proposal_id: id, proposal: skill('Stolen') }, who)).isError).toBe(true);
      expect((await invoke('submit_content_proposal', { proposal_id: id }, who)).isError).toBe(true);
    }
    expect((await invoke('read_my_content_proposal', { proposal_id: id },
      { requester: null } as unknown as TaskRunContext)).isError).toBe(true);
  });

  it('creates knowledge proposal without touching live Knowledge and refuses invalid input', async () => {
    const invalid = tool('create_content_proposal_draft').parse({
      proposal: { kind: 'knowledge', title: 'Standard', path: '', content: '# Standard' },
    });
    expect(invalid.ok).toBe(false);
    const result = await invoke('create_content_proposal_draft', {
      proposal: { kind: 'knowledge', title: 'Standard', path: 'standards/team.md', content: '# Standard' },
    }, ctx('knowledge-author'));
    expect(result.isError).not.toBe(true);
    const id = (JSON.parse(result.content as string) as { id: string }).id;
    const record = store.list('staff', 'knowledge-author').find((p) => p.id === id);
    expect(record).toMatchObject({ kind: 'knowledge', path: 'standards/team.md', status: 'draft' });
    expect(record?.approvals).toEqual({});
  });
});
