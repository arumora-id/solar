import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACTIVITY_ACTIONS,
  type ActivityActionInfo,
  type ActivityItem,
  type ActivityPage,
  type AuthMe,
  type Confirmation,
  type RoleInfo,
  type Task,
  type TaskDetail,
  type User,
} from '@solar/shared';
import { nextActivityStamp } from '../src/activity/activityLog.js';
import type { RunningServer } from '../src/server.js';
import { FileActivityStore } from '../src/storage/fileActivityStore.js';
import {
  approvalTool,
  authTestConfig,
  Client,
  fnCall,
  message,
  startAuthServer,
  StatelessModel,
  STRONG_PASSWORD,
  TEST_ACCESS_TOKEN,
  tokenClient,
  userClient,
  waitFor,
} from './helpers/authServer.js';

/**
 * Model behaviour by markers in the request: [approve] calls a tool that needs approval, [kb] saves a knowledge file
 * (which asks for approval too); after any tool result it answers "done".
 */
const model = new StatelessModel((input, text) => {
  if (input.some((i) => i.type === 'function_call_output')) return [message('done')];
  const request = /<request>\\n([\s\S]*?)\\n<\/request>/.exec(text)?.[1] ?? '';
  if (request.includes('[approve]')) return [fnCall('tu_approve', 'test_external_write', { value: 'x' })];
  if (request.includes('[kb]')) {
    return [fnCall('tu_kb', 'save_knowledge', { type: 'system', id: 'AUDITGATE', title: 'Audit Gateway', content: '# Audit Gateway\n\nAn API gateway.\n' })];
  }
  return [message('done')];
});

const TYPED_SECRET = 'Typed-Secret-Password-1';
const OTHER_SECRET = 'Another-Wrong-Pass-2';
const PROVIDER_KEY = 'sk-live-SECRET-provider-key-123';
const PLUGIN_TOKEN = 'ghp_SECRET_plugin_token_456';

let server: RunningServer;
let dataDir: string;
let root: Client;
let head: Client;
let alice: Client;
let users: Record<'root' | 'head' | 'alice', User>;

const all = async (client: Client, query = ''): Promise<ActivityItem[]> => {
  const items: ActivityItem[] = [];
  let cursor: string | null = null;
  do {
    const sep: string = query ? '&' : '';
    const page: { status: number; body: ActivityPage } = await client.get<ActivityPage>(
      `/api/activity?limit=200${sep}${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    expect(page.status, JSON.stringify(page.body)).toBe(200);
    items.push(...page.body.items);
    cursor = page.body.nextCursor;
  } while (cursor);
  return items;
};

const find = (items: ActivityItem[], action: string, where: (e: ActivityItem) => boolean = () => true) => items.find((e) => e.action === action && where(e));

async function finished(client: Client, id: string): Promise<TaskDetail> {
  return waitFor(async () => {
    const d = (await client.get<TaskDetail>(`/api/tasks/${id}`)).body;
    return ['completed', 'failed', 'cancelled'].includes(d.task.status) ? d : undefined;
  }, 15_000, `task ${id}`);
}

async function pendingFor(client: Client, taskId: string): Promise<Confirmation> {
  return waitFor(async () => (await client.get<Confirmation[]>('/api/confirmations')).body.find((c) => c.taskId === taskId), 15_000, `approval of ${taskId}`);
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'solar-activity-api-'));
  server = await startAuthServer({
    config: authTestConfig({ SOLAR_ACCESS_TOKEN: TEST_ACCESS_TOKEN, SOLAR_ADMIN_USERNAME: 'root', SOLAR_ADMIN_EMAIL: 'root@solar.test', SOLAR_ADMIN_PASSWORD: STRONG_PASSWORD, SOLAR_ADMIN_NAME: 'Root Admin' }, dataDir),
    responses: model,
    // This is a synthetic approval tool, not an administrator-configured MCP integration.
    // Production MCP tools stay unavailable to Staff by design.
    extraTools: [{ ...approvalTool, source: 'builtin', pluginId: undefined }],
  });
  root = new Client(server.url);
  const login = await root.login('root');
  expect(login.status).toBe(200);
  const hd = await userClient(server.url, root, 'head', 'head_of_it', 'Hadi Head');
  const al = await userClient(server.url, root, 'alice', 'staff', 'Alice Staff');
  head = hd.client;
  alice = al.client;
  users = { root: login.body.user!, head: hd.user, alice: al.user };
});

afterAll(async () => {
  await server?.close();
});

describe('GET /api/roles', () => {
  it('lists the roles of the code for every logged-in user, in the language asked', async () => {
    const res = await alice.get<RoleInfo[]>('/api/roles', { 'X-Solar-Language': 'en' });
    expect(res.status).toBe(200);
    expect(res.body.map((r) => r.id)).toEqual(['superadmin', 'head_of_it', 'staff']);
    expect(res.body[2]).toMatchObject({ id: 'staff', name: 'Solar Staff', names: { id: 'Staf Solar', en: 'Solar Staff' }, sortOrder: 3 });
    expect(res.body[2]!.permissions).toContain('activity.view_own');
    expect(res.body[2]!.permissions).not.toContain('activity.view_all');
    expect(res.body[1]!.permissions).toContain('activity.view_all');
    expect((await alice.get<RoleInfo[]>('/api/roles')).body[2]!.name).toBe('Staf Solar');
    expect((await new Client(server.url).get('/api/roles')).status).toBe(401);
  });
});

describe('logins', () => {
  it('records logins and failed logins, never the typed password or an unknown identifier', async () => {
    const anon = new Client(server.url);
    expect((await anon.login('ghost.user@nowhere.test', TYPED_SECRET)).status).toBe(401);
    // a known account typed as its email in other letters: stored as the account's username
    expect((await anon.login('ROOT@SOLAR.TEST', OTHER_SECRET)).status).toBe(401);
    // a password typed into the username field
    expect((await anon.login(TYPED_SECRET, 'whatever-else-123')).status).toBe(401);

    const failed = await all(root, 'action=auth.login_failed');
    const unknown = failed.filter((e) => e.targetId === null);
    expect(unknown.length).toBeGreaterThanOrEqual(2);
    for (const e of unknown) {
      expect(e).toMatchObject({ actorKind: 'anonymous', actorId: null, outcome: 'failure', details: { reason: 'wrong_password' }, ip: expect.any(String) });
    }
    const known = failed.find((e) => e.targetId === users.root.id)!;
    expect(known).toMatchObject({ actorKind: 'anonymous', targetLabel: 'root', details: { reason: 'wrong_password', identifier: 'root' } });
    expect(known.summary).toBe('Login gagal untuk root: password salah');

    const logins = await all(root, 'action=auth.login');
    expect(find(logins, 'auth.login', (e) => e.actorId === users.alice.id)).toMatchObject({ actorName: 'Alice Staff', actorRole: 'staff', actorKind: 'user', outcome: 'success' });
  });
});

describe('accounts', () => {
  it('registration, approval, role change, refusals, disable/enable, rename, reset and delete - with actor snapshots', async () => {
    const carol = new Client(server.url);
    expect((await carol.post('/api/auth/register', { username: 'carol', email: 'carol@solar.test', name: 'Carol', password: STRONG_PASSWORD })).status).toBe(201);
    expect((await carol.login('carol')).body).toMatchObject({ code: 'account_pending' });
    const carolUser = (await root.get<User[]>('/api/users?status=pending')).body.find((u) => u.username === 'carol')!;
    expect((await head.post(`/api/users/${carolUser.id}/approve`, {})).status).toBe(200);
    expect((await carol.login('carol')).status).toBe(200);
    expect((await root.patch(`/api/users/${carolUser.id}`, { role: 'head_of_it' })).status).toBe(200);
    // the Head of IT may not disable a superadmin: refused and recorded
    expect((await head.patch(`/api/users/${users.root.id}`, { status: 'disabled' })).status).toBe(403);
    expect((await root.patch(`/api/users/${carolUser.id}`, { status: 'disabled' })).status).toBe(200);
    expect((await root.patch(`/api/users/${carolUser.id}`, { status: 'active' })).status).toBe(200);
    expect((await root.patch(`/api/users/${carolUser.id}`, { name: 'Carol Baru' })).status).toBe(200);
    expect((await root.post(`/api/users/${carolUser.id}/password`, { password: 'a brand new passphrase' })).status).toBe(204);
    expect((await root.delete(`/api/users/${carolUser.id}`)).status).toBe(204);

    const log = await all(head, `q=carol`);
    const by = (action: string) => find(log, action, (e) => e.targetId === carolUser.id || e.actorId === carolUser.id);
    expect(by('auth.register')).toMatchObject({ actorId: carolUser.id, actorName: 'Carol', actorRole: 'staff', targetLabel: 'carol' });
    expect(find(log, 'auth.login_failed', (e) => e.actorId === carolUser.id)).toMatchObject({ actorKind: 'user', details: { reason: 'pending', identifier: 'carol' } });
    expect(by('user.approve')).toMatchObject({ actorId: users.head.id, actorName: 'Hadi Head', actorRole: 'head_of_it', details: { role: 'staff' } });
    expect(by('user.role_change')).toMatchObject({ actorId: users.root.id, actorName: 'Root Admin', details: { from: 'staff', to: 'head_of_it' } });
    expect(by('auth.session_revoked')).toMatchObject({ details: { sessions: 1, reason: 'role_change' } });
    expect(by('user.disable')).toMatchObject({ outcome: 'success' });
    expect(by('user.enable')).toMatchObject({ outcome: 'success' });
    expect(by('user.rename')).toMatchObject({ details: { from: 'Carol', to: 'Carol Baru' } });
    expect(by('user.password_reset')).toMatchObject({ targetLabel: 'carol' });
    expect(by('user.delete')).toMatchObject({ details: { username: 'carol', role: 'head_of_it' } });
    // the account is gone; its own entries keep the name it had
    expect(by('auth.register')!.actorName).toBe('Carol');
    expect(by('user.role_change')!.summary).toBe('Root Admin mengubah peran carol: Staf Solar → Head of IT Solar');

    const refused = find(await all(root, 'outcome=failure&action=user.*'), 'user.disable', (e) => e.targetId === users.root.id)!;
    expect(refused).toMatchObject({ actorId: users.head.id, outcome: 'failure', targetLabel: 'root', details: { reason: 'forbidden' } });
  });

  it('own password change, logout', async () => {
    const dave = await userClient(server.url, root, 'dave', 'staff', 'Dave');
    expect((await dave.client.post('/api/auth/password', { currentPassword: 'not my password!', newPassword: 'another long passphrase' })).status).toBe(400);
    expect((await dave.client.post('/api/auth/password', { currentPassword: STRONG_PASSWORD, newPassword: 'another long passphrase' })).status).toBe(204);
    expect((await dave.client.post('/api/auth/logout')).status).toBe(204);
    const mine = await all(root, `actor=${dave.user.id}`);
    expect(mine.map((e) => `${e.action}:${e.outcome}`)).toEqual(['auth.logout:success', 'auth.password_change:success', 'auth.password_change:failure', 'auth.login:success']);
    expect(mine[2]!.details).toEqual({ reason: 'wrong_password' });
  });
});

describe('tasks, approvals, the agent, knowledge, skills and settings', () => {
  it('records what people and the agent do on their behalf', async () => {
    // a task whose tool waits for approval: approved
    const t1 = (await alice.post<Task>('/api/tasks', { prompt: '[approve] write it', sessionId: 's-act' })).body;
    const c1 = await pendingFor(alice, t1.id);
    expect((await alice.post(`/api/confirmations/${c1.id}`, { approved: true })).status).toBe(200);
    await finished(alice, t1.id);
    // the agent saves a knowledge file once a superadmin approves it
    const t2 = (await root.post<Task>('/api/tasks', { prompt: '[kb] keep AUDITGATE', sessionId: 's-act', language: 'en' })).body;
    const c2 = await pendingFor(root, t2.id);
    expect(c2.tool).toBe('save_knowledge');
    expect((await root.post(`/api/confirmations/${c2.id}`, { approved: true })).status).toBe(200);
    expect((await finished(root, t2.id)).task.status).toBe('completed');
    // a task cancelled while it waits; its approval is declined first by another one
    const t3 = (await alice.post<Task>('/api/tasks', { prompt: '[approve] and then cancel', sessionId: 's-act' })).body;
    const c3 = await pendingFor(alice, t3.id);
    expect((await head.post(`/api/confirmations/${c3.id}`, { approved: false })).status).toBe(200);
    const t4 = (await alice.post<Task>('/api/tasks', { prompt: '[approve] to cancel', sessionId: 's-act' })).body;
    await pendingFor(alice, t4.id);
    expect((await alice.post(`/api/tasks/${t4.id}/cancel`)).status).toBe(200);

    // knowledge by hand
    expect((await root.put('/api/knowledge/file', { path: 'systems/HANDMADE.md', content: '# Handmade\n' })).status).toBe(200);
    expect((await root.delete('/api/knowledge/file?path=systems/HANDMADE.md')).status).toBe(200);
    // skills (a name that a spreadsheet would run as a formula)
    const skill = (await root.post<{ id: string }>('/api/skills', { name: '=HYPERLINK("http://evil.test")', description: 'x', content: 'Do things.' })).body;
    expect((await root.put(`/api/skills/${skill.id}`, { enabled: false })).status).toBe(200);
    expect((await root.put(`/api/skills/${skill.id}`, { content: 'Do other things.' })).status).toBe(200);
    expect((await root.delete(`/api/skills/${skill.id}`)).status).toBe(200);
    // settings, with secrets in their bodies
    expect(
      (await root.post('/api/llm/providers', { id: 'acme', name: 'Acme AI', kind: 'openai-chat', baseUrl: 'http://127.0.0.1:9/v1', apiKey: PROVIDER_KEY, headers: { 'X-Key': PROVIDER_KEY }, models: [{ id: 'acme-1' }] })).status,
    ).toBe(201);
    expect((await root.put('/api/llm/providers/acme', { apiKey: `${PROVIDER_KEY}-2` })).status).toBe(200);
    expect((await root.put('/api/llm/routes', { routes: { default: ['openai/gpt-6.1-sol', 'acme/acme-1'] } })).status).toBe(200);
    expect((await root.delete('/api/llm/providers/acme')).status).toBe(200);
    expect(
      (await root.post('/api/plugins', { id: 'audit-test', name: 'Audit Test', enabled: false, transport: 'http', url: 'http://127.0.0.1:9/mcp', headers: { Authorization: `Bearer ${PLUGIN_TOKEN}` }, env: { TOKEN: PLUGIN_TOKEN } })).status,
    ).toBe(201);
    expect((await root.put('/api/plugins/audit-test', { headers: { Authorization: `Bearer ${PLUGIN_TOKEN}x` } })).status).toBe(200);
    expect((await root.delete('/api/plugins/audit-test')).status).toBe(200);

    const mine = await all(alice);
    expect(find(mine, 'task.create', (e) => e.targetId === t1.id)).toMatchObject({ targetLabel: '[approve] write it', details: { language: 'id', attachments: 0 } });
    expect(find(mine, 'confirmation.approve', (e) => e.details?.taskId === t1.id)).toMatchObject({ targetType: 'confirmation', details: { tool: 'test_external_write' } });
    const adminEvents = await all(root, `actor=${users.root.id}`);
    expect(find(adminEvents, 'knowledge.write', (e) => e.details?.via === 'agent')).toMatchObject({
      actorId: users.root.id,
      actorName: 'Root Admin',
      targetId: 'systems/AUDITGATE.md',
      details: { via: 'agent', taskId: t2.id, replaced: null },
      ip: null,
    });
    expect(find(mine, 'task.cancel', (e) => e.targetId === t4.id)).toBeDefined();
    expect(find(adminEvents, 'knowledge.write', (e) => e.targetId === 'systems/HANDMADE.md')).toBeDefined();
    expect(find(adminEvents, 'knowledge.delete', (e) => e.targetId === 'systems/HANDMADE.md')).toBeDefined();
    expect(adminEvents.filter((e) => e.action.startsWith('skill.')).map((e) => e.action).reverse()).toEqual(['skill.create', 'skill.disable', 'skill.update', 'skill.delete']);
    // declined by the Head of IT: in the Head's log, not alice's
    expect(find(mine, 'confirmation.reject')).toBeUndefined();
    expect(find(await all(head, `actor=${users.head.id}`), 'confirmation.reject', (e) => e.details?.taskId === t3.id)).toBeDefined();

    const settings = await all(root, 'action=settings.llm.*,settings.plugin.*');
    expect(settings.map((e) => e.action).reverse()).toEqual([
      'settings.llm.provider_create',
      'settings.llm.provider_update',
      'settings.llm.route_change',
      'settings.llm.provider_delete',
      'settings.plugin.create',
      'settings.plugin.update',
      'settings.plugin.delete',
    ]);
    expect(find(settings, 'settings.llm.provider_update')!.details).toMatchObject({ fields: ['apiKey'] });
  });

  it('holds no secret anywhere: not in the API, not on disk', async () => {
    const everything = JSON.stringify(await all(root));
    const onDisk = readdirSync(join(dataDir, 'activity'))
      .map((f) => readFileSync(join(dataDir, 'activity', f), 'utf8'))
      .join('\n');
    for (const text of [everything, onDisk]) {
      for (const secret of [TYPED_SECRET, OTHER_SECRET, STRONG_PASSWORD, 'another long passphrase', 'a brand new passphrase', PROVIDER_KEY, PLUGIN_TOKEN, TEST_ACCESS_TOKEN, 'ghost.user@nowhere.test', 'ROOT@SOLAR.TEST', 'scrypt$', root.session!, alice.session!]) {
        expect(text.includes(secret), secret).toBe(false);
      }
      // file contents are not logged either
      expect(text).not.toContain('An API gateway.');
    }
  });
});

describe('who sees what', () => {
  it('staff see only their own entries, whatever they ask for; head and superadmin see everyone', async () => {
    const own = await all(alice, `actor=${users.root.id}`);
    expect(own.length).toBeGreaterThan(3);
    expect(own.every((e) => e.actorId === users.alice.id)).toBe(true);
    const everyone = await all(head);
    expect(everyone.some((e) => e.actorId === users.root.id)).toBe(true);
    expect(everyone.some((e) => e.actorId === users.head.id)).toBe(true);
    expect(everyone.some((e) => e.actorKind === 'anonymous')).toBe(true);
    expect((await all(head, `actor=${users.alice.id}`)).map((e) => e.id)).toEqual(own.map((e) => e.id));
    expect((await all(root, 'actor=me')).every((e) => e.actorId === users.root.id)).toBe(true);
    // the access token sees everything too
    expect((await all(tokenClient(server.url))).map((e) => e.id)).toEqual(everyone.map((e) => e.id));
  });

  it('filters, cursor pagination and summaries in the language of the request', async () => {
    const full = await all(head);
    // newest first, no duplicates
    const keys = full.map((e) => `${e.at}|${e.id}`);
    expect([...keys].sort().reverse()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
    // walked three at a time: the same list
    const walked: string[] = [];
    let cursor: string | null = null;
    do {
      const res: { body: ActivityPage } = await head.get<ActivityPage>(`/api/activity?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(res.body.items.length).toBeLessThanOrEqual(3);
      walked.push(...res.body.items.map((e) => e.id));
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(walked).toEqual(full.map((e) => e.id));

    expect((await all(head, 'action=auth.login')).every((e) => e.action === 'auth.login')).toBe(true);
    expect((await all(head, 'action=user.*')).every((e) => e.action.startsWith('user.'))).toBe(true);
    const failures = await all(head, 'outcome=failure');
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.every((e) => e.outcome === 'failure')).toBe(true);
    expect((await all(head, 'q=AUDITGATE')).every((e) => JSON.stringify([e.targetLabel, e.targetId, e.details, e.actorName, e.action]).includes('AUDITGATE'))).toBe(true);
    const today = new Date().toISOString().slice(0, 10);
    expect((await all(head, `from=${today}&to=${today}`)).length).toBe(full.length);
    expect(await all(head, 'to=2020-01-01')).toEqual([]);
    expect(await all(head, `from=${new Date(Date.now() + 86_400_000).toISOString()}`)).toEqual([]);

    expect((await head.get('/api/activity?action=no.such.action')).status).toBe(400);
    expect((await head.get('/api/activity?cursor=garbage')).status).toBe(400);
    expect((await head.get('/api/activity?limit=500')).status).toBe(400);
    expect((await head.get('/api/activity?from=yesterday')).status).toBe(400);

    const en = (await head.get<ActivityPage>('/api/activity?action=auth.login&limit=1', { 'X-Solar-Language': 'en' })).body.items[0]!;
    const id = (await head.get<ActivityPage>('/api/activity?action=auth.login&limit=1')).body.items[0]!;
    expect(en.id).toBe(id.id);
    expect(en.summary).toMatch(/ logged in$/);
    expect(id.summary).toMatch(/ masuk$/);
  });

  it('GET /api/activity/actions: every code with a label, for every role', async () => {
    const res = await alice.get<ActivityActionInfo[]>('/api/activity/actions', { 'X-Solar-Language': 'en' });
    expect(res.status).toBe(200);
    expect(res.body.map((a) => a.action)).toEqual([...ACTIVITY_ACTIONS]);
    expect(res.body.find((a) => a.action === 'auth.login_failed')).toEqual({ action: 'auth.login_failed', group: 'auth', label: 'Failed login' });
    expect((await new Client(server.url).get('/api/activity/actions')).status).toBe(401);
  });
});

describe('CSV export', () => {
  it('superadmin and Head of IT export the filtered log, formulas defused; staff may not', async () => {
    expect((await alice.get('/api/activity.csv')).status).toBe(403);
    const res = await head.raw('GET', '/api/activity.csv?action=skill.*', undefined, { 'X-Solar-Language': 'en' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="solar-activity-\d{8}\.csv"$/);
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe('id,at,actor_id,actor_name,actor_role,actor_kind,action,action_label,outcome,target_type,target_id,target_label,summary,ip,user_agent,details');
    expect(lines.length).toBe(5);
    expect(lines.slice(1).every((l) => l.includes('"skill.'))).toBe(true);
    // the skill name starts with "=": shown as text in a spreadsheet, never run as a formula
    expect(text).toContain(`"'=HYPERLINK(""http://evil.test"")"`);
    expect(text).not.toMatch(/(^|,)"=/m);
    const exported = find(await all(head, `actor=${users.head.id}`), 'activity.export')!;
    expect(exported).toMatchObject({ details: { rows: 4, filters: { action: 'skill.*' } } });
  });
});

describe('refused attempts, names people choose, stored text', () => {
  it('records staff attempts refused by the route permission checks (users, settings), throttled, without their bodies', async () => {
    const attempts = [
      () => alice.delete(`/api/users/${users.root.id}`),
      () => alice.post(`/api/users/${users.root.id}/password`, { password: TYPED_SECRET }),
      () => alice.patch(`/api/users/${users.head.id}`, { role: 'superadmin' }),
      () => alice.post('/api/users', { username: 'mallory', email: 'mallory@solar.test', name: 'Mallory', password: OTHER_SECRET, role: 'superadmin' }),
      () => alice.post(`/api/users/${users.head.id}/approve`, {}),
      () => alice.put('/api/llm/routes', { routes: { default: ['openai/gpt-6.1-sol'] } }),
      () => alice.delete('/api/plugins/revplug'),
      () => alice.post('/api/llm/providers', { id: 'evil', name: 'Evil', kind: 'openai-chat', baseUrl: 'http://127.0.0.1:9/v1', apiKey: PROVIDER_KEY, models: [{ id: 'm' }] }),
    ];
    for (const attempt of attempts) expect((await attempt()).status).toBe(403);
    // the same attempt again within the minute: refused again, recorded once
    expect((await alice.delete(`/api/users/${users.root.id}`)).status).toBe(403);

    const refused = (await all(root, `actor=${users.alice.id}&outcome=failure`)).filter((e) => e.details?.reason === 'forbidden');
    expect(refused.map((e) => `${e.action}:${e.targetId ?? '-'}`).reverse()).toEqual([
      // the CSV export tried earlier
      'activity.export:-',
      `user.delete:${users.root.id}`,
      `user.password_reset:${users.root.id}`,
      `user.role_change:${users.head.id}`,
      'user.create:-',
      `user.approve:${users.head.id}`,
      'settings.llm.route_change:routes',
      'settings.plugin.delete:revplug',
      'settings.llm.provider_create:-',
    ]);
    for (const e of refused) expect(e).toMatchObject({ actorName: 'Alice Staff', actorRole: 'staff', actorKind: 'user', outcome: 'failure', ip: expect.any(String) });
    expect(find(refused, 'user.role_change')!.details).toEqual({ to: 'superadmin', reason: 'forbidden' });
    // what the URL names, not looked up: staff see their own entries, and must not learn whose id it is
    expect(find(refused, 'user.delete')).toMatchObject({ targetLabel: null, summary: `Ditolak: Alice Staff menghapus akun ${users.root.id} (tidak diizinkan)` });
    const text = JSON.stringify(refused);
    for (const secret of [TYPED_SECRET, OTHER_SECRET, PROVIDER_KEY, 'mallory']) expect(text).not.toContain(secret);
    // a refused read is not an attempt to change anything: not recorded
    expect((await alice.get('/api/plugins')).status).toBe(403);
    expect((await all(root, `actor=${users.alice.id}&outcome=failure`)).filter((e) => e.details?.reason === 'forbidden')).toHaveLength(refused.length);
    // staff see their own refused attempts
    expect((await all(alice, 'outcome=failure')).filter((e) => e.details?.reason === 'forbidden')).toHaveLength(refused.length);
  });

  it('keeps model routes whose names look like secrets (token-saver)', async () => {
    const routes = { default: ['openai/gpt-6.1-sol'], 'token-saver': ['openai/gpt-6.1-sol'], 'hash-check': ['openai/gpt-6.1-sol'] };
    expect((await root.put('/api/llm/routes', { routes })).status).toBe(200);
    const change = (await all(root, 'action=settings.llm.route_change&outcome=success'))[0]!;
    expect(change.details!.to).toEqual(Object.entries(routes).map(([name, models]) => ({ name, models })));
    expect(change.details!.redactedKeys).toBeUndefined();
  });

  it('stores well-formed, visible text: lone surrogates and bidi/zero-width characters become U+FFFD', async () => {
    const task = await alice.post<Task>('/api/tasks', { prompt: `${'x'.repeat(86)}😀 and more`, sessionId: 's\ud800' });
    expect(task.status).toBe(201);
    // the title is cut between characters, never inside the emoji
    expect(task.body.title).toBe(`${'x'.repeat(86)}...`);
    const kb = await root.put('/api/knowledge/file', { path: 'systems/SPOOF.md', content: '---\ntitle: "invoice‮fdp.exe"\n---\n# T\ud800\n' });
    expect(kb.status).toBe(200);
    await finished(alice, task.body.id);
    const mine = await all(alice);
    expect(find(mine, 'task.create', (e) => e.targetId === task.body.id)).toMatchObject({ targetLabel: `${'x'.repeat(86)}...`, details: { sessionId: 's�' } });
    expect(find(await all(root, `actor=${users.root.id}`), 'knowledge.write', (e) => e.targetId === 'systems/SPOOF.md')!.details).toMatchObject({ title: 'invoice�fdp.exe' });
    const onDisk = readdirSync(join(dataDir, 'activity'))
      .map((f) => readFileSync(join(dataDir, 'activity', f), 'utf8'))
      .join('\n');
    expect(onDisk).not.toMatch(/\\ud[89a-f][0-9a-f]{2}|‮/i);
  });
});

describe('first-superadmin setup', () => {
  it('records the first superadmin made from SOLAR_ADMIN_* at startup, as done by SOLAR itself', async () => {
    const setup = await all(root, 'action=auth.setup');
    expect(setup).toHaveLength(1);
    expect(setup[0]).toMatchObject({
      actorKind: 'system',
      actorId: null,
      targetId: users.root.id,
      targetLabel: 'root',
      outcome: 'success',
      details: { role: 'superadmin', via: 'env' },
      summary: 'Superadmin pertama root dibuat (dari SOLAR_ADMIN_* saat server mulai)',
    });
    // before the first login
    const first = (await all(root)).at(-1)!;
    expect(first.id).toBe(setup[0]!.id);
  });

  it('records refused and successful setups, never the setup code', async () => {
    const s = await startAuthServer({ config: authTestConfig({}, mkdtempSync(join(tmpdir(), 'solar-activity-setup-'))) });
    try {
      const code = s.setupCode()!;
      const c = new Client(s.url);
      const account = { username: 'first', email: 'first@solar.test', name: 'First Admin', password: STRONG_PASSWORD };
      expect((await c.post('/api/auth/setup', { ...account, setupCode: 'WRONG-CODE-0000-0000' })).body).toMatchObject({ code: 'setup_code_invalid' });
      expect((await c.post('/api/auth/setup', { ...account, setupCode: code })).status).toBe(201);
      const log = await all(c);
      // the new superadmin sees everyone's log: the refused attempt (nobody) and its own setup
      expect(log.map((e) => `${e.action}:${e.outcome}`)).toEqual(['auth.setup:success', 'auth.setup:failure']);
      expect(log[0]).toMatchObject({ actorName: 'First Admin', actorRole: 'superadmin', targetLabel: 'first', details: { role: 'superadmin', via: 'setup_code' } });
      expect(log[1]).toMatchObject({ actorKind: 'anonymous', details: { reason: 'setup_code_invalid' } });
      expect(JSON.stringify(log)).not.toContain(code);
      expect(JSON.stringify(log)).not.toContain('WRONG-CODE');
    } finally {
      await s.close();
    }
  });
});

describe('retention', () => {
  it('removes entries older than ACTIVITY_RETENTION_DAYS at startup (then daily); 0 keeps everything', async () => {
    for (const days of ['30', '0']) {
      const dir = mkdtempSync(join(tmpdir(), 'solar-activity-retention-'));
      const store = new FileActivityStore(join(dir, 'activity'));
      await store.init();
      const old = { ...nextActivityStamp(Date.now() - 400 * 86_400_000) };
      const recent = { ...nextActivityStamp(Date.now() - 10 * 86_400_000) };
      const base = { actorId: null, actorName: null, actorRole: null, actorKind: 'system', action: 'task.create', targetType: null, targetId: null, targetLabel: 'x', outcome: 'success', ip: null, userAgent: null, details: null } as const;
      await store.append([
        { ...old, ...base },
        { ...recent, ...base },
      ]);
      const s = await startAuthServer({ config: authTestConfig({ SOLAR_ACCESS_TOKEN: TEST_ACCESS_TOKEN, ACTIVITY_RETENTION_DAYS: days }, dir) });
      try {
        const token = tokenClient(s.url);
        const ids = async () => (await all(token, 'action=task.create')).map((e) => e.id);
        if (days === '30') await waitFor(async () => !(await ids()).includes(old.id), 5_000, 'retention cleanup');
        else await new Promise((r) => setTimeout(r, 200));
        expect(await ids()).toEqual(days === '30' ? [recent.id] : [recent.id, old.id]);
        expect((await token.get<AuthMe>('/api/auth/me')).status).toBe(200);
      } finally {
        await s.close();
      }
    }
  });
});
