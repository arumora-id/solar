import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ActivityEntry, ActivityPage, Attachment, AuthMe, RoleInfo, Task, User } from '@solar/shared';
import { EMPTY_USAGE } from '@solar/shared';
import { ActivityLog, nextActivityStamp, TOKEN_ACTOR } from '../src/activity/activityLog.js';
import { PostgresRepository } from '../src/storage/postgresRepository.js';
import type { ActivityQuery, StoredSession, StoredUser } from '../src/storage/repository.js';
import { roleRows, USERS_ROLE_FK } from '../src/storage/schema.js';
import { authTestConfig, Client, message, startAuthServer, StatelessModel, STRONG_PASSWORD, TEST_ACCESS_TOKEN, tokenClient } from './helpers/authServer.js';

/**
 * Users, sessions, task owners, roles and the activity log in Postgres. Runs only with SOLAR_TEST_AUTH_DATABASE_URL (a
 * database it may wipe: every solar_* table is dropped first), e.g. postgresql://user@127.0.0.1:5432/solar_auth_test.
 */
const url = process.env.SOLAR_TEST_AUTH_DATABASE_URL;

const user = (id: string, username: string, email: string, extra: Partial<StoredUser> = {}): StoredUser => ({
  id,
  username,
  email,
  name: username,
  role: 'staff',
  status: 'active',
  passwordHash: 'scrypt$1024$8$1$c2FsdHNhbHRzYWx0c2FsdA$a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2V5',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  lastLoginAt: null,
  approvedAt: null,
  approvedBy: null,
  ...extra,
});

const task = (id: string, ownerId?: string): Task => ({
  id,
  sessionId: 's1',
  title: id,
  prompt: id,
  status: 'completed',
  progress: 100,
  currentStep: null,
  model: 'm',
  createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, Number(id.replace(/\D/g, '')) || 0)).toISOString(),
  startedAt: null,
  finishedAt: null,
  result: null,
  error: null,
  usage: { ...EMPTY_USAGE, costUsd: 1 },
  attachmentIds: [],
  language: 'en',
  ...(ownerId ? { ownerId } : {}),
});

describe.skipIf(!url)('Postgres: users, sessions, task owners', () => {
  let a: PostgresRepository;
  let b: PostgresRepository;

  beforeAll(async () => {
    const pool = new pg.Pool({ connectionString: url });
    await pool.query(
      'DROP TABLE IF EXISTS solar_activity, solar_sessions, solar_users, solar_roles, solar_confirmations, solar_artifacts, solar_task_events, solar_attachments, solar_tasks CASCADE',
    );
    // a database from before user accounts: the old tables with a task and an upload, no owner columns
    await pool.query(`CREATE TABLE solar_tasks (id text PRIMARY KEY, session_id text NOT NULL, title text NOT NULL, prompt text NOT NULL,
      status text NOT NULL, progress integer NOT NULL DEFAULT 0, current_step text, model text NOT NULL, created_at timestamptz NOT NULL,
      started_at timestamptz, finished_at timestamptz, result text, error text, usage jsonb NOT NULL DEFAULT '{}'::jsonb,
      attachment_ids jsonb NOT NULL DEFAULT '[]'::jsonb, language text NOT NULL DEFAULT 'id')`);
    await pool.query(`INSERT INTO solar_tasks (id, session_id, title, prompt, status, model, created_at) VALUES ('task_legacy', 's1', 'old', 'old', 'completed', 'm', '2025-01-01')`);
    await pool.end();
    // two repositories = two processes sharing the database
    a = new PostgresRepository(url!);
    b = new PostgresRepository(url!);
    await a.init();
    await b.init();
  });

  afterAll(async () => {
    await a?.close();
    await b?.close();
  });

  it('adds the owner column to an existing database; old tasks have no owner', async () => {
    const legacy = await a.getTask('task_legacy');
    expect(legacy).not.toBeNull();
    expect(legacy!.ownerId).toBeUndefined();
    expect((await a.listTasks({ limit: 10, ownerId: null })).map((t) => t.id)).toEqual(['task_legacy']);
  });

  it('creates the first account exactly once across processes', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => (i % 2 ? a : b).createFirstUser(user(`usr_first${i}`, `first${i}`, `first${i}@solar.test`, { role: 'superadmin' }))),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await a.countUsers()).toBe(1);
    expect(await b.createFirstUser(user('usr_late', 'late', 'late@solar.test'))).toBe(false);
  });

  it('keeps usernames and emails unique regardless of case', async () => {
    expect(await a.createUser(user('usr_budi', 'budi', 'budi@solar.test'))).toBe('created');
    expect(await b.createUser(user('usr_x1', 'BUDI', 'other@solar.test'))).toBe('username-taken');
    expect(await b.createUser(user('usr_x2', 'other', 'Budi@Solar.TEST'))).toBe('email-taken');
    expect((await a.findUserByUsername('Budi'))?.id).toBe('usr_budi');
    expect((await a.findUserByEmail('BUDI@solar.test'))?.id).toBe('usr_budi');
    expect(await a.createUser(user('usr_pend', 'pending.one', 'p1@solar.test', { status: 'pending' }))).toBe('created');
    expect((await a.listUsers({ status: 'pending' })).map((u) => u.id)).toEqual(['usr_pend']);
    expect(await a.countUsers({ status: 'pending' })).toBe(1);
    expect(await a.countUsers({ role: 'superadmin', status: 'active' })).toBe(1);
    const updated = await a.updateUser('usr_pend', { status: 'active', approvedAt: '2026-10-02T00:00:00.000Z', approvedBy: 'usr_budi', updatedAt: '2026-10-02T00:00:00.000Z' });
    expect(updated).toMatchObject({ status: 'active', approvedBy: 'usr_budi', approvedAt: '2026-10-02T00:00:00.000Z', username: 'pending.one' });
    expect(await a.updateUser('usr_nobody', { name: 'x' })).toBeNull();
  });

  it('stores sessions by hash, renews, revokes all but one, expires, and drops them with the account', async () => {
    const s = (hash: string, userId: string, expiresAt: string): StoredSession => ({
      tokenHash: hash,
      userId,
      createdAt: '2026-10-01T00:00:00.000Z',
      lastSeenAt: '2026-10-01T00:00:00.000Z',
      expiresAt,
      userAgent: 'test',
      ip: '127.0.0.1',
    });
    await a.createSession(s('h1', 'usr_budi', '2026-12-01T00:00:00.000Z'));
    await a.createSession(s('h2', 'usr_budi', '2026-12-01T00:00:00.000Z'));
    await a.createSession(s('h3', 'usr_budi', '2026-10-05T00:00:00.000Z'));
    await a.createSession(s('h4', 'usr_pend', '2026-12-01T00:00:00.000Z'));
    await b.touchSession('h1', '2026-10-03T00:00:00.000Z', '2026-12-03T00:00:00.000Z');
    expect(await b.getSession('h1')).toMatchObject({ userId: 'usr_budi', lastSeenAt: '2026-10-03T00:00:00.000Z', expiresAt: '2026-12-03T00:00:00.000Z' });
    expect(await a.deleteExpiredSessions('2026-10-10T00:00:00.000Z')).toBe(1);
    expect((await a.deleteUserSessions('usr_budi', 'h1')).sort()).toEqual(['h2']);
    expect(await a.getSession('h1')).not.toBeNull();
    await a.deleteSession('h1');
    expect(await a.getSession('h1')).toBeNull();
    expect(await a.deleteUser('usr_pend')).toBe(true);
    expect(await a.getSession('h4')).toBeNull();
    expect(await a.deleteUser('usr_pend')).toBe(false);
  });

  it('records task and attachment owners once, filters and totals by owner', async () => {
    await a.upsertTask(task('task_1', 'usr_budi'));
    await a.upsertTask(task('task_2', 'usr_other'));
    // an update never moves the task to another owner
    await a.upsertTask({ ...task('task_1', 'usr_other'), status: 'failed' });
    expect(await a.getTask('task_1')).toMatchObject({ ownerId: 'usr_budi', status: 'failed' });
    expect((await a.listTasks({ limit: 10, ownerId: 'usr_budi' })).map((t) => t.id)).toEqual(['task_1']);
    expect((await a.listTasks({ limit: 10, sessionId: 's1', ownerId: 'usr_other' })).map((t) => t.id)).toEqual(['task_2']);
    expect((await a.stats({ ownerId: 'usr_budi' })).total).toBe(1);
    expect((await a.stats()).total).toBe(3);
    const att: Attachment = {
      id: 'att_1',
      sessionId: 's1',
      name: 'a.md',
      kind: 'markdown',
      mimeType: 'text/markdown',
      size: 1,
      parts: null,
      chars: 1,
      outline: [],
      warnings: [],
      storageKey: 'k',
      textKey: 't',
      createdAt: '2026-10-01T00:00:00.000Z',
      ownerId: 'usr_budi',
    };
    await a.saveAttachment(att);
    expect((await b.getAttachment('att_1'))?.ownerId).toBe('usr_budi');
  });
});

describe.skipIf(!url)('Postgres: roles and the activity log', () => {
  let repo: PostgresRepository;
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    repo = new PostgresRepository(url!);
    await repo.init();
  });

  afterAll(async () => {
    await repo?.close();
    await pool?.end();
  });

  const fk = async () =>
    (await pool.query(`SELECT convalidated FROM pg_constraint WHERE conname = $1 AND conrelid = 'solar_users'::regclass`, [USERS_ROLE_FK])).rows as Array<{
      convalidated: boolean;
    }>;

  it('seeds solar_roles from the code at every start, without touching unchanged rows', async () => {
    const read = async () =>
      (await pool.query('SELECT id, name_id, name_en, description_id, description_en, permissions, sort_order, updated_at FROM solar_roles ORDER BY sort_order')).rows as Array<
        Record<string, unknown>
      >;
    const rows = await read();
    expect(
      rows.map((r) => ({
        id: r.id,
        nameId: r.name_id,
        nameEn: r.name_en,
        descriptionId: r.description_id,
        descriptionEn: r.description_en,
        permissions: r.permissions,
        sortOrder: r.sort_order,
      })),
    ).toEqual(roleRows());
    // a role edited by hand is put back; the others keep their updated_at
    await pool.query(`UPDATE solar_roles SET permissions = '["settings.manage"]'::jsonb WHERE id = 'staff'`);
    await repo.init();
    const again = await read();
    expect(again.find((r) => r.id === 'staff')!.permissions).toEqual(roleRows().find((r) => r.id === 'staff')!.permissions);
    expect(again.find((r) => r.id === 'superadmin')!.updated_at).toEqual(rows.find((r) => r.id === 'superadmin')!.updated_at);
  });

  it('solar_users.role must be a known role (foreign key, added once, validated)', async () => {
    expect(await fk()).toEqual([{ convalidated: true }]);
    await expect(repo.createUser(user('usr_badrole', 'badrole', 'badrole@solar.test', { role: 'emperor' as never }))).rejects.toMatchObject({ code: '23503' });
    // a database with an account of a role the code does not know (edited by hand) still starts: NOT VALID until fixed
    await pool.query(`ALTER TABLE solar_users DROP CONSTRAINT ${USERS_ROLE_FK}`);
    await pool.query(
      `INSERT INTO solar_users (id, username, email, name, role, status, password_hash, created_at, updated_at) VALUES ('usr_legacyrole', 'legacyrole', 'legacyrole@solar.test', 'L', 'admin', 'active', 'x', now(), now())`,
    );
    await repo.init();
    expect(await fk()).toEqual([{ convalidated: false }]);
    // the old row can still be used (a login updates other columns), new rows are checked
    expect(await repo.updateUser('usr_legacyrole', { lastLoginAt: new Date().toISOString() })).not.toBeNull();
    await expect(repo.updateUser('usr_legacyrole', { role: 'emperor' as never })).rejects.toMatchObject({ code: '23503' });
    await repo.updateUser('usr_legacyrole', { role: 'staff' });
    await repo.init();
    expect(await fk()).toEqual([{ convalidated: true }]);
    await repo.deleteUser('usr_legacyrole');
  });

  it('activity: batches, newest-first pages with filters and cursors, retention', async () => {
    await pool.query('DELETE FROM solar_activity');
    const start = Date.parse('2026-09-01T00:00:00.000Z');
    const entries: ActivityEntry[] = Array.from({ length: 250 }, (_, i) => {
      const { id, at } = nextActivityStamp(start + i * 3_600_000);
      return {
        id,
        at,
        actorId: i % 2 ? 'usr_odd' : 'usr_even',
        actorName: i % 2 ? 'Odd 100%_done' : 'Even',
        actorRole: 'staff',
        actorKind: 'user',
        action: i % 10 === 0 ? 'auth.login_failed' : i % 3 === 0 ? 'user.rename' : 'task.create',
        targetType: 'task',
        targetId: `task_${i}`,
        targetLabel: `Task ${i}`,
        outcome: i % 10 === 0 ? 'failure' : 'success',
        ip: '127.0.0.1',
        userAgent: 'test',
        details: i === 7 ? { via: 'agent', note: 'Needle' } : null,
      };
    });
    for (let i = 0; i < entries.length; i += 100) await repo.appendActivity(entries.slice(i, i + 100));
    // the same id twice is skipped
    await repo.appendActivity([entries[0]!]);
    const newest = [...entries].reverse();

    const walk = async (q: Omit<ActivityQuery, 'limit' | 'before'>, limit = 40) => {
      const ids: string[] = [];
      let before: ActivityQuery['before'];
      do {
        const page = await repo.listActivity({ ...q, limit, before });
        ids.push(...page.items.map((e) => e.id));
        before = page.next ?? undefined;
      } while (before);
      return ids;
    };
    expect(await walk({})).toEqual(newest.map((e) => e.id));
    const first = await repo.listActivity({ limit: 1 });
    expect(first.items[0]).toEqual(newest[0]);
    expect(await walk({ actorId: 'usr_odd', outcome: 'success' })).toEqual(newest.filter((e) => e.actorId === 'usr_odd' && e.outcome === 'success').map((e) => e.id));
    expect(await walk({ actionPrefixes: ['user.'] })).toEqual(newest.filter((e) => e.action.startsWith('user.')).map((e) => e.id));
    expect(await walk({ actions: ['auth.login_failed', 'user.rename'] })).toEqual(
      newest.filter((e) => e.action === 'auth.login_failed' || e.action === 'user.rename').map((e) => e.id),
    );
    const from = new Date(start + 24 * 3_600_000).toISOString();
    const to = new Date(start + 48 * 3_600_000).toISOString();
    expect(await walk({ from, to })).toEqual(newest.filter((e) => e.at >= from && e.at < to).map((e) => e.id));
    expect(await walk({ q: 'needle' })).toEqual([entries[7]!.id]);
    // LIKE wildcards in the search text are taken literally
    expect((await walk({ q: '100%_d' })).length).toBe(125);
    expect(await walk({ q: '100%x' })).toEqual([]);

    expect(await repo.deleteActivityBefore(new Date(start + 100 * 3_600_000).toISOString())).toBe(100);
    expect(await walk({})).toEqual(newest.slice(0, 150).map((e) => e.id));
  });

  it('a lone UTF-16 surrogate (refused by jsonb) never sinks the entries batched with it', async () => {
    const at = Date.now() - 3_600_000;
    const base = (i: number, extra: Partial<ActivityEntry> = {}): ActivityEntry => ({
      ...nextActivityStamp(at + i),
      actorId: 'usr_x',
      actorName: 'X',
      actorRole: 'staff',
      actorKind: 'user',
      action: 'task.create',
      targetType: 'task',
      targetId: `task_lone_${i}`,
      targetLabel: `Lone ${i}`,
      outcome: 'success',
      ip: null,
      userAgent: null,
      details: null,
      ...extra,
    });
    // straight to the repository, unsanitised: the bad row is stored without its details, its neighbours whole
    const raw = [base(0, { details: { role: 'superadmin' } }), base(1, { targetLabel: 'T\ud800', details: { sessionId: 's\ud800' } }), base(2)];
    await expect(pool.query(`SELECT $1::jsonb`, [JSON.stringify({ a: 's\ud800' })])).rejects.toMatchObject({ code: expect.stringMatching(/^22/) });
    await repo.appendActivity(raw);
    const rows = (await pool.query(`SELECT id, target_label, details FROM solar_activity WHERE target_id LIKE 'task_lone_%' ORDER BY id`)).rows as Array<{
      id: string;
      target_label: string;
      details: unknown;
    }>;
    expect(rows.map((r) => r.id)).toEqual(raw.map((e) => e.id));
    expect(rows[0]!.details).toEqual({ role: 'superadmin' });
    expect(rows[1]).toMatchObject({ target_label: 'T�', details: { invalid: true } });
    expect(rows[2]!.details).toBeNull();

    // through the ActivityLog (what the server does): every text cleaned, the whole batch stored with its details
    const log = new ActivityLog(repo, { retentionDays: 0, flushDelayMs: 10_000 });
    log.record({ action: 'user.create', actor: TOKEN_ACTOR, target: { type: 'user', id: 'usr_victim', label: 'victim' }, details: { role: 'superadmin' } });
    log.record({
      action: 'task.create',
      actor: { id: 'usr_eve', name: 'Eve\ud800', role: 'staff', kind: 'user' },
      target: { type: 'task', id: 'task_eve', label: `${'x'.repeat(86)} \ud83d` },
      details: { sessionId: 's\ud800', ['k\udc00']: 1, title: 'invoice‮fdp.exe' },
    });
    log.record({ action: 'knowledge.write', actor: TOKEN_ACTOR, target: { type: 'knowledge', id: 'systems/T.md', label: 'T\ud800' }, details: { title: 'T\ud800' } });
    await log.close();
    expect(log.droppedCount()).toBe(0);
    const page = await repo.listActivity({ limit: 3 });
    expect(page.items.map((e) => e.action)).toEqual(['knowledge.write', 'task.create', 'user.create']);
    expect(page.items[1]).toMatchObject({
      actorName: 'Eve�',
      targetLabel: `${'x'.repeat(86)} �`,
      details: { sessionId: 's�', 'k�': 1, title: 'invoice�fdp.exe' },
    });
    expect(page.items[2]!.details).toEqual({ role: 'superadmin' });
  });
});

describe.skipIf(!url)('Postgres: the auth flow through the API', () => {
  it('bootstrap, registration, approval, login, revocation', async () => {
    const pool = new pg.Pool({ connectionString: url });
    await pool.query('DROP TABLE IF EXISTS solar_sessions, solar_users CASCADE');
    await pool.end();
    const config = authTestConfig({ SOLAR_ACCESS_TOKEN: TEST_ACCESS_TOKEN, SOLAR_ADMIN_USERNAME: 'pgroot', SOLAR_ADMIN_EMAIL: 'pgroot@solar.test', SOLAR_ADMIN_PASSWORD: STRONG_PASSWORD });
    config.databaseUrl = url;
    const server = await startAuthServer({ config, responses: new StatelessModel(() => [message('done')]) });
    try {
      const root = new Client(server.url);
      expect((await root.login('pgroot')).body).toMatchObject({ role: 'superadmin' });
      const c = new Client(server.url);
      expect((await c.post('/api/auth/register', { username: 'pg.user', email: 'pg.user@solar.test', name: 'PG', password: STRONG_PASSWORD })).status).toBe(201);
      expect((await c.post('/api/auth/register', { username: 'PG.USER', email: 'x@solar.test', name: 'PG', password: STRONG_PASSWORD })).body).toMatchObject({ code: 'username_taken' });
      expect((await c.login('pg.user')).body).toMatchObject({ code: 'account_pending' });
      const pending = (await root.get<User[]>('/api/users?status=pending')).body[0]!;
      expect((await root.post(`/api/users/${pending.id}/approve`, {})).status).toBe(200);
      expect((await c.login('pg.user@solar.test')).body).toMatchObject({ role: 'staff', via: 'session' });
      expect((await c.get<AuthMe>('/api/auth/me')).status).toBe(200);
      expect((await root.patch(`/api/users/${pending.id}`, { role: 'head_of_it' })).status).toBe(200);
      expect((await c.get('/api/auth/me')).status).toBe(401);
      const self = (await root.get<AuthMe>('/api/auth/me')).body.user!;
      expect((await tokenClient(server.url).delete(`/api/users/${self.id}`)).body).toMatchObject({ code: 'last_superadmin' });

      // the activity log in Postgres: what happened above, newest first, with the actors' names
      expect((await c.login('pg.user')).status).toBe(200);
      const log = (await root.get<ActivityPage>('/api/activity?limit=200', { 'X-Solar-Language': 'en' })).body.items;
      const actions = log.map((e) => e.action);
      for (const action of ['auth.login', 'auth.register', 'auth.login_failed', 'user.approve', 'user.role_change', 'user.delete']) expect(actions).toContain(action);
      expect(log.find((e) => e.action === 'user.role_change')).toMatchObject({ actorName: 'pgroot', details: { from: 'staff', to: 'head_of_it' }, targetLabel: 'pg.user' });
      expect(log.find((e) => e.action === 'user.delete')).toMatchObject({ actorKind: 'token', outcome: 'failure', details: { reason: 'last_superadmin' } });
      // the Head of IT pg.user sees everyone's entries; an own-only filter works the same
      const own = (await c.get<ActivityPage>('/api/activity?actor=me')).body.items;
      expect(own.length).toBeGreaterThan(0);
      expect(own.every((e) => e.actorId === pending.id)).toBe(true);
      expect((await c.get<RoleInfo[]>('/api/roles')).body.map((r) => r.id)).toEqual(['superadmin', 'head_of_it', 'staff']);

      // lone surrogates in a request (a session id, a knowledge heading) batched with an admin's account creation: all
      // recorded (jsonb refuses "\ud800"; the texts are cleaned before they are stored)
      const [made, created, written] = await Promise.all([
        root.post<User>('/api/users', { username: 'pg.second', email: 'pg.second@solar.test', name: 'Second', password: STRONG_PASSWORD, role: 'superadmin' }),
        root.post<Task>('/api/tasks', { prompt: `${'x'.repeat(86)}😀 and more`, sessionId: 's\ud800' }),
        root.put('/api/knowledge/file', { path: 'systems/LONE.md', content: '# T\ud800\n' }),
      ]);
      expect([made.status, created.status, written.status]).toEqual([201, 201, 200]);
      expect(created.body.title).toBe(`${'x'.repeat(86)}...`);
      const after = (await root.get<ActivityPage>('/api/activity?limit=20')).body.items;
      expect(after.find((e) => e.action === 'user.create')).toMatchObject({ targetId: made.body.id, details: { role: 'superadmin' } });
      expect(after.find((e) => e.action === 'task.create')).toMatchObject({ targetId: created.body.id, details: { sessionId: 's\ufffd' } });
      expect(after.find((e) => e.action === 'knowledge.write')).toMatchObject({ targetId: 'systems/LONE.md', details: { title: 'T\ufffd' } });
    } finally {
      await server.close();
    }
  });
});
