import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Confirmation, ContentProposal, Task, TaskDetail } from '@solar/shared';
import type { RunningServer } from '../src/server.js';
import {
  authTestConfig, fnCall, message, startAuthServer, StatelessModel,
  tokenClient, userClient, waitFor, TEST_ACCESS_TOKEN, type Client,
} from './helpers/authServer.js';

const model = new StatelessModel((input, text) => {
  if (input.some((i) => i.type === 'function_call_output')) return [message('Request processed')];
  const request = /<request>\n([\s\S]*?)\n<\/request>/.exec(text)?.[1] ?? '';
  if (request.includes('[draft]')) {
    return [fnCall('new_draft', 'create_content_proposal_draft', {
      proposal: { kind: 'knowledge', title: 'Incident response', path: 'standards/incident-response.md',
        content: '# Incident response\n\nSource: incident-runbook.md, supplied by the requester.' },
    })];
  }
  const id = /\[submit:(proposal_[A-Za-z0-9]+)\]/.exec(request)?.[1];
  if (id) return [fnCall('send_draft', 'submit_content_proposal', { proposal_id: id })];
  return [message('Nothing to change')];
});

let server: RunningServer;
let staff: Client;
let stranger: Client;
let owner: Client;
let head: Client;

async function task(client: Client, prompt: string, sessionId: string): Promise<Task> {
  const res = await client.post<Task>('/api/tasks', { prompt, sessionId });
  expect(res.status).toBe(201);
  return res.body;
}

async function pending(client: Client): Promise<Confirmation> {
  return waitFor(async () => {
    const r = await client.get<Confirmation[]>('/api/confirmations');
    return r.body.find((x) => x.status === 'pending');
  }, 12_000, 'pending proposal confirmation');
}

async function completed(client: Client, id: string): Promise<TaskDetail> {
  return waitFor(async () => {
    const r = await client.get<TaskDetail>('/api/tasks/' + id);
    return ['completed', 'failed', 'cancelled'].includes(r.body.task.status) ? r.body : undefined;
  }, 12_000, 'proposal task finished');
}

beforeAll(async () => {
  server = await startAuthServer({ config: authTestConfig({ SOLAR_ACCESS_TOKEN: TEST_ACCESS_TOKEN }), responses: model });
  const admin = tokenClient(server.url);
  staff = (await userClient(server.url, admin, 'proposer', 'staff', 'Staff Proposer')).client;
  stranger = (await userClient(server.url, admin, 'unrelated', 'staff', 'Other Staff')).client;
  owner = (await userClient(server.url, admin, 'reviewowner', 'superadmin', 'Owner')).client;
  head = (await userClient(server.url, admin, 'reviewhead', 'head_of_it', 'Head of IT')).client;
});

afterAll(async () => { await server?.close(); });

describe('Conversation proposal lifecycle through authenticated API', () => {
  it('requires owner confirmation for each write, never bypasses dual approval', async () => {
    const start = await task(staff, 'Please prepare [draft]', 'proposals-conversation');
    const draftConfirm = await pending(staff);
    expect(draftConfirm.tool).toBe('create_content_proposal_draft');
    expect((await staff.get<ContentProposal[]>('/api/content-proposals')).body).toEqual([]);
    expect((await stranger.get<ContentProposal[]>('/api/content-proposals')).body).toEqual([]);
    expect((await staff.post('/api/confirmations/' + draftConfirm.id, { approved: true })).status).toBe(200);
    expect((await completed(staff, start.id)).task.status).toBe('completed');

    const proposals = (await staff.get<ContentProposal[]>('/api/content-proposals')).body;
    const proposal = proposals.find((p) => p.title === 'Incident response');
    expect(proposal).toMatchObject({ status: 'draft', kind: 'knowledge' });
    const id = proposal!.id;
    expect((await head.get<ContentProposal[]>('/api/content-proposals')).body.some((p) => p.id === id)).toBe(false);
    expect((await stranger.get<ContentProposal[]>('/api/content-proposals')).body.some((p) => p.id === id)).toBe(false);

    const firstSubmit = await task(staff, 'Please [submit:' + id + ']', 'proposals-conversation');
    const refused = await pending(staff);
    expect(refused.tool).toBe('submit_content_proposal');
    expect((await stranger.post('/api/confirmations/' + refused.id, { approved: true })).status).toBe(404);
    expect((await staff.post('/api/confirmations/' + refused.id, { approved: false })).status).toBe(200);
    expect((await completed(staff, firstSubmit.id)).task.status).toBe('completed');
    expect((await staff.get<ContentProposal[]>('/api/content-proposals')).body.find((p) => p.id === id)?.status).toBe('draft');

    const nextSubmit = await task(staff, 'Please [submit:' + id + ']', 'proposals-conversation');
    const confirm = await pending(staff);
    expect(confirm.tool).toBe('submit_content_proposal');
    expect((await staff.post('/api/confirmations/' + confirm.id, { approved: true })).status).toBe(200);
    expect((await completed(staff, nextSubmit.id)).task.status).toBe('completed');

    expect((await staff.get<ContentProposal[]>('/api/content-proposals')).body.find((p) => p.id === id)?.status).toBe('submitted');
    expect((await staff.post('/api/content-proposals/' + id + '/publish')).status).toBe(403);
    expect((await owner.post('/api/content-proposals/' + id + '/publish')).status).toBe(409);
    expect((await head.post('/api/content-proposals/' + id + '/review', { approved: true })).body).toMatchObject({ status: 'submitted' });
    expect((await owner.post('/api/content-proposals/' + id + '/review', { approved: true })).body).toMatchObject({ status: 'approved' });
    expect((await head.post('/api/content-proposals/' + id + '/publish')).body).toMatchObject({ status: 'published' });
  });
});
