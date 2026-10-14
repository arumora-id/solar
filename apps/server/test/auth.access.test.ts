import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Attachment, Confirmation, StreamMessage, Task, TaskDetail, TaskStats, User } from '@solar/shared';
import { EMPTY_USAGE } from '@solar/shared';
import type { RunningServer } from '../src/server.js';
import { sampleSequence } from './fixtures.js';
import {
  approvalTool,
  authTestConfig,
  Client,
  fnCall,
  message,
  openStream,
  startAuthServer,
  StatelessModel,
  STRONG_PASSWORD,
  TEST_ACCESS_TOKEN,
  tokenClient,
  userClient,
  waitFor,
} from './helpers/authServer.js';

/**
 * Model behaviour by markers in the request: [approve] calls a tool that needs approval, [diagram] creates a sequence
 * diagram, [read:<artifact id>] reads an artifact; otherwise (and after any tool result) it answers "done".
 */
const model = new StatelessModel((input, text) => {
  if (input.some((i) => i.type === 'function_call_output')) return [message('done')];
  const request = /<request>\\n([\s\S]*?)\\n<\/request>/.exec(text)?.[1] ?? '';
  if (request.includes('[approve]')) return [fnCall('tu_approve', 'test_external_write', { value: 'x' })];
  if (request.includes('[diagram]')) return [fnCall('tu_diagram', 'create_sequence_diagram', sampleSequence)];
  const read = /\[read:(art_[A-Za-z0-9]+)\]/.exec(request);
  if (read) return [fnCall('tu_read', 'read_artifact', { artifact_id: read[1] })];
  return [message('done')];
});

const LEGACY_TASK: Task = {
  id: 'task_legacy0000000000000001',
  sessionId: 'old-session',
  title: 'A request from before user accounts',
  prompt: 'A request from before user accounts',
  status: 'completed',
  progress: 100,
  currentStep: 'Selesai',
  model: 'gpt-6.1-sol',
  createdAt: '2026-01-01T00:00:00.000Z',
  startedAt: '2026-01-01T00:00:01.000Z',
  finishedAt: '2026-01-01T00:00:02.000Z',
  result: 'done',
  error: null,
  usage: { ...EMPTY_USAGE },
  attachmentIds: [],
  language: 'id',
};

let server: RunningServer;
let admin: Client; // SOLAR_ACCESS_TOKEN
let superadmin: Client;
let head: Client;
let alice: Client;
let bob: Client;
let users: Record<'superadmin' | 'head' | 'head2' | 'alice' | 'bob', User>;

async function runTask(client: Client, prompt: string, sessionId: string): Promise<Task> {
  const created = await client.post<Task>('/api/tasks', { prompt, sessionId });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body;
}

async function finished(client: Client, id: string): Promise<TaskDetail> {
  return waitFor(async () => {
    const d = (await client.get<TaskDetail>(`/api/tasks/${id}`)).body;
    return ['completed', 'failed', 'cancelled'].includes(d.task.status) ? d : undefined;
  }, 15_000, `task ${id}`);
}

beforeAll(async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'solar-auth-access-'));
  // a task stored before user accounts existed (no ownerId)
  mkdirSync(join(dataDir, 'tasks'), { recursive: true });
  writeFileSync(join(dataDir, 'tasks', `${LEGACY_TASK.id}.json`), JSON.stringify(LEGACY_TASK));
  server = await startAuthServer({
    config: authTestConfig({ SOLAR_ACCESS_TOKEN: TEST_ACCESS_TOKEN, SOLAR_ADMIN_USERNAME: 'root', SOLAR_ADMIN_EMAIL: 'root@solar.test', SOLAR_ADMIN_PASSWORD: STRONG_PASSWORD }, dataDir),
    responses: model,
    extraTools: [approvalTool],
  });
  admin = tokenClient(server.url);
  const sa = await userClient(server.url, admin, 'sadmin', 'superadmin', 'Super Admin');
  const hd = await userClient(server.url, admin, 'head', 'head_of_it', 'Head of IT');
  const hd2 = await userClient(server.url, admin, 'head2', 'head_of_it', 'Head Two');
  const al = await userClient(server.url, admin, 'alice', 'staff', 'Alice');
  const bo = await userClient(server.url, admin, 'bob', 'staff', 'Bob');
  superadmin = sa.client;
  head = hd.client;
  alice = al.client;
  bob = bo.client;
  users = { superadmin: sa.user, head: hd.user, head2: hd2.user, alice: al.user, bob: bo.user };
});

afterAll(async () => {
  await server.close();
});

describe('role matrix', () => {
  it('staff: no system settings, no user administration', async () => {
    const forbidden: Array<[string, string, unknown?]> = [
      ['GET', '/api/llm'],
      ['POST', '/api/llm/providers', { id: 'x', name: 'X', kind: 'openai-chat', baseUrl: 'http://localhost:1/v1', models: [] }],
      ['PUT', '/api/llm/routes', { routes: {} }],
      ['POST', '/api/llm/providers/openai/test', {}],
      ['DELETE', '/api/llm/providers/x'],
      ['GET', '/api/plugins'],
      ['POST', '/api/plugins', { id: 'p', name: 'P', transport: 'stdio', command: 'echo' }],
      ['PUT', '/api/plugins/p', { enabled: false }],
      ['POST', '/api/plugins/p/reconnect', {}],
      ['DELETE', '/api/plugins/p'],
      ['GET', '/api/users'],
      ['GET', '/api/users/pending-count'],
      ['POST', '/api/users', { username: 'x.y', email: 'x@y.test', name: 'X', password: STRONG_PASSWORD }],
      ['PATCH', `/api/users/${users.bob.id}`, { status: 'disabled' }],
      ['POST', `/api/users/${users.bob.id}/approve`, {}],
      ['POST', `/api/users/${users.bob.id}/password`, { password: 'some new password' }],
      ['DELETE', `/api/users/${users.bob.id}`],
    ];
    for (const [method, path, body] of forbidden) {
      const res = await alice.call(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.code, `${method} ${path}`).toBe('forbidden');
    }
    // the public configuration basics stay readable, without secrets
    const config = await alice.get('/api/config');
    expect(config.status).toBe(200);
    expect(JSON.stringify(config.body)).not.toContain(TEST_ACCESS_TOKEN);
  });

  it('staff: may propose but cannot read or modify administrator Skills/Knowledge', async () => {
    for (const [method, url, payload] of [
      ['GET', '/api/knowledge'],
      ['GET', '/api/knowledge/file?path=systems/secret.md'],
      ['GET', '/api/knowledge/search?q=secret'],
      ['PUT', '/api/knowledge/file', { path: 'systems/STAFF.md', content: '# Staff' }],
      ['POST', '/api/knowledge/import', { files: [{ path: 'systems/IMPORTED.md', content: '# Imported' }] }],
      ['DELETE', '/api/knowledge/file?path=systems/STAFF.md'],
      ['GET', '/api/skills'],
      ['POST', '/api/skills', { name: 'Unapproved', content: 'Do things.' }],
      ['PUT', '/api/skills/image-creation', { enabled: true }],
      ['DELETE', '/api/skills/image-creation'],
    ] as Array<[string, string, unknown?]>) {
      expect((await alice.call(method, url, payload)).status, `${method} ${url}`).toBe(403);
    }
    const draft = await alice.post<{ id: string; status: string }>('/api/content-proposals', {
      kind: 'skill', title: 'Candidate Skill', description: 'by staff', content: '# Draft',
    });
    expect(draft.status).toBe(201);
    expect(draft.body.status).toBe('draft');
    expect((await bob.get<Array<{ id: string }>>('/api/content-proposals')).body).not.toContainEqual(expect.objectContaining({ id: draft.body.id }));
    expect((await alice.post(`/api/content-proposals/${draft.body.id}/submit`)).body).toMatchObject({ status: 'submitted' });
    expect((await alice.post(`/api/content-proposals/${draft.body.id}/publish`)).status).toBe(403);
  });

  it('head of IT: tasks of everyone and staff accounts, but no system settings and no admin accounts', async () => {
    for (const [method, path, body] of [
      ['GET', '/api/llm'],
      ['PUT', '/api/llm/routes', { routes: {} }],
      ['GET', '/api/plugins'],
      ['POST', '/api/plugins', { id: 'p', name: 'P', transport: 'stdio', command: 'echo' }],
    ] as Array<[string, string, unknown?]>) {
      expect((await head.call(method, path, body)).status, `${method} ${path}`).toBe(403);
    }
    expect((await head.get<User[]>('/api/users')).status).toBe(200);
    expect((await head.get('/api/users/pending-count')).status).toBe(200);
    // never superadmin or (other) head of IT accounts
    for (const target of [users.superadmin, users.head2]) {
      expect((await head.patch(`/api/users/${target.id}`, { status: 'disabled' })).status).toBe(403);
      expect((await head.patch(`/api/users/${target.id}`, { role: 'staff' })).status).toBe(403);
    }
    // nor promote staff, rename, reset passwords, create or delete accounts
    expect((await head.patch(`/api/users/${users.bob.id}`, { role: 'head_of_it' })).status).toBe(403);
    expect((await head.patch(`/api/users/${users.bob.id}`, { name: 'Robert' })).status).toBe(403);
    expect((await head.post(`/api/users/${users.bob.id}/password`, { password: 'some new password' })).status).toBe(403);
    expect((await head.post('/api/users', { username: 'new.one', email: 'new.one@solar.test', name: 'N', password: STRONG_PASSWORD })).status).toBe(403);
    expect((await head.delete(`/api/users/${users.bob.id}`)).status).toBe(403);
    // but disable / enable staff
    expect((await head.patch(`/api/users/${users.bob.id}`, { status: 'disabled' })).body).toMatchObject({ status: 'disabled' });
    expect((await head.patch(`/api/users/${users.bob.id}`, { status: 'active' })).body).toMatchObject({ status: 'active' });
    expect((await bob.login('bob')).status).toBe(200);

    // and approve registrations, only as staff
    const reg = await new Client(server.url).post('/api/auth/register', { username: 'cindy', email: 'cindy@solar.test', name: 'Cindy', password: STRONG_PASSWORD });
    expect(reg.status).toBe(201);
    const cindy = (await head.get<User[]>('/api/users?status=pending')).body.find((u) => u.username === 'cindy')!;
    expect((await head.post(`/api/users/${cindy.id}/approve`, { role: 'head_of_it' })).status).toBe(403);
    expect((await head.post(`/api/users/${cindy.id}/approve`, { role: 'superadmin' })).status).toBe(403);
    expect((await head.post<User>(`/api/users/${cindy.id}/approve`, {})).body).toMatchObject({ status: 'active', role: 'staff', approvedBy: users.head.id });
    // a superadmin may approve as any role, also through PATCH
    await new Client(server.url).post('/api/auth/register', { username: 'dodi', email: 'dodi@solar.test', name: 'Dodi', password: STRONG_PASSWORD });
    const dodi = (await superadmin.get<User[]>('/api/users?status=pending')).body.find((u) => u.username === 'dodi')!;
    expect((await superadmin.patch<User>(`/api/users/${dodi.id}`, { status: 'active', role: 'head_of_it' })).body).toMatchObject({ status: 'active', role: 'head_of_it' });
  });

  it('superadmin: system settings', async () => {
    expect((await superadmin.get('/api/llm')).status).toBe(200);
    expect((await superadmin.get('/api/plugins')).status).toBe(200);
  });
});

describe('staged content workflow and role isolation', () => {
  it('keeps drafts private, requires two reviewer roles, and publishes only on request', async () => {
    const skillPayload = { kind: 'skill', title: 'Release Checklist Review', description: 'From staff', content: '# Checklist' };
    const draft = await alice.post<{ id: string; status: string }>('/api/content-proposals', skillPayload);
    expect(draft.status).toBe(201);
    expect(draft.body.status).toBe('draft');
    const id = draft.body.id;
    expect((await head.get<Array<{ id: string }>>('/api/content-proposals')).body.find((x) => x.id === id)).toBeUndefined();
    expect((await bob.get<Array<{ id: string }>>('/api/content-proposals')).body.find((x) => x.id === id)).toBeUndefined();
    expect((await bob.put(`/api/content-proposals/${id}`, skillPayload)).status).toBe(409);
    expect((await alice.put(`/api/content-proposals/${id}`, { ...skillPayload, content: '# Updated checklist' })).body).toMatchObject({ status: 'draft', content: '# Updated checklist' });
    expect((await head.post(`/api/content-proposals/${id}/review`, { approved: true })).status).toBe(409);
    expect((await alice.post(`/api/content-proposals/${id}/submit`)).body).toMatchObject({ status: 'submitted' });
    expect((await alice.put(`/api/content-proposals/${id}`, skillPayload)).status).toBe(409);
    expect((await alice.post(`/api/content-proposals/${id}/review`, { approved: true })).status).toBe(403);
    expect((await alice.post(`/api/content-proposals/${id}/publish`)).status).toBe(403);
    expect((await superadmin.post(`/api/content-proposals/${id}/publish`)).status).toBe(409);
    expect((await head.post(`/api/content-proposals/${id}/review`, { approved: true })).body).toMatchObject({ status: 'submitted' });
    expect((await head.post(`/api/content-proposals/${id}/review`, { approved: true })).status).toBe(409);
    expect((await superadmin.post(`/api/content-proposals/${id}/review`, { approved: true })).body).toMatchObject({ status: 'approved' });
    expect((await head.get<Array<{ id: string }>>('/api/skills')).body.find((x) => x.id === 'release-checklist-review')).toBeUndefined();
    const published = await head.post<{ status: string; publishedId: string }>(`/api/content-proposals/${id}/publish`, {});
    expect(published.status).toBe(200);
    expect(published.body).toMatchObject({ status: 'published', publishedId: 'release-checklist-review' });
    expect((await head.get<Array<{ id: string; enabled: boolean }>>('/api/skills')).body.find((x) => x.id === 'release-checklist-review')?.enabled).toBe(false);
    expect((await head.post(`/api/content-proposals/${id}/publish`, {})).status).toBe(409);
    expect((await alice.get('/api/skills/release-checklist-review')).status).toBe(403);
    expect((await bob.get<Array<{ id: string }>>('/api/content-proposals')).body.some((x) => x.id === id)).toBe(false);
  });

  it('publishes knowledge only after review, rejects with reason, never exposes it to staff', async () => {
    const knowledgePayload = { kind: 'knowledge', title: 'Draft Guidance', path: 'reference/dual-approved-guidance.md', content: '# Approved guidance' };
    const result = await alice.post<{ id: string }>('/api/content-proposals', knowledgePayload);
    const id = result.body.id;
    await alice.post(`/api/content-proposals/${id}/submit`, {});
    await superadmin.post(`/api/content-proposals/${id}/review`, { approved: true });
    expect((await head.get('/api/knowledge/file?path=reference/dual-approved-guidance.md')).status).toBe(404);
    await head.post(`/api/content-proposals/${id}/review`, { approved: true });
    expect((await head.get('/api/knowledge/file?path=reference/dual-approved-guidance.md')).status).toBe(404);
    expect((await superadmin.post(`/api/content-proposals/${id}/publish`, {})).body).toMatchObject({ status: 'published', publishedId: knowledgePayload.path });
    expect((await head.get('/api/knowledge/file?path=reference/dual-approved-guidance.md')).status).toBe(200);
    expect((await bob.get('/api/knowledge/file?path=reference/dual-approved-guidance.md')).status).toBe(403);
    const rejected = await bob.post<{ id: string }>('/api/content-proposals', { kind: 'skill', title: 'Bad draft', content: '# Incomplete' });
    await bob.post(`/api/content-proposals/${rejected.body.id}/submit`, {});
    expect((await head.post(`/api/content-proposals/${rejected.body.id}/review`, { approved: false, reason: '' })).status).toBe(409);
    expect((await head.post(`/api/content-proposals/${rejected.body.id}/review`, { approved: false, reason: 'Incomplete sources' })).body).toMatchObject({ status: 'rejected', rejectionReason: 'Incomplete sources' });
    expect((await superadmin.post(`/api/content-proposals/${rejected.body.id}/publish`, {})).status).toBe(409);
  });

  it('keeps built-in image creation disabled by default and Superadmin-only configurable', async () => {
    const skills = (await head.get<Array<{ id: string; enabled: boolean }>>('/api/skills')).body;
    expect(skills.find((x) => x.id === 'image-creation')).toMatchObject({ enabled: false });
    expect((await head.put('/api/skills/image-creation', { enabled: true })).status).toBe(403);
    expect((await alice.put('/api/skills/image-creation', { enabled: true })).status).toBe(403);
    expect((await superadmin.put('/api/skills/image-creation', { enabled: true })).body).toMatchObject({ enabled: true });
    expect((await superadmin.put('/api/skills/image-creation', { enabled: false })).body).toMatchObject({ enabled: false });
  });
});

describe('task visibility', () => {
  let aliceTask: Task;
  let aliceDiagramTask: TaskDetail;
  let aliceAttachment: Attachment;

  beforeAll(async () => {
    aliceDiagramTask = await finished(alice, (await runTask(alice, 'Alice private request [diagram]', 'alice-session')).id);
    expect(aliceDiagramTask.task.status).toBe('completed');
    expect(aliceDiagramTask.artifacts.length).toBeGreaterThan(0);
    const upload = await alice.raw('POST', '/api/attachments?sessionId=alice-session&name=notes.md', '# Alice notes', { 'Content-Type': 'application/octet-stream' });
    expect(upload.status).toBe(201);
    aliceAttachment = (await upload.json()) as Attachment;
    // a task waiting for approval (still active)
    aliceTask = await runTask(alice, 'Alice waits [approve]', 'alice-session');
    await waitFor(async () => (await alice.get<Confirmation[]>('/api/confirmations')).body.length > 0, 10_000, 'confirmation');
  });

  it("staff cannot list or open another user's task (404, not 403)", async () => {
    const bobList = (await bob.get<Task[]>('/api/tasks')).body;
    expect(bobList.some((t) => t.ownerId === users.alice.id)).toBe(false);
    expect(bobList.some((t) => t.id === LEGACY_TASK.id)).toBe(false);
    // asking for her tasks by owner or session does not help
    expect((await bob.get<Task[]>(`/api/tasks?owner=${users.alice.id}`)).body.some((t) => t.ownerId === users.alice.id)).toBe(false);
    expect((await bob.get<Task[]>('/api/tasks?sessionId=alice-session')).body).toEqual([]);
    for (const path of [`/api/tasks/${aliceTask.id}`, `/api/tasks/${aliceDiagramTask.task.id}/artifacts.zip`, `/api/tasks/${LEGACY_TASK.id}`]) {
      const res = await bob.get(path);
      expect(res.status, path).toBe(404);
    }
    const unknown = await bob.get('/api/tasks/task_doesnotexist');
    expect((await bob.get(`/api/tasks/${aliceTask.id}`)).body).toEqual(unknown.body);
    // cancelling answers like an unknown id
    const cancel = await bob.post(`/api/tasks/${aliceTask.id}/cancel`);
    expect(cancel.status).toBe(409);
    expect(cancel.body).toEqual((await bob.post('/api/tasks/task_doesnotexist/cancel')).body);
    // stats are her own
    expect((await bob.get<TaskStats>('/api/tasks/stats')).body.total).toBe(0);
    expect((await alice.get<TaskStats>('/api/tasks/stats')).body.total).toBe(2);
  });

  it("staff cannot see or answer another user's approvals; the head of IT can", async () => {
    expect((await bob.get<Confirmation[]>('/api/confirmations')).body).toEqual([]);
    const pending = (await alice.get<Confirmation[]>('/api/confirmations')).body;
    expect(pending).toHaveLength(1);
    expect((await bob.post(`/api/confirmations/${pending[0]!.id}`, { approved: true })).status).toBe(404);
    expect((await head.get<Confirmation[]>('/api/confirmations')).body.map((c) => c.id)).toContain(pending[0]!.id);
    expect((await head.post(`/api/confirmations/${pending[0]!.id}`, { approved: true })).status).toBe(200);
    const done = await finished(alice, aliceTask.id);
    expect(done.task.status).toBe('completed');
    expect(done.confirmations[0]).toMatchObject({ status: 'approved' });
  });

  it("staff cannot read another user's artifacts or attachments", async () => {
    const art = aliceDiagramTask.artifacts[0]!;
    for (const [method, path, body] of [
      ['GET', `/api/artifacts/${art.id}`],
      ['GET', `/api/artifacts/${art.id}/content`],
      ['POST', `/api/artifacts/${art.id}/docx`, {}],
      ['POST', '/api/knowledge/import-artifact', { artifactId: aliceDiagramTask.artifacts.find((a) => a.name.endsWith('.mmd'))?.id ?? art.id, type: 'reference' }],
      ['GET', `/api/attachments/${aliceAttachment.id}`],
      ['GET', `/api/attachments/${aliceAttachment.id}/text`],
      ['GET', `/api/attachments/${aliceAttachment.id}/content`],
      ['DELETE', `/api/attachments/${aliceAttachment.id}`],
    ] as Array<[string, string, unknown?]>) {
      expect((await bob.call(method, path, body)).status, `${method} ${path}`).toBe(path === '/api/knowledge/import-artifact' ? 403 : 404);
    }
    expect((await bob.get<Attachment[]>('/api/attachments?sessionId=alice-session')).body).toEqual([]);
    // nor attach her upload to his own request (even naming her conversation)
    const steal = await bob.post('/api/tasks', { prompt: 'use her file', sessionId: 'alice-session', attachmentIds: [aliceAttachment.id] });
    expect(steal.status).toBe(400);
    expect(String(steal.body.error)).toContain(aliceAttachment.id);
    // the owner and the every-task roles can
    expect((await alice.get(`/api/artifacts/${art.id}/content`)).status).toBe(200);
    expect((await head.get(`/api/artifacts/${art.id}/content`)).status).toBe(200);
    expect((await superadmin.get(`/api/attachments/${aliceAttachment.id}/text`)).status).toBe(200);
    expect((await alice.get<Attachment[]>('/api/attachments?sessionId=alice-session')).body.map((a) => a.id)).toEqual([aliceAttachment.id]);
  });

  it('the head of IT and superadmins see every task with its owner; tasks from before accounts only they see', async () => {
    const list = (await head.get<Task[]>('/api/tasks?limit=200')).body;
    const mine = list.find((t) => t.id === aliceDiagramTask.task.id)!;
    expect(mine.owner).toEqual({ id: users.alice.id, name: 'Alice', username: 'alice', role: 'staff', kind: 'user', deleted: false });
    const legacy = list.find((t) => t.id === LEGACY_TASK.id)!;
    expect(legacy.owner).toBeNull();
    expect((await head.get<Task[]>('/api/tasks?owner=none')).body.map((t) => t.id)).toEqual([LEGACY_TASK.id]);
    expect((await head.get<Task[]>(`/api/tasks?owner=${users.alice.id}`)).body.every((t) => t.ownerId === users.alice.id)).toBe(true);
    expect((await superadmin.get<TaskDetail>(`/api/tasks/${LEGACY_TASK.id}`)).status).toBe(200);
    expect((await head.get<TaskDetail>(`/api/tasks/${aliceTask.id}`)).body.task.owner?.name).toBe('Alice');
    // her own list has no owner block (she sees only her own tasks)
    expect((await alice.get<Task[]>('/api/tasks')).body.every((t) => t.owner === undefined && t.ownerId === users.alice.id)).toBe(true);
    // tasks made with the access token
    const tokenTask = await runTask(admin, 'token task', 'script-session');
    expect(tokenTask.ownerId).toBe('system:access-token');
    const listed = (await superadmin.get<Task[]>('/api/tasks')).body.find((t) => t.id === tokenTask.id)!;
    expect(listed.owner).toMatchObject({ kind: 'token', role: 'superadmin' });
  });

  it('a conversation is per user: reusing her session id does not give her history to his agent', async () => {
    const before = model.inputs.length;
    const own = await finished(bob, (await runTask(bob, 'Bob asks in her session id', 'alice-session')).id);
    expect(own.task.status).toBe('completed');
    const inputs = model.inputs.slice(before).join('\n');
    expect(inputs).toContain('Bob asks in her session id');
    expect(inputs).not.toContain('Alice private request');
    expect(inputs).not.toContain('session_history');
    expect(inputs).toContain('Requested by: Bob (Solar Staff)');
  });

  it("the agent of one user cannot read another user's artifact by id", async () => {
    const art = aliceDiagramTask.artifacts.find((a) => a.kind === 'sequence-mermaid') ?? aliceDiagramTask.artifacts[0]!;
    const bobs = await finished(bob, (await runTask(bob, `Look at [read:${art.id}]`, 'bob-session')).id);
    const bobResult = bobs.events.find((e) => e.type === 'tool_result' && e.tool === 'read_artifact');
    expect(bobResult).toMatchObject({ ok: false });
    const alices = await finished(alice, (await runTask(alice, `Look at [read:${art.id}]`, 'alice-session-2')).id);
    expect(alices.events.find((e) => e.type === 'tool_result' && e.tool === 'read_artifact')).toMatchObject({ ok: true });
    const heads = await finished(head, (await runTask(head, `Look at [read:${art.id}]`, 'head-session')).id);
    expect(heads.events.find((e) => e.type === 'tool_result' && e.tool === 'read_artifact')).toMatchObject({ ok: true });
  });

  it("a deleted user's tasks stay, shown as a deleted user", async () => {
    const { client: temp, user } = await userClient(server.url, admin, 'temp.user', 'staff', 'Temporary');
    const task = await finished(temp, (await runTask(temp, 'temporary request', 'temp-session')).id);
    expect((await superadmin.delete(`/api/users/${user.id}`)).status).toBe(204);
    expect((await temp.get('/api/tasks')).status).toBe(401);
    const shown = (await head.get<TaskDetail>(`/api/tasks/${task.task.id}`, { 'X-Solar-Language': 'en' })).body.task.owner;
    expect(shown).toEqual({ id: user.id, name: 'Deleted user', username: null, role: null, kind: 'user', deleted: true });
  });
});

describe('event stream per user', () => {
  it('sends each user only their own tasks, every task to the head of IT (with owner), account changes to approvers', async () => {
    const auth = (c: Client) => ({ Cookie: `solar_session=${c.session}` });
    const aliceStream = openStream(server.url, auth(alice));
    const bobStream = openStream(server.url, auth(bob));
    const headStream = openStream(server.url, auth(head));
    try {
      await waitFor(() => [aliceStream, bobStream, headStream].every((s) => s.messages.some((m) => m.kind === 'hello')), 5000, 'streams');
      const task = await runTask(alice, 'streamed request', 'alice-stream');
      await finished(alice, task.id);
      const isTask = (m: StreamMessage) =>
        (m.kind === 'task' && m.task.id === task.id) || (m.kind === 'event' && m.event.taskId === task.id) || (m.kind === 'delta' && m.taskId === task.id);
      await waitFor(() => aliceStream.messages.some((m) => m.kind === 'task' && m.task.id === task.id && m.task.status === 'completed'), 5000, 'alice completed');
      await waitFor(() => headStream.messages.some((m) => m.kind === 'task' && m.task.id === task.id && m.task.status === 'completed'), 5000, 'head completed');
      expect(aliceStream.messages.filter(isTask).length).toBeGreaterThan(3);
      expect(bobStream.messages.filter(isTask)).toEqual([]);
      const headTask = headStream.messages.find((m): m is Extract<StreamMessage, { kind: 'task' }> => m.kind === 'task' && m.task.id === task.id)!;
      expect(headTask.task.owner).toMatchObject({ name: 'Alice', kind: 'user' });
      // global messages reach everyone
      expect(bobStream.messages.some((m) => m.kind === 'plugins')).toBe(true);

      // a registration: approvers are told, staff are not
      await new Client(server.url).post('/api/auth/register', { username: 'eko', email: 'eko@solar.test', name: 'Eko', password: STRONG_PASSWORD });
      await waitFor(() => headStream.messages.some((m) => m.kind === 'users_changed'), 5000, 'users_changed');
      const change = headStream.messages.find((m) => m.kind === 'users_changed') as Extract<StreamMessage, { kind: 'users_changed' }>;
      expect(change.pendingCount).toBeGreaterThanOrEqual(1);
      expect(aliceStream.messages.some((m) => m.kind === 'users_changed')).toBe(false);

      // disabling Bob ends his stream at once
      expect((await head.patch(`/api/users/${users.bob.id}`, { status: 'disabled' })).status).toBe(200);
      await waitFor(() => bobStream.messages.some((m) => m.kind === 'signed_out'), 5000, 'signed_out');
      await bobStream.ended;
      expect((await head.patch(`/api/users/${users.bob.id}`, { status: 'active' })).status).toBe(200);
    } finally {
      for (const s of [aliceStream, bobStream, headStream]) s.close();
    }
  });
});
