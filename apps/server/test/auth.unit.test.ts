import { describe, expect, it } from 'vitest';
import { assignableRoles, can, canActOnUser, PERMISSIONS, ROLE_PERMISSIONS, type Permission, type Role } from '@solar/shared';
import { isValidEmail, isValidName, isValidUsername, normalizeEmail, normalizeUsername } from '../src/auth/identity.js';
import {
  DEFAULT_SCRYPT,
  hashPassword,
  normalizePassword,
  passwordProblem,
  verifyDummy,
  verifyPassword,
} from '../src/auth/password.js';
import { RateLimiter } from '../src/auth/rateLimit.js';
import { streamVisible } from '../src/routes/api.js';
import type { Principal } from '../src/auth/authService.js';

describe('password hashing (scrypt)', () => {
  it('stores N, r, p, a 16-byte salt and a 64-byte key, and verifies only the right password', async () => {
    const hash = await hashPassword('correct horse battery');
    const [scheme, N, r, p, salt, key] = hash.split('$');
    expect(scheme).toBe('scrypt');
    expect([Number(N), Number(r), Number(p)]).toEqual([2 ** 15, 8, 1]);
    expect(Buffer.from(salt!, 'base64url')).toHaveLength(16);
    expect(Buffer.from(key!, 'base64url')).toHaveLength(64);
    expect(await verifyPassword('correct horse battery', hash)).toEqual({ ok: true, needsRehash: false });
    expect((await verifyPassword('correct horse batterY', hash)).ok).toBe(false);
    // a new salt every time
    expect(await hashPassword('correct horse battery')).not.toBe(hash);
  });

  it('reports older parameters for an upgrade (the login stores a new hash)', async () => {
    const old = await hashPassword('correct horse battery', { N: 2 ** 12, r: 8, p: 1 });
    expect(old.startsWith('scrypt$4096$8$1$')).toBe(true);
    expect(await verifyPassword('correct horse battery', old, DEFAULT_SCRYPT)).toEqual({ ok: true, needsRehash: true });
    expect(await verifyPassword('wrong password here', old, DEFAULT_SCRYPT)).toEqual({ ok: false, needsRehash: true });
  });

  it('never matches a malformed or absurd hash (and does not throw)', async () => {
    for (const bad of ['', 'plain', 'scrypt$x$8$1$aa$bb', 'scrypt$3$8$1$c2FsdHNhbHQ$a2V5a2V5a2V5a2V5a2V5', 'scrypt$1048576$64$1$c2FsdHNhbHQ$a2V5a2V5a2V5a2V5a2V5', 'bcrypt$...']) {
      expect((await verifyPassword('whatever password', bad, { N: 2 ** 10, r: 8, p: 1 })).ok, bad).toBe(false);
    }
  });

  it('compares the NFKC form, so the same characters typed differently match', async () => {
    const composed = 'Kata sandi caf\u00e9 2026';
    const decomposed = 'Kata sandi cafe\u0301 2026';
    expect(composed).not.toBe(decomposed);
    expect(normalizePassword(composed)).toBe(normalizePassword(decomposed));
    const hash = await hashPassword(composed, { N: 2 ** 10, r: 8, p: 1 });
    expect((await verifyPassword(decomposed, hash, { N: 2 ** 10, r: 8, p: 1 })).ok).toBe(true);
  });

  it('runs a real scrypt for unknown accounts (dummy verify takes about as long as a real one)', async () => {
    const params = DEFAULT_SCRYPT;
    const hash = await hashPassword('correct horse battery', params);
    await verifyDummy('warm up the dummy hash', params);
    const time = async (fn: () => Promise<unknown>) => {
      const started = process.hrtime.bigint();
      await fn();
      return Number(process.hrtime.bigint() - started) / 1e6;
    };
    const real: number[] = [];
    const dummy: number[] = [];
    for (let i = 0; i < 3; i++) {
      real.push(await time(() => verifyPassword('wrong password guess', hash, params)));
      dummy.push(await time(() => verifyDummy('wrong password guess', params)));
    }
    const median = (xs: number[]) => xs.sort((a, b) => a - b)[1]!;
    expect(await verifyDummy('anything at all', params)).toBe(false);
    // same order of magnitude: the dummy is a full scrypt with the same parameters, not a shortcut
    expect(median(dummy)).toBeGreaterThan(median(real) * 0.4);
    expect(median(dummy)).toBeLessThan(median(real) * 2.5);
  });
});

describe('password policy', () => {
  it('needs 10-128 characters, not only spaces, and not the username or email', () => {
    expect(passwordProblem('short')).toBe('too_short');
    expect(passwordProblem('x'.repeat(129))).toBe('too_long');
    expect(passwordProblem('x'.repeat(128))).toBeNull();
    expect(passwordProblem('          ')).toBe('blank');
    expect(passwordProblem('Budi.Santoso', { username: 'budi.santoso' })).toBe('same_as_identity');
    expect(passwordProblem('Budi@Solar.co.id', { email: 'budi@solar.co.id' })).toBe('same_as_identity');
    expect(passwordProblem('correct horse battery', { username: 'budi', email: 'budi@solar.co.id' })).toBeNull();
    // counted in characters, not UTF-16 units: 10 emoji are 10 characters
    expect(passwordProblem('😀'.repeat(9))).toBe('too_short');
    expect(passwordProblem('😀'.repeat(10))).toBeNull();
  });
});

describe('identifiers', () => {
  it('usernames: 3-32 of a-z 0-9 . _ -, stored in lower case', () => {
    expect(normalizeUsername('  Budi.Santoso ')).toBe('budi.santoso');
    for (const ok of ['abc', 'budi.santoso', 'it_head-01', 'a'.repeat(32)]) expect(isValidUsername(ok), ok).toBe(true);
    for (const bad of ['ab', 'a'.repeat(33), 'budi santoso', 'budi@solar', 'búdi', '']) expect(isValidUsername(bad), bad).toBe(false);
  });

  it('emails: validated and lower-cased', () => {
    expect(normalizeEmail(' Budi@Solar.CO.ID ')).toBe('budi@solar.co.id');
    for (const ok of ['budi@solar.co.id', 'b.s+tag@mail.example.com']) expect(isValidEmail(ok), ok).toBe(true);
    for (const bad of ['budi', 'budi@', '@solar.co.id', 'budi@solar', 'bu di@solar.co.id', 'budi@@solar.co.id', '.budi@solar.co.id']) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
  });

  it('display names: 1-80 characters without control or bidi-override characters', () => {
    expect(isValidName('Budi Santoso')).toBe(true);
    expect(isValidName('')).toBe(false);
    expect(isValidName('x'.repeat(81))).toBe(false);
    expect(isValidName('Budi\nSantoso')).toBe(false);
    expect(isValidName('Budi\u202eosotnaS')).toBe(false);
  });
});

describe('rate limiter', () => {
  it('blocks after `limit` hits in the window and says when to retry', () => {
    let now = 1_000_000;
    const limiter = new RateLimiter({ limit: 3, windowMs: 60_000, now: () => now });
    for (let i = 0; i < 3; i++) {
      expect(limiter.check('ip').blocked).toBe(false);
      limiter.hit('ip');
      now += 1000;
    }
    const state = limiter.check('ip');
    expect(state.blocked).toBe(true);
    expect(state.retryAfterSeconds).toBe(57);
    expect(limiter.check('other').blocked).toBe(false);
    now += 57_000;
    expect(limiter.check('ip').blocked).toBe(false);
    limiter.reset('ip');
    expect(limiter.size).toBe(0);
  });

  it('keeps a bounded number of keys', () => {
    const limiter = new RateLimiter({ limit: 5, windowMs: 60_000, maxKeys: 100 });
    for (let i = 0; i < 1000; i++) limiter.hit(`ip-${i}`);
    expect(limiter.size).toBeLessThanOrEqual(100);
    // the most recent keys are the ones kept
    limiter.hit('ip-999');
    expect(limiter.check('ip-999').blocked).toBe(false);
  });
});

describe('roles and permissions (shared table)', () => {
  const has = (role: Role) => PERMISSIONS.filter((p) => can(role, p));

  it('superadmin has everything; head of IT everything but user management and system settings; staff the agent, knowledge and skills', () => {
    expect(has('superadmin')).toEqual([...PERMISSIONS]);
    expect(has('head_of_it').sort()).toEqual(
      (['agent.use', 'tasks.all', 'users.view', 'users.approve', 'users.disable', 'knowledge.read', 'knowledge.write', 'skills.read', 'skills.manage'] as Permission[]).sort(),
    );
    expect(has('staff').sort()).toEqual((['agent.use', 'knowledge.read', 'knowledge.write', 'skills.read', 'skills.manage'] as Permission[]).sort());
    expect(ROLE_PERMISSIONS.staff).not.toContain('settings.manage');
    expect(can(undefined, 'agent.use')).toBe(false);
  });

  it('who may act on which account', () => {
    const sa = { id: 'usr_sa', role: 'superadmin' as Role };
    const head = { id: 'usr_head', role: 'head_of_it' as Role };
    const staff = { id: 'usr_staff', role: 'staff' as Role };
    const otherSa = { id: 'usr_sa2', role: 'superadmin' as Role };
    const otherHead = { id: 'usr_head2', role: 'head_of_it' as Role };
    const otherStaff = { id: 'usr_staff2', role: 'staff' as Role };
    for (const action of ['approve', 'disable', 'enable', 'role', 'rename', 'password', 'delete'] as const) {
      expect(canActOnUser(sa, otherSa, action), action).toBe(true);
      expect(canActOnUser(sa, otherStaff, action), action).toBe(true);
      expect(canActOnUser(staff, otherStaff, action), action).toBe(false);
      expect(canActOnUser(head, otherHead, action), action).toBe(false);
      expect(canActOnUser(head, otherSa, action), action).toBe(false);
    }
    expect(['approve', 'disable', 'enable'].every((a) => canActOnUser(head, otherStaff, a as 'approve'))).toBe(true);
    expect(['role', 'rename', 'password', 'delete'].some((a) => canActOnUser(head, otherStaff, a as 'role'))).toBe(false);
    // nobody changes their own role, status, password (admin reset) or deletes themselves
    for (const action of ['approve', 'disable', 'enable', 'role', 'password', 'delete'] as const) expect(canActOnUser(sa, sa, action), action).toBe(false);
    expect(assignableRoles('superadmin')).toEqual(['superadmin', 'head_of_it', 'staff']);
    expect(assignableRoles('head_of_it')).toEqual(['staff']);
    expect(assignableRoles('staff')).toEqual([]);
  });

  it('stream messages reach the task owner, every-task roles, and permission holders only', () => {
    const p = (id: string, role: Role): Principal => ({ kind: 'user', id, role, user: null, sessionHash: 'h' });
    const own = { kind: 'task' as const, ownerId: 'usr_a' };
    const legacy = { kind: 'task' as const, ownerId: null };
    expect(streamVisible(p('usr_a', 'staff'), own)).toBe(true);
    expect(streamVisible(p('usr_b', 'staff'), own)).toBe(false);
    expect(streamVisible(p('usr_b', 'head_of_it'), own)).toBe(true);
    expect(streamVisible(p('usr_a', 'staff'), legacy)).toBe(false);
    expect(streamVisible(p('usr_x', 'superadmin'), legacy)).toBe(true);
    expect(streamVisible(p('usr_a', 'staff'), { kind: 'permission', permission: 'users.view' })).toBe(false);
    expect(streamVisible(p('usr_h', 'head_of_it'), { kind: 'permission', permission: 'users.view' })).toBe(true);
    expect(streamVisible(p('usr_a', 'staff'), undefined)).toBe(true);
  });
});
