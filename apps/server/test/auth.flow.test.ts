import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AuthMe, AuthState, User } from '@solar/shared';
import { verifyDummy } from '../src/auth/password.js';
import type { RunningServer } from '../src/server.js';
import {
  authTestConfig,
  Client,
  FAST_SCRYPT,
  LOOSE_LIMITS,
  startAuthServer,
  STRONG_PASSWORD,
  TEST_ACCESS_TOKEN,
  tokenClient,
  userClient,
} from './helpers/authServer.js';

// count the dummy password checks of logins naming unknown accounts (the real scrypt runs underneath)
vi.mock('../src/auth/password.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/auth/password.js')>();
  return { ...mod, verifyDummy: vi.fn(mod.verifyDummy) };
});

const ROOT = { SOLAR_ADMIN_USERNAME: 'Root', SOLAR_ADMIN_EMAIL: 'Root@Solar.test', SOLAR_ADMIN_PASSWORD: STRONG_PASSWORD, SOLAR_ADMIN_NAME: 'Root Admin' };

/** A raw HTTP request with headers fetch() does not allow (Host). */
function rawRequest(url: string, method: string, headers: Record<string, string>, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method, headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
      let data = '';
      res.on('data', (c: Buffer) => (data += c.toString('utf8')));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data ? (JSON.parse(data) as Record<string, unknown>) : {} }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

describe('registration, approval and login (file storage, superadmin from SOLAR_ADMIN_*)', () => {
  let server: RunningServer;
  let root: Client;
  let admin: Client;

  beforeAll(async () => {
    server = await startAuthServer({ config: authTestConfig({ ...ROOT, SOLAR_ACCESS_TOKEN: TEST_ACCESS_TOKEN }) });
    root = new Client(server.url);
    admin = tokenClient(server.url);
  });
  afterAll(async () => {
    await server.close();
  });

  it('creates the first superadmin from SOLAR_ADMIN_* (lower-cased) and opens registration', async () => {
    const state = await new Client(server.url).get<AuthState>('/api/auth/state');
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ setupRequired: false, registrationOpen: true, me: null, passwordPolicy: { minLength: 10, maxLength: 128 } });
    const login = await root.login('root');
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({ username: 'root', email: 'root@solar.test', name: 'Root Admin', role: 'superadmin', status: 'active' });
    expect(login.body.via).toBe('session');
    expect(login.body.permissions).toContain('settings.manage');
    // never a password hash in an answer
    expect(JSON.stringify(login.body)).not.toMatch(/scrypt|passwordHash/);
  });

  it('register -> pending (no login) -> 403 pending -> approve -> 200 with a HttpOnly, SameSite=Lax cookie', async () => {
    const budi = new Client(server.url);
    const reg = await budi.post('/api/auth/register', { username: 'Budi.Santoso', email: 'Budi@Solar.test', name: '  Budi   Santoso ', password: STRONG_PASSWORD });
    expect(reg.status).toBe(201);
    expect(reg.body).toEqual({ status: 'pending' });
    expect(reg.setCookies).toEqual([]);
    expect(budi.session).toBeNull();

    // the right password proves the account: told it waits for approval
    const pending = await budi.login('budi.santoso');
    expect(pending.status).toBe(403);
    expect(pending.body).toMatchObject({ code: 'account_pending' });
    expect(pending.setCookies).toEqual([]);
    // a wrong password learns nothing about the account's state
    const wrong = await budi.login('budi.santoso', 'not the password');
    expect(wrong.status).toBe(401);
    expect(wrong.body).toMatchObject({ code: 'invalid_credentials' });

    const list = await root.get<User[]>('/api/users?status=pending');
    expect(list.status).toBe(200);
    const pendingUser = list.body.find((u) => u.username === 'budi.santoso')!;
    expect(pendingUser).toMatchObject({ email: 'budi@solar.test', name: 'Budi Santoso', role: 'staff', status: 'pending', approvedAt: null });
    expect(JSON.stringify(list.body)).not.toMatch(/scrypt|passwordHash/);
    expect((await root.get<{ count: number }>('/api/users/pending-count')).body.count).toBe(1);

    const approved = await root.post<User>(`/api/users/${pendingUser.id}/approve`, {});
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: 'active', role: 'staff' });
    expect(approved.body.approvedBy).toBe((await root.get<AuthMe>('/api/auth/me')).body.user!.id);
    expect((await root.post(`/api/users/${pendingUser.id}/approve`, {})).body).toMatchObject({ code: 'not_pending' });

    // by email, any case
    const ok = await budi.login('BUDI@solar.test');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ role: 'staff', via: 'session', user: { username: 'budi.santoso' } });
    expect(ok.body.permissions).toEqual(['agent.use', 'knowledge.read', 'knowledge.write', 'skills.read', 'skills.manage', 'activity.view_own']);
    const cookie = ok.setCookies.find((c) => c.startsWith('solar_session='))!;
    expect(cookie).toMatch(/^solar_session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toContain('; HttpOnly');
    expect(cookie).toContain('; SameSite=Lax');
    expect(cookie).toContain('; Path=/');
    expect(cookie).toContain(`; Max-Age=${30 * 86_400}`);
    // plain http: not Secure
    expect(cookie).not.toContain('Secure');
    const me = await budi.get<AuthMe>('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user?.lastLoginAt).toBeTruthy();
  });

  it('refuses taken usernames and emails (case-insensitive) and invalid fields, in the language of the request', async () => {
    const c = new Client(server.url);
    const taken = await c.post('/api/auth/register', { username: 'ROOT', email: 'other@solar.test', name: 'X', password: STRONG_PASSWORD });
    expect(taken.status).toBe(409);
    expect(taken.body).toEqual({ error: 'Username "root" sudah dipakai', code: 'username_taken' });
    const email = await c.post('/api/auth/register', { username: 'other', email: 'ROOT@solar.TEST', name: 'X', password: STRONG_PASSWORD }, { 'X-Solar-Language': 'en' });
    expect(email.status).toBe(409);
    expect(email.body).toMatchObject({ code: 'email_taken' });
    expect(String(email.body.error)).toMatch(/already registered/);

    const cases: Array<[Record<string, string>, string]> = [
      [{ username: 'ab', email: 'ab@solar.test', name: 'A', password: STRONG_PASSWORD }, 'invalid_input'],
      [{ username: 'abc', email: 'not-an-email', name: 'A', password: STRONG_PASSWORD }, 'invalid_input'],
      [{ username: 'abc', email: 'abc@solar.test', name: '', password: STRONG_PASSWORD }, 'invalid_input'],
      [{ username: 'abc', email: 'abc@solar.test', name: 'A', password: 'short' }, 'weak_password'],
      [{ username: 'abcdefghijk', email: 'abc@solar.test', name: 'A', password: 'ABCDEFGHIJK' }, 'weak_password'],
    ];
    for (const [body, code] of cases) {
      const res = await c.post('/api/auth/register', body, { 'X-Solar-Language': 'en' });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.code, JSON.stringify(body)).toBe(code);
    }
    expect((await c.post('/api/auth/register', { username: 'abc' })).status).toBe(400);
  });

  it('answers a wrong password and an unknown account the same way, running a real password check for both', async () => {
    const c = new Client(server.url);
    vi.mocked(verifyDummy).mockClear();
    const unknown = await c.login('nobody.here', STRONG_PASSWORD);
    const wrong = await c.login('root', 'wrong password!!');
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(unknown.body).toEqual({ error: 'Username/email atau password salah', code: 'invalid_credentials' });
    expect(vi.mocked(verifyDummy)).toHaveBeenCalledTimes(1);
  });

  it('logout ends the session and clears the cookie', async () => {
    const { client } = await userClient(server.url, admin, 'logout.user', 'staff');
    const token = client.session;
    const out = await client.post('/api/auth/logout');
    expect(out.status).toBe(204);
    expect(out.setCookies.some((c) => /^solar_session=;.*Max-Age=0/.test(c))).toBe(true);
    // the old cookie value no longer works
    const replay = new Client(server.url);
    replay.session = token;
    const me = await replay.get('/api/auth/me');
    expect(me.status).toBe(401);
    expect(me.body.code).toBe('unauthenticated');
  });

  it('a password change ends the other sessions, keeps the current one', async () => {
    const { client: a } = await userClient(server.url, admin, 'pw.user', 'staff');
    const b = new Client(server.url);
    expect((await b.login('pw.user')).status).toBe(200);

    expect((await a.post('/api/auth/password', { currentPassword: 'wrong password!!', newPassword: 'another long password' })).body.code).toBe('wrong_password');
    expect((await a.post('/api/auth/password', { currentPassword: STRONG_PASSWORD, newPassword: 'short' })).body.code).toBe('weak_password');
    const changed = await a.post('/api/auth/password', { currentPassword: STRONG_PASSWORD, newPassword: 'another long password' });
    expect(changed.status).toBe(204);
    expect((await a.get('/api/auth/me')).status).toBe(200);
    expect((await b.get('/api/auth/me')).status).toBe(401);
    expect((await new Client(server.url).login('pw.user')).status).toBe(401);
    expect((await new Client(server.url).login('pw.user', 'another long password')).status).toBe(200);
    // the access token is not an account
    expect((await admin.post('/api/auth/password', { currentPassword: 'x', newPassword: 'another long password' })).status).toBe(400);
  });

  it('disabling, a role change and a password reset end every session of the account', async () => {
    const { client: c, user } = await userClient(server.url, admin, 'revoke.user', 'staff');
    // disable
    expect((await root.patch(`/api/users/${user.id}`, { status: 'disabled' })).body).toMatchObject({ status: 'disabled' });
    expect((await c.get('/api/auth/me')).status).toBe(401);
    const disabled = await c.login('revoke.user');
    expect(disabled.status).toBe(403);
    expect(disabled.body.code).toBe('account_disabled');
    // enable, log in again, then a role change
    expect((await root.patch(`/api/users/${user.id}`, { status: 'active' })).body).toMatchObject({ status: 'active' });
    expect((await c.login('revoke.user')).status).toBe(200);
    expect((await root.patch(`/api/users/${user.id}`, { role: 'head_of_it' })).body).toMatchObject({ role: 'head_of_it' });
    expect((await c.get('/api/auth/me')).status).toBe(401);
    expect((await c.login('revoke.user')).body).toMatchObject({ role: 'head_of_it' });
    // reset
    expect((await root.post(`/api/users/${user.id}/password`, { password: 'reset by the admin' })).status).toBe(204);
    expect((await c.get('/api/auth/me')).status).toBe(401);
    expect((await c.login('revoke.user', 'reset by the admin')).status).toBe(200);
    // status "pending" cannot be set
    expect((await root.patch(`/api/users/${user.id}`, { status: 'pending' })).status).toBe(400);
  });

  it('keeps at least one active superadmin; nobody changes their own role or disables themselves', async () => {
    const me = (await root.get<AuthMe>('/api/auth/me')).body.user!;
    expect((await root.patch(`/api/users/${me.id}`, { role: 'staff' })).body.code).toBe('self_action');
    expect((await root.patch(`/api/users/${me.id}`, { status: 'disabled' })).body.code).toBe('self_action');
    expect((await root.delete(`/api/users/${me.id}`)).body.code).toBe('self_action');
    expect((await root.post(`/api/users/${me.id}/password`, { password: 'my own new password' })).body.code).toBe('self_action');
    // the token is a superadmin but not this account: the guard still holds
    for (const res of [
      await admin.patch(`/api/users/${me.id}`, { role: 'staff' }),
      await admin.patch(`/api/users/${me.id}`, { status: 'disabled' }),
      await admin.delete(`/api/users/${me.id}`),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('last_superadmin');
    }
    // with a second superadmin, two who demote each other at the same time cannot both succeed
    const { client: other, user: otherUser } = await userClient(server.url, admin, 'second.admin', 'superadmin');
    const [a, b] = await Promise.all([root.patch(`/api/users/${otherUser.id}`, { role: 'staff' }), other.patch(`/api/users/${me.id}`, { role: 'staff' })]);
    expect([a.status, b.status].filter((s) => s === 200)).toHaveLength(1);
    const users = (await admin.get<User[]>('/api/users')).body;
    expect(users.filter((u) => u.role === 'superadmin' && u.status === 'active').length).toBeGreaterThanOrEqual(1);
    // a renamed display name; then restore root as superadmin if it was the one demoted
    const rootNow = users.find((u) => u.id === me.id)!;
    if (rootNow.role !== 'superadmin') expect((await admin.patch(`/api/users/${me.id}`, { role: 'superadmin' })).status).toBe(200);
    expect((await admin.patch(`/api/users/${otherUser.id}`, { name: 'Second Admin' })).body).toMatchObject({ name: 'Second Admin' });
    expect((await admin.delete(`/api/users/${otherUser.id}`)).status).toBe(204);
    expect((await admin.get(`/api/users/${otherUser.id}`)).status).toBe(404);
  });

  it('SOLAR_ACCESS_TOKEN acts as a superadmin; a wrong token is refused even next to a valid cookie', async () => {
    const me = await admin.get<AuthMe>('/api/auth/me');
    expect(me.body).toMatchObject({ user: null, role: 'superadmin', via: 'token' });
    expect((await admin.get('/api/llm')).status).toBe(200);
    expect((await new Client(server.url).get(`/api/llm?token=${TEST_ACCESS_TOKEN}`)).status).toBe(200);
    const bad = new Client(server.url, { Authorization: 'Bearer nope' });
    bad.session = root.session;
    const res = await bad.get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('invalid_token');
  });

  it('protects everything but health, auth state and the login forms', async () => {
    const anon = new Client(server.url);
    expect((await anon.get('/api/health')).status).toBe(200);
    expect((await anon.get('/api/auth/state')).status).toBe(200);
    for (const path of ['/api/config', '/api/tasks', '/api/tasks/stats', '/api/stream', '/api/knowledge', '/api/skills', '/api/users', '/api/auth/me', '/api/confirmations']) {
      const res = await anon.get(path);
      expect(res.status, path).toBe(401);
      expect(res.body.code, path).toBe('unauthenticated');
    }
    expect((await anon.post('/api/tasks', { prompt: 'x', sessionId: 's' })).status).toBe(401);
    // a stale cookie is cleared with the 401
    const stale = new Client(server.url);
    stale.session = 'A'.repeat(43);
    const res = await stale.get('/api/tasks');
    expect(res.status).toBe(401);
    expect(res.setCookies.some((c) => c.startsWith('solar_session=;'))).toBe(true);
  });

  it('refuses cookie-authenticated state changes from a foreign origin (CSRF), and login from one', async () => {
    const { client } = await userClient(server.url, admin, 'csrf.user', 'staff');
    const port = new URL(server.url).port;
    const body = { path: 'notes/csrf.md', content: '# csrf' };
    // the token deployment does not check Host/Origin for the network: the same-origin guard does
    const foreign = await client.put('/api/knowledge/file', body, { Origin: 'http://evil.example' });
    expect(foreign.status).toBe(403);
    // another port of this computer is "same-site" for SameSite=Lax, but not the same origin
    expect((await client.put('/api/knowledge/file', body, { Origin: 'http://127.0.0.1:1' })).status).toBe(403);
    expect((await client.put('/api/knowledge/file', body, { Origin: 'null' })).status).toBe(403);
    expect((await client.put('/api/knowledge/file', body, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    expect((await client.post('/api/auth/logout', {}, { Origin: 'http://evil.example' })).status).toBe(403);
    expect((await client.get('/api/auth/me')).status).toBe(200);
    // login CSRF
    expect((await new Client(server.url).post('/api/auth/login', { identifier: 'csrf.user', password: STRONG_PASSWORD }, { Origin: 'http://evil.example' })).status).toBe(403);
    // the app's own origin, and non-browser clients (no Origin), pass
    expect((await client.put('/api/knowledge/file', body, { Origin: `http://127.0.0.1:${port}` })).status).toBe(200);
    expect((await client.put('/api/knowledge/file', body, { 'Sec-Fetch-Site': 'same-origin' })).status).toBe(200);
    expect((await client.put('/api/knowledge/file', body)).status).toBe(200);
    // the access token is not ambient: no origin check
    expect((await admin.put('/api/knowledge/file', body, { Origin: 'http://evil.example' })).status).toBe(200);
  });
});

describe('local-only server (no SOLAR_ACCESS_TOKEN)', () => {
  let server: RunningServer;
  beforeAll(async () => {
    server = await startAuthServer({ config: authTestConfig(ROOT) });
  });
  afterAll(async () => {
    await server.close();
  });

  it('still refuses a foreign Origin before anything else, and another local port for cookie writes', async () => {
    const root = new Client(server.url);
    expect((await root.login('root')).status).toBe(200);
    const res = await root.put('/api/knowledge/file', { path: 'a/b.md', content: '# x' }, { Origin: 'http://evil.example' });
    expect(res.status).toBe(403);
    // localhost:3000 passes the local-host check but is not SOLAR's origin
    expect((await root.put('/api/knowledge/file', { path: 'a/b.md', content: '# x' }, { Origin: 'http://localhost:3000' })).status).toBe(403);
    // no access token configured: a presented one is wrong
    expect((await new Client(server.url, { Authorization: 'Bearer anything' }).get('/api/tasks')).status).toBe(401);
  });

  it('marks the cookie Secure only for HTTPS - X-Forwarded-Proto is ignored without TRUST_PROXY', async () => {
    const res = await new Client(server.url).post('/api/auth/login', { identifier: 'root', password: STRONG_PASSWORD }, { 'X-Forwarded-Proto': 'https' });
    expect(res.status).toBe(200);
    expect(res.setCookies.join('\n')).not.toContain('Secure');
  });
});

describe('behind a trusted reverse proxy (TRUST_PROXY=1)', () => {
  let server: RunningServer;
  beforeAll(async () => {
    server = await startAuthServer({ config: authTestConfig({ ...ROOT, TRUST_PROXY: 'true', SOLAR_ACCESS_TOKEN: TEST_ACCESS_TOKEN }) });
  });
  afterAll(async () => {
    await server.close();
  });

  it('sets Secure when the proxy says HTTPS, and checks the origin against X-Forwarded-Host', async () => {
    const c = new Client(server.url, { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'solar.example.co.id', 'X-Forwarded-For': '203.0.113.7' });
    const res = await c.login('root');
    expect(res.status).toBe(200);
    const cookie = res.setCookies.find((x) => x.startsWith('solar_session='))!;
    expect(cookie).toContain('; Secure');
    expect(cookie).toContain('; HttpOnly');
    expect((await c.put('/api/knowledge/file', { path: 'p/q.md', content: '# q' }, { Origin: 'https://solar.example.co.id' })).status).toBe(200);
    expect((await c.put('/api/knowledge/file', { path: 'p/q.md', content: '# q' }, { Origin: 'https://evil.example' })).status).toBe(403);
    // the session records the client address the proxy reported
    const sessions = JSON.parse(readFileSync(join(server.config.dataDir, 'sessions.json'), 'utf8')) as Array<{ ip: string; tokenHash: string }>;
    expect(sessions.some((s) => s.ip === '203.0.113.7')).toBe(true);
    // only the hash of the token is stored
    expect(JSON.stringify(sessions)).not.toContain(c.session!);
  });
});

describe('rate limits (default limits)', () => {
  let server: RunningServer;
  beforeAll(async () => {
    // a trusted proxy lets each test choose its client address
    server = await startAuthServer({
      config: authTestConfig({ ...ROOT, TRUST_PROXY: '1', SOLAR_ACCESS_TOKEN: TEST_ACCESS_TOKEN }),
      auth: { scrypt: FAST_SCRYPT },
    });
    const admin = tokenClient(server.url);
    for (const name of ['victim.one', 'victim.two']) {
      await admin.post('/api/users', { username: name, email: `${name}@solar.test`, name, password: STRONG_PASSWORD, role: 'staff' });
    }
  });
  afterAll(async () => {
    await server.close();
  });

  const from = (ip: string) => new Client(server.url, { 'X-Forwarded-For': ip });

  it('blocks an account after 10 failed logins (from any addresses) with 429 and Retry-After', async () => {
    for (let i = 0; i < 10; i++) expect((await from(`198.51.100.${i}`).login('victim.one', 'wrong password!!')).status).toBe(401);
    const blocked = await from('198.51.100.50').login('victim.one', 'wrong password!!');
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('rate_limited');
    const retry = Number(blocked.headers.get('retry-after'));
    expect(retry).toBeGreaterThan(800);
    expect(retry).toBeLessThanOrEqual(900);
    // the right password does not get through while blocked, by email either (same account)
    expect((await from('198.51.100.51').login('victim.one', STRONG_PASSWORD)).status).toBe(429);
    expect((await from('198.51.100.52').login('victim.one@solar.test', STRONG_PASSWORD)).status).toBe(429);
    // other accounts are not affected
    expect((await from('198.51.100.53').login('victim.two')).status).toBe(200);
  });

  it('blocks a client address after 10 failed logins (any identifiers)', async () => {
    const ip = '192.0.2.10';
    for (let i = 0; i < 10; i++) expect((await from(ip).login(`guess.${i}`, 'wrong password!!')).status).toBe(401);
    expect((await from(ip).login('victim.two')).status).toBe(429);
    expect((await from('192.0.2.11').login('victim.two')).status).toBe(200);
  });

  it('allows 5 registrations per address and hour', async () => {
    const ip = '192.0.2.20';
    for (let i = 0; i < 5; i++) {
      expect((await from(ip).post('/api/auth/register', { username: `new.user${i}`, email: `new${i}@solar.test`, name: 'N', password: STRONG_PASSWORD })).status).toBe(201);
    }
    const sixth = await from(ip).post('/api/auth/register', { username: 'new.user5', email: 'new5@solar.test', name: 'N', password: STRONG_PASSWORD });
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get('retry-after'))).toBeGreaterThan(3000);
  });
});

describe('first superadmin setup', () => {
  it('only while no account exists, from this computer, exactly once even when raced', async () => {
    const server = await startAuthServer();
    try {
      const anon = new Client(server.url);
      expect((await anon.get<AuthState>('/api/auth/state')).body).toMatchObject({ setupRequired: true, registrationOpen: false });
      // registration waits for the first superadmin
      const reg = await anon.post('/api/auth/register', { username: 'early.bird', email: 'early@solar.test', name: 'E', password: STRONG_PASSWORD });
      expect(reg.status).toBe(409);
      expect(reg.body.code).toBe('registration_closed');

      // through a proxy / from the network: refused
      const proxied = await anon.post('/api/auth/setup', { username: 'admin', email: 'admin@solar.test', name: 'Admin', password: STRONG_PASSWORD }, { 'X-Forwarded-For': '203.0.113.5' });
      expect(proxied.status).toBe(403);
      expect(proxied.body.code).toBe('setup_forbidden');
      // a DNS-rebound name pointing at 127.0.0.1 is refused before the setup is reached
      const rebound = await rawRequest(`${server.url}/api/auth/setup`, 'POST', { Host: 'evil.example' }, { username: 'admin', email: 'admin@solar.test', name: 'Admin', password: STRONG_PASSWORD });
      expect(rebound.status).toBe(403);

      // from this computer, with the one-time setup code from the server log / DATA_DIR/setup-code.txt
      const setupCode = server.setupCode();
      expect(setupCode).toMatch(/^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){3}$/);
      const clients = Array.from({ length: 5 }, () => new Client(server.url));
      const results = await Promise.all(
        clients.map((c, i) =>
          c.post<AuthMe>('/api/auth/setup', { username: `admin${i}`, email: `admin${i}@solar.test`, name: `Admin ${i}`, password: STRONG_PASSWORD, setupCode }),
        ),
      );
      const won = results.filter((r) => r.status === 201);
      expect(won).toHaveLength(1);
      expect(results.filter((r) => r.status === 409).every((r) => (r.body as unknown as { code: string }).code === 'setup_not_available')).toBe(true);
      expect(won[0]!.body).toMatchObject({ role: 'superadmin', via: 'session', user: { status: 'active' } });
      expect(won[0]!.setCookies.some((c) => c.startsWith('solar_session='))).toBe(true);
      const winner = clients[results.indexOf(won[0]!)]!;
      expect((await winner.get('/api/auth/me')).status).toBe(200);
      expect((await winner.get<User[]>('/api/users')).body).toHaveLength(1);

      expect((await anon.post('/api/auth/setup', { username: 'late', email: 'late@solar.test', name: 'L', password: STRONG_PASSWORD, setupCode })).status).toBe(409);
      // the code is used up
      expect(server.setupCode()).toBeNull();
      expect((await anon.get<AuthState>('/api/auth/state')).body).toMatchObject({ setupRequired: false, registrationOpen: true });
    } finally {
      await server.close();
    }
  });

  it('with SOLAR_ACCESS_TOKEN: the token may set up from anywhere; a rebound Host is still refused', async () => {
    const server = await startAuthServer({ config: authTestConfig({ SOLAR_ACCESS_TOKEN: TEST_ACCESS_TOKEN }) });
    try {
      // localOnly is off for token deployments: the rebound Host reaches the setup, which does not see a local request
      const rebound = await rawRequest(`${server.url}/api/auth/setup`, 'POST', { Host: 'evil.example' }, { username: 'admin', email: 'admin@solar.test', name: 'Admin', password: STRONG_PASSWORD });
      expect(rebound.status).toBe(403);
      expect(rebound.body.code).toBe('setup_forbidden');
      const viaToken = await tokenClient(server.url).post<AuthMe>(
        '/api/auth/setup',
        { username: 'admin', email: 'admin@solar.test', name: 'Admin', password: STRONG_PASSWORD },
        { 'X-Forwarded-For': '203.0.113.5' },
      );
      expect(viaToken.status).toBe(201);
      expect(viaToken.body.user).toMatchObject({ role: 'superadmin', approvedBy: 'system:access-token' });
    } finally {
      await server.close();
    }
  });
});

describe('SOLAR_ADMIN_* bootstrap and password hash upgrade', () => {
  it('refuses to start when users.json is unreadable (instead of reopening the first-superadmin setup)', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'solar-auth-broken-'));
    writeFileSync(join(dataDir, 'users.json'), '{ not json');
    await expect(startAuthServer({ config: authTestConfig({}, dataDir) })).rejects.toThrow(/users\.json is not valid/);
  });

  it('refuses to start with an invalid bootstrap account, ignores it once accounts exist, rehashes old parameters at login', async () => {
    await expect(startAuthServer({ config: authTestConfig({ ...ROOT, SOLAR_ADMIN_PASSWORD: 'short' }) })).rejects.toThrow(/at least 10 characters/);

    const dataDir = mkdtempSync(join(tmpdir(), 'solar-auth-upgrade-'));
    // first start: fast (old) parameters
    const first = await startAuthServer({ config: authTestConfig(ROOT, dataDir), auth: { scrypt: FAST_SCRYPT, limits: LOOSE_LIMITS } });
    await first.close();
    const hashOf = () => (JSON.parse(readFileSync(join(dataDir, 'users.json'), 'utf8')) as Array<{ username: string; passwordHash: string }>).find((u) => u.username === 'root')!.passwordHash;
    expect(hashOf().startsWith('scrypt$1024$8$1$')).toBe(true);

    // second start: production parameters and another SOLAR_ADMIN_USERNAME, which is ignored now
    const second = await startAuthServer({ config: authTestConfig({ ...ROOT, SOLAR_ADMIN_USERNAME: 'someone.else', SOLAR_ADMIN_EMAIL: 'else@solar.test' }, dataDir), auth: { limits: LOOSE_LIMITS } });
    try {
      const root = new Client(second.url);
      expect((await root.login('root')).status).toBe(200);
      expect(hashOf().startsWith('scrypt$32768$8$1$')).toBe(true);
      // the new hash works
      expect((await new Client(second.url).login('root')).status).toBe(200);
      expect((await root.get<User[]>('/api/users')).body.map((u) => u.username)).toEqual(['root']);
    } finally {
      await second.close();
    }
  });
});

describe('session lifetime', () => {
  it('slides with use (idle limit) and ends at the absolute maximum', async () => {
    let now = Date.parse('2026-10-12T00:00:00Z');
    const server = await startAuthServer({
      config: authTestConfig({ ...ROOT, SESSION_TTL_HOURS: '1', SESSION_MAX_DAYS: '1' }),
      auth: { scrypt: FAST_SCRYPT, limits: LOOSE_LIMITS, now: () => now },
    });
    try {
      const c = new Client(server.url);
      const login = await c.login('root');
      expect(login.setCookies.find((x) => x.startsWith('solar_session='))).toContain(`Max-Age=${86_400}`);
      // idle: 50 minutes twice is fine (each use renews the hour), 61 minutes without use is not
      now += 50 * 60_000;
      expect((await c.get('/api/auth/me')).status).toBe(200);
      now += 50 * 60_000;
      expect((await c.get('/api/auth/me')).status).toBe(200);
      now += 61 * 60_000;
      expect((await c.get('/api/auth/me')).status).toBe(401);

      // absolute: used every 50 minutes, the session still ends 24 h after the login
      const d = new Client(server.url);
      const start = now;
      expect((await d.login('root')).status).toBe(200);
      let endedAfter = 0;
      for (let i = 0; i < 40; i++) {
        now += 50 * 60_000;
        if ((await d.get('/api/auth/me')).status === 401) {
          endedAfter = now - start;
          break;
        }
      }
      expect(endedAfter).toBeGreaterThan(23 * 3_600_000);
      expect(endedAfter).toBeLessThanOrEqual(24 * 3_600_000 + 50 * 60_000);
    } finally {
      await server.close();
    }
  });
});
