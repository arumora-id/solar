import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Attachment, AuthMe, Task, User } from '@solar/shared';
import { EMPTY_USAGE } from '@solar/shared';
import { PostgresRepository } from '../src/storage/postgresRepository.js';
import type { StoredSession, StoredUser } from '../src/storage/repository.js';
import { authTestConfig, Client, startAuthServer, STRONG_PASSWORD, TEST_ACCESS_TOKEN, tokenClient } from './helpers/authServer.js';

/**
 * Users, sessions and task owners in Postgres. Runs only with SOLAR_TEST_AUTH_DATABASE_URL (a database it may wipe:
 * every solar_* table is dropped first), e.g. postgresql://user@127.0.0.1:5432/solar_auth_test.
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
      'DROP TABLE IF EXISTS solar_sessions, solar_users, solar_confirmations, solar_artifacts, solar_task_events, solar_attachments, solar_tasks CASCADE',
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

describe.skipIf(!url)('Postgres: the auth flow through the API', () => {
  it('bootstrap, registration, approval, login, revocation', async () => {
    const pool = new pg.Pool({ connectionString: url });
    await pool.query('DROP TABLE IF EXISTS solar_sessions, solar_users CASCADE');
    await pool.end();
    const config = authTestConfig({ SOLAR_ACCESS_TOKEN: TEST_ACCESS_TOKEN, SOLAR_ADMIN_USERNAME: 'pgroot', SOLAR_ADMIN_EMAIL: 'pgroot@solar.test', SOLAR_ADMIN_PASSWORD: STRONG_PASSWORD });
    config.databaseUrl = url;
    const server = await startAuthServer({ config });
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
    } finally {
      await server.close();
    }
  });
});
