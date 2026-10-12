import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthMe, AuthState } from '@solar/shared';
import { ConcurrencyGate, DEFAULT_HASH_LIMITS, DEFAULT_SCRYPT, HashBusyError, hashLoad, setHashLimits, verifyDummy, verifyPassword } from '../src/auth/password.js';
import { RateLimiter } from '../src/auth/rateLimit.js';
import type { RunningServer } from '../src/server.js';
import { authTestConfig, Client, FAST_SCRYPT, startAuthServer, STRONG_PASSWORD, TEST_ACCESS_TOKEN, tokenClient, userClient } from './helpers/authServer.js';

// count the password checks that really run (the real scrypt runs underneath)
vi.mock('../src/auth/password.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/auth/password.js')>();
  return { ...mod, verifyPassword: vi.fn(mod.verifyPassword), verifyDummy: vi.fn(mod.verifyDummy) };
});

const ROOT = { SOLAR_ADMIN_USERNAME: 'root', SOLAR_ADMIN_EMAIL: 'root@solar.test', SOLAR_ADMIN_PASSWORD: STRONG_PASSWORD, SOLAR_ADMIN_NAME: 'Root' };

function tally(statuses: number[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const s of statuses) out[s] = (out[s] ?? 0) + 1;
  return out;
}

const checks = () => vi.mocked(verifyPassword).mock.calls.length + vi.mocked(verifyDummy).mock.calls.length;

describe('rate limits hold under concurrent attempts (default limits: 10 per 15 minutes)', () => {
  let server: RunningServer;
  let admin: Client;

  beforeAll(async () => {
    // a trusted proxy lets each request choose its client address
    server = await startAuthServer({
      config: authTestConfig({ ...ROOT, TRUST_PROXY: '1', SOLAR_ACCESS_TOKEN: TEST_ACCESS_TOKEN }),
      auth: { scrypt: FAST_SCRYPT },
    });
    admin = tokenClient(server.url);
    for (const name of ['burst.one', 'burst.two', 'burst.three', 'burst.four']) {
      const res = await admin.post('/api/users', { username: name, email: `${name}@solar.test`, name, password: STRONG_PASSWORD, role: 'staff' });
      expect(res.status).toBe(201);
    }
  });
  afterAll(async () => {
    await server.close();
  });
  beforeEach(() => {
    vi.mocked(verifyPassword).mockClear();
    vi.mocked(verifyDummy).mockClear();
  });

  const from = (ip: string) => new Client(server.url, { 'X-Forwarded-For': ip });

  it('60 parallel wrong logins for one account from one address: at most 10 passwords are checked', async () => {
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => from('203.0.113.1').login('burst.one', `wrong guess ${i} xxxx`)));
    const counts = tally(results.map((r) => r.status));
    expect(counts[401] ?? 0).toBeLessThanOrEqual(10);
    expect((counts[401] ?? 0) + (counts[429] ?? 0)).toBe(60);
    expect(checks()).toBeLessThanOrEqual(10);
    const limited = results.find((r) => r.status === 429)!;
    expect(limited.body.code).toBe('rate_limited');
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    // the right password does not get through afterwards either
    expect((await from('203.0.113.2').login('burst.one')).status).toBe(429);
  });

  it('parallel guesses for one account from many addresses (username and email) share the account limit', async () => {
    const results = await Promise.all(
      Array.from({ length: 60 }, (_, i) => from(`198.51.100.${i + 1}`).login(i % 2 ? 'burst.two' : 'Burst.Two@solar.test', `wrong guess ${i} xxxx`)),
    );
    const counts = tally(results.map((r) => r.status));
    expect(counts[401] ?? 0).toBeLessThanOrEqual(10);
    expect(checks()).toBeLessThanOrEqual(10);
    // a correct password sent right behind a burst is refused while the account is blocked
    expect((await from('198.51.100.200').login('burst.two')).status).toBe(429);
  });

  it('parallel guesses of unknown names from one address cost at most 10 password checks', async () => {
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => from('203.0.113.9').login(`nobody.${i}`, 'wrong guess xxxx')));
    const counts = tally(results.map((r) => r.status));
    expect(counts[401] ?? 0).toBeLessThanOrEqual(10);
    expect((counts[401] ?? 0) + (counts[429] ?? 0)).toBe(50);
    expect(checks()).toBeLessThanOrEqual(10);
  });

  it('successful logins are not counted against the address (attempts are counted up front, then given back)', async () => {
    for (let i = 0; i < 15; i++) expect((await from('203.0.113.20').login('burst.three')).status).toBe(200);
    // and a pending account with the right password is not a guess either
    for (let i = 0; i < 4; i++) {
      const reg = await from('203.0.113.21').post('/api/auth/register', { username: `waiting.${i}`, email: `waiting${i}@solar.test`, name: 'W', password: STRONG_PASSWORD });
      expect(reg.status).toBe(201);
    }
    for (let i = 0; i < 12; i++) expect((await from('203.0.113.22').login(`waiting.${i % 4}`)).body.code).toBe('account_pending');
  });

  it('parallel wrong current passwords: at most 10 are checked, then 429', async () => {
    const { client } = await userClient(server.url, admin, 'burst.five', 'staff');
    vi.mocked(verifyPassword).mockClear();
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => client.post('/api/auth/password', { currentPassword: `wrong current ${i}`, newPassword: 'another strong one' })),
    );
    const counts = tally(results.map((r) => r.status));
    expect(counts[400] ?? 0).toBeLessThanOrEqual(10);
    expect((counts[400] ?? 0) + (counts[429] ?? 0)).toBe(30);
    expect(vi.mocked(verifyPassword).mock.calls.length).toBeLessThanOrEqual(10);
  });
});

describe('public auth routes with a stale or wrong access token', () => {
  let server: RunningServer;
  let admin: Client;
  beforeAll(async () => {
    server = await startAuthServer({ config: authTestConfig({ ...ROOT, SOLAR_ACCESS_TOKEN: TEST_ACCESS_TOKEN }) });
    admin = tokenClient(server.url);
    await admin.post('/api/users', { username: 'stale.user', email: 'stale.user@solar.test', name: 'Stale', password: STRONG_PASSWORD, role: 'staff' });
  });
  afterAll(async () => {
    await server.close();
  });

  it('treats the stale token as absent on state, login, register and logout; protected routes still refuse it', async () => {
    const origin = { Origin: server.url };
    // a browser that still holds an old SOLAR_ACCESS_TOKEN (Bearer header, or ?token= on URLs)
    const browser = new Client(server.url, { Authorization: 'Bearer an-old-rotated-token', ...origin });
    const anonymous = await browser.get<AuthState>('/api/auth/state');
    expect(anonymous.status).toBe(200);
    expect(anonymous.body.me).toBeNull();

    const login = await browser.login('stale.user');
    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({ role: 'staff', via: 'session' });
    // the session cookie now identifies the user on the public state route, next to the stale token
    expect((await browser.get<AuthState>('/api/auth/state')).body.me).toMatchObject({ user: { username: 'stale.user' } });
    expect((await browser.get<AuthState>('/api/auth/state?token=old')).body.me).toMatchObject({ user: { username: 'stale.user' } });

    const reg = await browser.post('/api/auth/register', { username: 'stale.newbie', email: 'stale.newbie@solar.test', name: 'N', password: STRONG_PASSWORD });
    expect(reg.status).toBe(201);

    // protected routes: a wrong token is still refused (it does not fall back to the cookie)
    const me = await browser.get('/api/auth/me');
    expect(me.status).toBe(401);
    expect(me.body.code).toBe('invalid_token');

    const cookie = browser.session;
    const out = await browser.post('/api/auth/logout');
    expect(out.status).toBe(204);
    // the session really ended
    const after = new Client(server.url);
    after.session = cookie;
    expect((await after.get('/api/auth/me')).status).toBe(401);
  });

  it('a wrong token does not switch off the same-origin check of the public routes (logout / login CSRF)', async () => {
    const victim = new Client(server.url);
    expect((await victim.login('stale.user')).status).toBe(200);
    const csrf = await victim.post('/api/auth/logout?token=forged', {}, { Origin: 'http://evil.example' });
    expect(csrf.status).toBe(403);
    expect(csrf.setCookies.some((c) => c.startsWith('solar_session=;'))).toBe(false);
    expect((await victim.get('/api/auth/me')).status).toBe(200);
    const loginCsrf = await new Client(server.url, { Authorization: 'Bearer forged' }).post(
      '/api/auth/login',
      { identifier: 'stale.user', password: STRONG_PASSWORD },
      { Origin: 'http://evil.example' },
    );
    expect(loginCsrf.status).toBe(403);
    // the valid token still skips the origin check (it is not an ambient credential)
    expect((await admin.put('/api/knowledge/file', { path: 'h/t.md', content: '# t' }, { Origin: 'http://evil.example' })).status).toBe(200);
  });
});

/** A reverse proxy on the server computer with default nginx settings: Host rewritten to the upstream, no X-Forwarded-*. */
async function startNaiveProxy(upstreamPort: number): Promise<{ url: string; close(): Promise<void> }> {
  const proxy: Server = createServer((req, res) => {
    const headers = { ...req.headers, host: `127.0.0.1:${upstreamPort}`, connection: 'close' };
    const up = httpRequest({ host: '127.0.0.1', port: upstreamPort, method: req.method, path: req.url, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(up);
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`,
    close: () =>
      new Promise<void>((resolve) => {
        proxy.closeAllConnections();
        proxy.close(() => resolve());
      }),
  };
}

const SETUP = { username: 'attacker', email: 'attacker@solar.test', name: 'Attacker', password: STRONG_PASSWORD };

describe('first-superadmin setup behind a same-host reverse proxy', () => {
  const variants: Array<{ label: string; env: Record<string, string> }> = [
    { label: 'with SOLAR_ACCESS_TOKEN', env: { SOLAR_ACCESS_TOKEN: TEST_ACCESS_TOKEN } },
    { label: 'local-only (no token)', env: {} },
  ];
  for (const variant of variants) {
    it(`cannot be claimed through the proxy without the setup code (${variant.label})`, async () => {
      const server = await startAuthServer({ config: authTestConfig(variant.env) });
      const proxy = await startNaiveProxy(server.port);
      try {
        const outsider = new Client(proxy.url);
        expect((await outsider.get<AuthState>('/api/auth/state')).body.setupRequired).toBe(true);
        const claim = await outsider.post<AuthMe & { code?: string }>('/api/auth/setup', SETUP);
        expect(claim.status).toBe(403);
        expect(claim.setCookies).toHaveLength(0);
        expect((await outsider.get<AuthState>('/api/auth/state')).body.setupRequired).toBe(true);
      } finally {
        await proxy.close();
        await server.close();
      }
    });
  }
});

describe('the one-time setup code', () => {
  it('is written to DATA_DIR/setup-code.txt (0600), required from this computer, used up by the setup', async () => {
    const server = await startAuthServer({ config: authTestConfig({ SOLAR_ACCESS_TOKEN: TEST_ACCESS_TOKEN }) });
    const proxy = await startNaiveProxy(server.port);
    const file = join(server.config.dataDir, 'setup-code.txt');
    try {
      const code = server.setupCode()!;
      expect(readFileSync(file, 'utf8').trim()).toBe(code);
      if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);

      const local = new Client(server.url);
      expect((await local.get<AuthState>('/api/auth/state')).body).toMatchObject({ setupRequired: true, setupCodeRequired: true });
      // the token holder needs no code
      expect((await tokenClient(server.url).get<AuthState>('/api/auth/state')).body).toMatchObject({ setupRequired: true, setupCodeRequired: false });

      // from this computer: no code / a wrong code -> 403 setup_code_invalid, localized
      const missing = await local.post('/api/auth/setup', SETUP);
      expect(missing.status).toBe(403);
      expect(missing.body.code).toBe('setup_code_invalid');
      const wrong = await local.post('/api/auth/setup', { ...SETUP, setupCode: 'AAAA-BBBB-CCCC-DDDD' }, { 'Accept-Language': 'en' });
      expect(wrong.status).toBe(403);
      expect(wrong.body).toMatchObject({ code: 'setup_code_invalid', error: expect.stringContaining('setup code') });
      // through the proxy: the same (looking local is not enough)
      expect((await new Client(proxy.url).post('/api/auth/setup', { ...SETUP, setupCode: 'AAAA-BBBB-CCCC-DDDD' })).status).toBe(403);
      // from the network (not loopback): refused before the code matters
      expect((await local.post('/api/auth/setup', { ...SETUP, setupCode: code }, { 'X-Forwarded-For': '203.0.113.5' })).body.code).toBe('setup_forbidden');

      // the operator types the code (any case, spaces / dashes ignored); a stale token in the browser does not matter
      const typed = ` ${code.toLowerCase().replace(/-/g, ' ')} `;
      const ok = await new Client(server.url, { Authorization: 'Bearer stale-token' }).post<AuthMe>('/api/auth/setup', {
        username: 'owner',
        email: 'owner@solar.test',
        name: 'Owner',
        password: STRONG_PASSWORD,
        setupCode: typed,
      });
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({ role: 'superadmin', via: 'session' });
      expect(server.setupCode()).toBeNull();
      expect(existsSync(file)).toBe(false);
      expect((await local.post('/api/auth/setup', { ...SETUP, setupCode: code })).status).toBe(409);
      expect((await local.get<AuthState>('/api/auth/state')).body).toMatchObject({ setupRequired: false, setupCodeRequired: false });
    } finally {
      await proxy.close();
      await server.close();
    }
  });

  it('SOLAR_ACCESS_TOKEN sets up without a code (also through a proxy); a new code is issued per start', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'solar-setup-code-'));
    const first = await startAuthServer({ config: authTestConfig({ SOLAR_ACCESS_TOKEN: TEST_ACCESS_TOKEN }, dataDir) });
    const code1 = first.setupCode();
    await first.close();
    const server = await startAuthServer({ config: authTestConfig({ SOLAR_ACCESS_TOKEN: TEST_ACCESS_TOKEN }, dataDir) });
    const proxy = await startNaiveProxy(server.port);
    try {
      expect(server.setupCode()).not.toBe(code1);
      // the code of the previous run is no longer valid
      expect((await new Client(server.url).post('/api/auth/setup', { ...SETUP, setupCode: code1 })).body.code).toBe('setup_code_invalid');
      const res = await new Client(proxy.url, { Authorization: `Bearer ${TEST_ACCESS_TOKEN}` }).post<AuthMe>('/api/auth/setup', { ...SETUP, username: 'ops' });
      expect(res.status).toBe(201);
      expect(existsSync(join(dataDir, 'setup-code.txt'))).toBe(false);
    } finally {
      await proxy.close();
      await server.close();
    }
  });

  it('is not issued (and a stale file is removed) when accounts exist', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'solar-setup-code-'));
    writeFileSync(join(dataDir, 'setup-code.txt'), 'OLD0-OLD0-OLD0-OLD0\n');
    const server = await startAuthServer({ config: authTestConfig(ROOT, dataDir) });
    try {
      expect(server.setupCode()).toBeNull();
      expect(existsSync(join(dataDir, 'setup-code.txt'))).toBe(false);
    } finally {
      await server.close();
    }
  });
});

describe('password hashing is capped process-wide (a login flood cannot fill the thread pool)', () => {
  it('ConcurrencyGate runs at most `concurrency` at once, queues `maxQueue`, refuses the rest', async () => {
    const gate = new ConcurrencyGate(2, 3);
    let running = 0;
    let peak = 0;
    const op = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 20));
      running -= 1;
      return 'done';
    };
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => gate.run(op)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    expect(results.filter((r) => r.status === 'rejected').every((r) => (r as PromiseRejectedResult).reason instanceof HashBusyError)).toBe(true);
    expect(peak).toBe(2);
    expect(gate.load).toEqual({ active: 0, waiting: 0 });
    // a failing operation frees its slot too
    await expect(gate.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(gate.load).toEqual({ active: 0, waiting: 0 });
    expect(DEFAULT_HASH_LIMITS.concurrency).toBeGreaterThanOrEqual(1);
  });

  it('answers 503 busy + Retry-After when saturated, without using up the rate limits of the refused attempts', async () => {
    // the production scrypt cost, so parallel checks really overlap
    const server = await startAuthServer({
      config: authTestConfig({ ...ROOT, TRUST_PROXY: '1', SOLAR_ACCESS_TOKEN: TEST_ACCESS_TOKEN }),
      auth: { scrypt: DEFAULT_SCRYPT },
    });
    const restore = setHashLimits({ concurrency: 1, maxQueue: 0 });
    try {
      const ip = '203.0.113.77';
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => new Client(server.url, { 'X-Forwarded-For': ip }).login(`flood.${i}`, 'wrong guess xxxx')));
      const counts = tally(results.map((r) => r.status));
      expect(counts[503] ?? 0).toBeGreaterThan(0);
      expect((counts[401] ?? 0) + (counts[503] ?? 0)).toBe(8);
      const busy = results.find((r) => r.status === 503)!;
      expect(busy.body.code).toBe('busy');
      expect(Number(busy.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(hashLoad()).toEqual({ active: 0, waiting: 0 });
      restore();
      // only the attempts whose password was checked count: exactly 10 - (401s of the flood) more failures are allowed
      const left = 10 - (counts[401] ?? 0);
      for (let i = 0; i < left; i++) expect((await new Client(server.url, { 'X-Forwarded-For': ip }).login(`after.${i}`, 'wrong guess xxxx')).status).toBe(401);
      expect((await new Client(server.url, { 'X-Forwarded-For': ip }).login('root')).status).toBe(429);
    } finally {
      restore();
      await server.close();
    }
  });
});

describe('RateLimiter.consume / refund', () => {
  it('counts in the same step as the check, and gives one attempt back', () => {
    let now = 1_000_000;
    const rl = new RateLimiter({ limit: 3, windowMs: 60_000, now: () => now });
    expect([rl.consume('k'), rl.consume('k'), rl.consume('k')].every((s) => !s.blocked)).toBe(true);
    const blocked = rl.consume('k');
    expect(blocked).toEqual({ blocked: true, retryAfterSeconds: 60 });
    // a blocked attempt is not counted: one refund frees exactly one slot
    rl.refund('k');
    expect(rl.consume('k').blocked).toBe(false);
    expect(rl.consume('k').blocked).toBe(true);
    // refunds never go below zero and drop empty keys
    rl.refund('k');
    rl.refund('k');
    rl.refund('k');
    rl.refund('k');
    expect(rl.size).toBe(0);
    rl.refund('unknown');
    now += 61_000;
    expect(rl.check('k').blocked).toBe(false);
  });
});
