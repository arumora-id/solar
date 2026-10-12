import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ACCESS_TOKEN_PRINCIPAL_ID,
  assignableRoles,
  can,
  canActOnUser,
  permissionsOf,
  type AuthErrorCode,
  type AuthMe,
  type Role,
  type TaskOwner,
  type User,
  type UserAction,
  type UserStatus,
} from '@solar/shared';
import type { AppConfig } from '../config.js';
import { both, LocalizedError, t, type Lang, type Localized, type MessageArgs, type MessageKey } from '../i18n.js';
import { createLogger } from '../logger.js';
import type { Repository, StoredSession, StoredUser, UserPatch } from '../storage/repository.js';
import type { EventBus } from '../tasks/eventBus.js';
import { KeyedQueue, writeFileAtomic } from '../util/fs.js';
import { newId } from '../util/ids.js';
import { isValidEmail, isValidName, isValidUsername, normalizeEmail, normalizeIdentifier, normalizeName, normalizeUsername } from './identity.js';
import {
  DEFAULT_SCRYPT,
  HashBusyError,
  hashPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordProblem,
  verifyDummy,
  verifyPassword,
  type ScryptParams,
} from './password.js';
import { RateLimiter } from './rateLimit.js';

const log = createLogger('auth');

/** Who makes a request: a logged-in account, or SOLAR_ACCESS_TOKEN acting as a superadmin. */
export interface Principal {
  kind: 'user' | 'token';
  /** The user id, or ACCESS_TOKEN_PRINCIPAL_ID. */
  id: string;
  role: Role;
  /** The account (public shape), null for the access token. */
  user: User | null;
  /** SHA-256 of the session token the request came with (null for the access token). */
  sessionHash: string | null;
}

/** The requester of a task as the agent and the tools see it. */
export interface Requester {
  id: string;
  name: string;
  role: Role;
}

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

/** An auth failure: HTTP status, stable code, message in both languages, optional Retry-After. */
export class AuthError extends LocalizedError {
  constructor(
    readonly status: number,
    readonly code: AuthErrorCode,
    text: Localized,
    readonly retryAfterSeconds?: number,
  ) {
    super(text, 'en');
  }
}

function fail<K extends MessageKey>(status: number, code: AuthError['code'], key: K, ...args: MessageArgs<K>): AuthError {
  return new AuthError(status, code, both(key, ...args));
}

function rateLimited(retryAfterSeconds: number): AuthError {
  return new AuthError(429, 'rate_limited', both('auth.rateLimited', { minutes: Math.max(1, Math.ceil(retryAfterSeconds / 60)) }), retryAfterSeconds);
}

/** Seconds a client is asked to wait when password hashing is saturated. */
const BUSY_RETRY_SECONDS = 5;

/**
 * HashBusyError (too many password hashes at once, see password.ts) as the 503 answer; any other error unchanged.
 * Applied to every auth route's error (authHttpError), so logins, registrations, setup and administrators' password
 * operations all answer 503 + Retry-After under a flood.
 */
export function busyAsAuthError(err: unknown): unknown {
  return err instanceof HashBusyError ? new AuthError(503, 'busy', both('auth.busy'), BUSY_RETRY_SECONDS) : err;
}

export const SESSION_COOKIE = 'solar_session';
const TOKEN_BYTES = 32;
/** base64url of 32 bytes. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** File in DATA_DIR holding the one-time first-superadmin setup code while no account exists (mode 0600). */
export const SETUP_CODE_FILE = 'setup-code.txt';
/** 32 symbols without 0/O/1/I (easy to read off a console): 16 of them = 80 random bits, shown as XXXX-XXXX-XXXX-XXXX. */
const SETUP_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const SETUP_CODE_LENGTH = 16;

function normalizeSetupCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '');
}

/** How long a session or account read from storage is reused (every change made through this server invalidates it). */
const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 5_000;
const CLEANUP_INTERVAL_MS = 3_600_000;

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  // compare digests: equal length, so timingSafeEqual never throws and the length of the secret does not leak
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

/** The API shape of an account (without its password hash). */
export function publicUser(u: StoredUser): User {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    lastLoginAt: u.lastLoginAt,
    approvedAt: u.approvedAt,
    approvedBy: u.approvedBy,
  };
}

export interface AuthLimits {
  /** Failed logins per client address and per identifier in the window. */
  loginFailures: number;
  loginWindowMs: number;
  /** Registrations per client address in the window. */
  registrations: number;
  registrationWindowMs: number;
  /** Setup attempts per client address in the window. */
  setupAttempts: number;
  setupWindowMs: number;
  /** Wrong current passwords per account in the window. */
  passwordFailures: number;
  passwordWindowMs: number;
}

export const DEFAULT_LIMITS: AuthLimits = {
  loginFailures: 10,
  loginWindowMs: 15 * 60_000,
  registrations: 5,
  registrationWindowMs: 60 * 60_000,
  setupAttempts: 10,
  setupWindowMs: 15 * 60_000,
  passwordFailures: 10,
  passwordWindowMs: 15 * 60_000,
};

export interface AuthServiceOptions {
  /** scrypt parameters for new hashes (tests may lower them; production uses the default). */
  scrypt?: ScryptParams;
  limits?: Partial<AuthLimits>;
  now?: () => number;
}

export interface NewAccount {
  username: string;
  email: string;
  name: string;
  password: string;
}

interface Cached<T> {
  value: T;
  at: number;
}

/** A session revocation: the token hashes that are no longer valid (open event streams of them close). */
export interface Revocation {
  userId: string;
  tokenHashes: string[];
}

/**
 * Accounts, login sessions and the rules of who may change which account.
 *
 * Every account change goes through one in-process lock: the last-superadmin guard and the uniqueness checks cannot
 * be raced by concurrent requests. SOLAR runs as one server process (its task queue, approvals and event stream live in
 * memory), so the session/account cache below is invalidated by every change that can affect it.
 */
export class AuthService {
  private readonly scryptParams: ScryptParams;
  private readonly limits: AuthLimits;
  private readonly now: () => number;
  private readonly loginByIp: RateLimiter;
  private readonly loginById: RateLimiter;
  private readonly registerByIp: RateLimiter;
  private readonly setupByIp: RateLimiter;
  private readonly passwordByUser: RateLimiter;
  private readonly lock = new KeyedQueue();
  private readonly sessions = new Map<string, Cached<StoredSession>>();
  private readonly users = new Map<string, Cached<StoredUser | null>>();
  private readonly events = new EventEmitter();
  /**
   * Bumped by every revocation and account change: a session or account read from storage before a bump is used for
   * that one request but never put in the cache, so a request that raced a revocation cannot revive the session.
   */
  private epoch = 0;
  private cleanupTimer: NodeJS.Timeout | null = null;
  /** The one-time first-superadmin setup code while no account exists (see setup()), else null. */
  private setupCodeValue: string | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly repo: Repository,
    private readonly bus: EventBus,
    options: AuthServiceOptions = {},
  ) {
    this.scryptParams = options.scrypt ?? DEFAULT_SCRYPT;
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.now = options.now ?? Date.now;
    const limiter = (limit: number, windowMs: number) => new RateLimiter({ limit, windowMs, now: this.now });
    this.loginByIp = limiter(this.limits.loginFailures, this.limits.loginWindowMs);
    this.loginById = limiter(this.limits.loginFailures, this.limits.loginWindowMs);
    this.registerByIp = limiter(this.limits.registrations, this.limits.registrationWindowMs);
    this.setupByIp = limiter(this.limits.setupAttempts, this.limits.setupWindowMs);
    this.passwordByUser = limiter(this.limits.passwordFailures, this.limits.passwordWindowMs);
    this.events.setMaxListeners(0);
  }

  /** Creates the first superadmin from SOLAR_ADMIN_* when there is no account yet; starts the session cleanup. */
  async init(): Promise<void> {
    const admin = this.config.auth.bootstrapAdmin;
    if (admin) {
      if ((await this.repo.countUsers()) > 0) {
        log.info('SOLAR_ADMIN_* ignored: user accounts already exist');
      } else {
        const account = this.validateAccount(admin);
        const created = await this.repo.createFirstUser(await this.newUser(account, 'superadmin', 'active', null));
        if (created) log.info(`Created the first superadmin "${account.username}" from SOLAR_ADMIN_USERNAME / SOLAR_ADMIN_EMAIL / SOLAR_ADMIN_PASSWORD`);
      }
    }
    if (await this.setupRequired()) await this.issueSetupCode();
    else await this.retireSetupCode();
    await this.cleanupSessions();
    this.cleanupTimer = setInterval(() => void this.cleanupSessions(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  close(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
    this.events.removeAllListeners();
  }

  private async cleanupSessions(): Promise<void> {
    try {
      const n = await this.repo.deleteExpiredSessions(new Date(this.now()).toISOString());
      if (n) log.info(`Removed ${n} expired login session(s)`);
    } catch (err) {
      log.warn(`Session cleanup failed: ${String(err)}`);
    }
  }

  /** Called with every revocation of sessions (event streams of those sessions close). */
  onRevoked(listener: (revocation: Revocation) => void): () => void {
    this.events.on('revoked', listener);
    return () => this.events.off('revoked', listener);
  }

  // ---- first-superadmin setup code -----------------------------------------------------------------------------------

  /**
   * The one-time code the first-superadmin setup asks for (null once an account exists). Only the operator sees it: it
   * is printed in the server log at startup and stored in DATA_DIR/setup-code.txt (mode 0600); the desktop shell can
   * read it from the running server. It is what makes "this request comes from the server computer" trustworthy: a
   * reverse proxy on the same computer makes every outside request look local (loopback peer, Host rewritten to
   * 127.0.0.1, no forwarding headers), so being local alone must not be enough to claim a fresh server.
   */
  setupCode(): string | null {
    return this.setupCodeValue;
  }

  /** Where the setup code is stored while no account exists. */
  setupCodeFile(): string {
    return join(this.config.dataDir, SETUP_CODE_FILE);
  }

  private async issueSetupCode(): Promise<void> {
    const symbols = Array.from({ length: SETUP_CODE_LENGTH }, () => SETUP_CODE_ALPHABET[randomInt(SETUP_CODE_ALPHABET.length)]!);
    const code = [0, 4, 8, 12].map((i) => symbols.slice(i, i + 4).join('')).join('-');
    this.setupCodeValue = code;
    const file = this.setupCodeFile();
    try {
      await writeFileAtomic(file, `${code}\n`, { mode: 0o600 });
      log.warn(`First-superadmin setup code: ${code} (also in ${file}; valid until the first account exists)`);
    } catch (err) {
      log.warn(`First-superadmin setup code: ${code} (could not be written to ${file}: ${String(err)})`);
    }
  }

  private async retireSetupCode(): Promise<void> {
    this.setupCodeValue = null;
    await rm(this.setupCodeFile(), { force: true }).catch((err: unknown) => log.warn(`Could not remove ${this.setupCodeFile()}: ${String(err)}`));
  }

  private setupCodeMatches(input: string | undefined): boolean {
    const expected = this.setupCodeValue;
    if (!expected || !input) return false;
    return safeEqual(normalizeSetupCode(input), normalizeSetupCode(expected));
  }

  // ---- state --------------------------------------------------------------------------------------------------

  async setupRequired(): Promise<boolean> {
    return (await this.repo.countUsers()) === 0;
  }

  me(principal: Principal): AuthMe {
    return { user: principal.user, role: principal.role, permissions: permissionsOf(principal.role), via: principal.kind === 'token' ? 'token' : 'session' };
  }

  passwordPolicy(): { minLength: number; maxLength: number } {
    return { minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH };
  }

  // ---- principals -----------------------------------------------------------------------------------------------

  /** The access token's principal when `token` is SOLAR_ACCESS_TOKEN, else null. */
  tokenPrincipal(token: string): Principal | null {
    const expected = this.config.accessToken;
    if (!expected || !token || !safeEqual(token, expected)) return null;
    return { kind: 'token', id: ACCESS_TOKEN_PRINCIPAL_ID, role: 'superadmin', user: null, sessionHash: null };
  }

  /**
   * The principal of a session token (the cookie's value), or null when the token is unknown, expired, or its account
   * is not active (then the session is deleted). Renews the idle expiry at most every few minutes.
   */
  async sessionPrincipal(token: string): Promise<Principal | null> {
    if (!TOKEN_PATTERN.test(token)) return null;
    const epoch = this.epoch;
    const hash = sha256(token);
    const session = await this.session(hash);
    if (!session) return null;
    const now = this.now();
    if (Date.parse(session.expiresAt) <= now) {
      await this.dropSession(hash);
      return null;
    }
    const user = await this.user(session.userId);
    if (!user || user.status !== 'active') {
      await this.dropSession(hash);
      return null;
    }
    await this.touch(session, now, epoch);
    return { kind: 'user', id: user.id, role: user.role, user: publicUser(user), sessionHash: hash };
  }

  /** Whether a principal taken earlier (an open event stream) is still valid; false ends the stream. */
  async stillValid(principal: Principal): Promise<boolean> {
    if (principal.kind === 'token') return true;
    if (!principal.sessionHash) return false;
    const session = await this.session(principal.sessionHash);
    if (!session || Date.parse(session.expiresAt) <= this.now()) return false;
    const user = await this.user(session.userId);
    return Boolean(user && user.status === 'active' && user.role === principal.role);
  }

  private async session(hash: string): Promise<StoredSession | null> {
    const cached = this.sessions.get(hash);
    if (cached && this.now() - cached.at < CACHE_TTL_MS) return cached.value;
    const epoch = this.epoch;
    const session = await this.repo.getSession(hash);
    if (session) this.remember(this.sessions, hash, session, epoch);
    else this.sessions.delete(hash);
    return session;
  }

  private async user(id: string): Promise<StoredUser | null> {
    const cached = this.users.get(id);
    if (cached && this.now() - cached.at < CACHE_TTL_MS) return cached.value;
    const epoch = this.epoch;
    const user = await this.repo.getUser(id);
    this.remember(this.users, id, user, epoch);
    return user;
  }

  /** Caches a value read while the epoch was `epoch`, unless something was revoked or changed since. */
  private remember<T>(map: Map<string, Cached<T>>, key: string, value: T, epoch = this.epoch): void {
    if (epoch !== this.epoch) return;
    map.delete(key);
    map.set(key, { value, at: this.now() });
    if (map.size > CACHE_MAX) map.delete(map.keys().next().value!);
  }

  /** Sliding expiry: written at most every 5 minutes (or a tenth of the idle lifetime) per session. */
  private async touch(session: StoredSession, now: number, epoch: number): Promise<void> {
    const { sessionTtlMs, sessionMaxMs } = this.config.auth;
    const interval = Math.min(5 * 60_000, sessionTtlMs / 10);
    if (now - Date.parse(session.lastSeenAt) < interval) return;
    const expiresAt = new Date(Math.min(now + sessionTtlMs, Date.parse(session.createdAt) + sessionMaxMs)).toISOString();
    const lastSeenAt = new Date(now).toISOString();
    this.remember(this.sessions, session.tokenHash, { ...session, lastSeenAt, expiresAt }, epoch);
    try {
      // a session deleted meanwhile stays deleted (the update finds no row)
      await this.repo.touchSession(session.tokenHash, lastSeenAt, expiresAt);
    } catch (err) {
      log.warn(`Could not renew a session: ${String(err)}`);
    }
  }

  private async dropSession(hash: string): Promise<void> {
    this.epoch += 1;
    this.sessions.delete(hash);
    await this.repo.deleteSession(hash);
  }

  private invalidateUser(id: string): void {
    this.epoch += 1;
    this.users.delete(id);
  }

  /** Deletes every session of a user (except `exceptHash`) and tells open event streams. */
  private async revokeSessions(userId: string, exceptHash?: string): Promise<void> {
    this.epoch += 1;
    for (const [hash, cached] of this.sessions) if (cached.value.userId === userId && hash !== exceptHash) this.sessions.delete(hash);
    const hashes = await this.repo.deleteUserSessions(userId, exceptHash);
    // and once more after the delete: a read that started before it must not be cached either
    this.epoch += 1;
    for (const [hash, cached] of this.sessions) if (cached.value.userId === userId && hash !== exceptHash) this.sessions.delete(hash);
    this.events.emit('revoked', { userId, tokenHashes: hashes } satisfies Revocation);
  }

  // ---- registration, login, logout ---------------------------------------------------------------------------------

  /** Checks and normalises a new account's fields; throws AuthError 400 with the first problem. */
  private validateAccount(input: NewAccount): NewAccount {
    const username = normalizeUsername(input.username);
    const email = normalizeEmail(input.email);
    const name = normalizeName(input.name);
    if (!isValidUsername(username)) throw fail(400, 'invalid_input', 'auth.username.invalid');
    if (!isValidEmail(email)) throw fail(400, 'invalid_input', 'auth.email.invalid');
    if (!isValidName(name)) throw fail(400, 'invalid_input', 'auth.name.invalid');
    this.checkPassword(input.password, { username, email });
    return { username, email, name, password: input.password };
  }

  private checkPassword(password: string, identity: { username?: string; email?: string }): void {
    const problem = passwordProblem(password, identity);
    if (problem === 'too_short') throw fail(400, 'weak_password', 'auth.password.tooShort', { min: PASSWORD_MIN_LENGTH });
    if (problem === 'too_long') throw fail(400, 'weak_password', 'auth.password.tooLong', { max: PASSWORD_MAX_LENGTH });
    if (problem === 'blank') throw fail(400, 'weak_password', 'auth.password.blank');
    if (problem === 'same_as_identity') throw fail(400, 'weak_password', 'auth.password.sameAsIdentity');
  }

  private async newUser(account: NewAccount, role: Role, status: UserStatus, approvedBy: string | null): Promise<StoredUser> {
    const now = new Date(this.now()).toISOString();
    return {
      id: newId('usr'),
      username: account.username,
      email: account.email,
      name: account.name,
      role,
      status,
      passwordHash: await hashPassword(account.password, this.scryptParams),
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
      approvedAt: status === 'active' ? now : null,
      approvedBy: status === 'active' ? approvedBy : null,
    };
  }

  /** Taken username / email -> AuthError 409 (checked before hashing, and again atomically when storing). */
  private async assertAvailable(account: NewAccount): Promise<void> {
    if (await this.repo.findUserByUsername(account.username)) throw fail(409, 'username_taken', 'auth.usernameTaken', { username: account.username });
    if (await this.repo.findUserByEmail(account.email)) throw fail(409, 'email_taken', 'auth.emailTaken');
  }

  private async store(user: StoredUser): Promise<void> {
    const result = await this.repo.createUser(user);
    if (result === 'username-taken') throw fail(409, 'username_taken', 'auth.usernameTaken', { username: user.username });
    if (result === 'email-taken') throw fail(409, 'email_taken', 'auth.emailTaken');
  }

  /**
   * Self-registration: the account is created as `pending` staff and cannot log in until a superadmin or the Head of IT
   * approves it. Never logs in. Closed while no account exists (the first account is the superadmin of the setup).
   */
  async register(input: NewAccount, meta: RequestMeta): Promise<User> {
    const ipKey = meta.ip ?? 'unknown';
    const limit = this.registerByIp.check(ipKey);
    if (limit.blocked) throw rateLimited(limit.retryAfterSeconds);
    const account = this.validateAccount(input);
    // counted once the request is well-formed: every counted registration costs a password hash
    this.registerByIp.hit(ipKey);
    if (await this.setupRequired()) throw fail(409, 'registration_closed', 'auth.registrationClosed');
    await this.assertAvailable(account);
    let user: StoredUser;
    try {
      user = await this.newUser(account, 'staff', 'pending', null);
    } catch (err) {
      // refused for load before any hashing happened: does not use up the address's registrations
      if (err instanceof HashBusyError) this.registerByIp.refund(ipKey);
      throw err;
    }
    await this.store(user);
    log.info(`New registration "${user.username}" (${user.id}) is waiting for approval`);
    await this.announceUsers();
    return publicUser(user);
  }

  /**
   * Checks a username/email and password and opens a session. Failures count per client address and per account (or
   * per identifier typed, for unknown ones); an unknown identifier costs the same time as a wrong password. A pending or
   * disabled account is told so only after the password was proven.
   *
   * Every attempt is counted BEFORE its password check, in the same synchronous step as the limit check (`consume`):
   * attempts sent in parallel cannot all pass the check while the earlier ones are still hashing, so at most `limit`
   * passwords are checked per address and per account in a window, however the attempts are timed. An attempt that
   * proves the password, or that never got to check one (blocked, server busy), is given back.
   */
  async login(identifier: string, password: string, meta: RequestMeta): Promise<{ principal: Principal; token: string; maxAgeSeconds: number }> {
    const id = normalizeIdentifier(identifier);
    const ipKey = meta.ip ?? 'unknown';
    const byIp = this.loginByIp.consume(ipKey);
    if (byIp.blocked) throw rateLimited(byIp.retryAfterSeconds);
    /** The account key counted for this attempt (null: not counted). */
    let idKey: string | null = null;
    /** A password was checked and was wrong: the attempt stays counted. */
    let failed = false;
    try {
      const user = id.includes('@') ? await this.repo.findUserByEmail(id) : await this.repo.findUserByUsername(id);
      // per account (username and email count together), else per identifier typed; check and count without an
      // await in between (the account is only known after the lookup)
      const key = user ? `user:${user.id}` : `id:${id}`;
      const byId = this.loginById.consume(key);
      if (byId.blocked) throw rateLimited(byId.retryAfterSeconds);
      idKey = key;

      const result = user ? await verifyPassword(password, user.passwordHash, this.scryptParams) : { ok: await verifyDummy(password, this.scryptParams), needsRehash: false };
      if (!user || !result.ok) {
        failed = true;
        throw fail(401, 'invalid_credentials', 'auth.invalidCredentials');
      }
      // the password is proven: this was no guess, and earlier failures of the account are forgotten
      this.loginById.reset(key);
      idKey = null;
      if (user.status === 'pending') throw fail(403, 'account_pending', 'auth.accountPending');
      if (user.status !== 'active') throw fail(403, 'account_disabled', 'auth.accountDisabled');

      const patch: UserPatch = { lastLoginAt: new Date(this.now()).toISOString() };
      if (result.needsRehash) {
        try {
          patch.passwordHash = await hashPassword(password, this.scryptParams);
        } catch (err) {
          // the upgrade waits for a later login when hashing is saturated; the login itself succeeds
          if (!(err instanceof HashBusyError)) throw err;
        }
      }
      const updated = (await this.repo.updateUser(user.id, patch)) ?? user;
      this.invalidateUser(user.id);
      return await this.openSession(updated, meta);
    } finally {
      if (!failed) {
        this.loginByIp.refund(ipKey);
        if (idKey) this.loginById.refund(idKey);
      }
    }
  }

  private async openSession(user: StoredUser, meta: RequestMeta): Promise<{ principal: Principal; token: string; maxAgeSeconds: number }> {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const hash = sha256(token);
    const now = this.now();
    const { sessionTtlMs, sessionMaxMs } = this.config.auth;
    const session: StoredSession = {
      tokenHash: hash,
      userId: user.id,
      createdAt: new Date(now).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
      expiresAt: new Date(now + Math.min(sessionTtlMs, sessionMaxMs)).toISOString(),
      userAgent: meta.userAgent ? meta.userAgent.slice(0, 300) : null,
      ip: meta.ip,
    };
    await this.repo.createSession(session);
    this.remember(this.sessions, hash, session);
    return {
      principal: { kind: 'user', id: user.id, role: user.role, user: publicUser(user), sessionHash: hash },
      token,
      // the cookie lives as long as the session may (the server enforces the idle expiry)
      maxAgeSeconds: Math.floor(sessionMaxMs / 1000),
    };
  }

  async logout(principal: Principal | null): Promise<void> {
    if (!principal?.sessionHash) return;
    await this.dropSession(principal.sessionHash);
    this.events.emit('revoked', { userId: principal.id, tokenHashes: [principal.sessionHash] } satisfies Revocation);
  }

  /**
   * Changes one's own password (proving the current one) and ends one's other sessions. Like the login, the attempt
   * is counted before the current password is checked (parallel guesses cannot pass the limit) and given back when it
   * was no wrong guess.
   */
  async changeOwnPassword(principal: Principal, currentPassword: string, newPassword: string): Promise<void> {
    if (principal.kind !== 'user') throw fail(400, 'forbidden', 'auth.sessionOnly');
    const limit = this.passwordByUser.consume(principal.id);
    if (limit.blocked) throw rateLimited(limit.retryAfterSeconds);
    let failed = false;
    try {
      const user = await this.repo.getUser(principal.id);
      if (!user) throw fail(401, 'unauthenticated', 'auth.unauthenticated');
      const result = await verifyPassword(currentPassword, user.passwordHash, this.scryptParams);
      if (!result.ok) {
        failed = true;
        throw fail(400, 'wrong_password', 'auth.wrongPassword');
      }
      this.checkPassword(newPassword, { username: user.username, email: user.email });
      const passwordHash = await hashPassword(newPassword, this.scryptParams);
      await this.repo.updateUser(user.id, { passwordHash, updatedAt: new Date(this.now()).toISOString() });
      this.invalidateUser(user.id);
      this.passwordByUser.reset(principal.id);
      await this.revokeSessions(user.id, principal.sessionHash ?? undefined);
    } finally {
      if (!failed) this.passwordByUser.refund(principal.id);
    }
  }

  /**
   * Creates the first superadmin and logs it in. Only while no account exists, and only for
   *  - a request carrying SOLAR_ACCESS_TOKEN (an operator secret), or
   *  - a request made on the server computer itself (`fromLoopback`, see isLoopbackRequest) that also carries the
   *    one-time setup code (setupCode()): a fresh server reachable over the network - directly, or through a reverse
   *    proxy on the same computer, which makes outside requests look local - must not be claimable by whoever finds it
   *    first.
   * Concurrent setups: exactly one wins (the repository creates the first account atomically), the others get 409.
   */
  async setup(
    input: NewAccount,
    principal: Principal | null,
    fromLoopback: boolean,
    meta: RequestMeta,
    setupCode?: string,
  ): Promise<{ principal: Principal; token: string; maxAgeSeconds: number }> {
    const ipKey = meta.ip ?? 'unknown';
    const limit = this.setupByIp.consume(ipKey);
    if (limit.blocked) throw rateLimited(limit.retryAfterSeconds);
    const viaToken = principal?.kind === 'token';
    if (!viaToken && !fromLoopback) throw fail(403, 'setup_forbidden', 'auth.setupForbidden');
    if (!(await this.setupRequired())) throw fail(409, 'setup_not_available', 'auth.setupDone');
    if (!viaToken && !this.setupCodeMatches(setupCode)) {
      // every account vanished while the server ran (e.g. a reset database): issue a code for the operator
      if (!this.setupCodeValue) await this.issueSetupCode();
      throw fail(403, 'setup_code_invalid', 'auth.setupCodeInvalid');
    }
    const account = this.validateAccount(input);
    const user = await this.newUser(account, 'superadmin', 'active', viaToken ? ACCESS_TOKEN_PRINCIPAL_ID : null);
    if (!(await this.repo.createFirstUser(user))) throw fail(409, 'setup_not_available', 'auth.setupDone');
    log.info(`Created the first superadmin "${user.username}" (${user.id}) through the setup`);
    await this.retireSetupCode();
    const loggedIn = (await this.repo.updateUser(user.id, { lastLoginAt: new Date(this.now()).toISOString() })) ?? user;
    this.invalidateUser(user.id);
    return this.openSession(loggedIn, meta);
  }

  // ---- user administration -----------------------------------------------------------------------------------------

  /**
   * Runs an account change alone (no concurrent change can slip between its checks and its write), after confirming
   * that the acting account still has the role it was authenticated with: an administrator demoted or disabled while
   * the request was on its way cannot act with the old role.
   */
  private exclusive<T>(principal: Principal, op: () => Promise<T>): Promise<T> {
    return this.lock.run('users', async () => {
      if (principal.kind === 'user') {
        const actor = await this.repo.getUser(principal.id);
        if (!actor || actor.status !== 'active') throw fail(401, 'unauthenticated', 'auth.unauthenticated');
        if (actor.role !== principal.role) throw fail(403, 'forbidden', 'auth.forbidden');
      }
      return op();
    });
  }

  private require(principal: Principal, permission: Parameters<typeof can>[1]): void {
    if (!can(principal.role, permission)) throw fail(403, 'forbidden', 'auth.forbidden');
  }

  /** Refuses an action on an account by the role rules (canActOnUser), naming "own account" separately. */
  private assertMay(actor: Principal, target: StoredUser, action: UserAction): void {
    if (canActOnUser(actor, target, action)) return;
    if (actor.id === target.id) throw fail(403, 'self_action', 'users.selfAction');
    throw fail(403, 'forbidden', 'users.forbiddenTarget');
  }

  private assertAssignable(actor: Principal, role: Role): void {
    if (!assignableRoles(actor.role).includes(role)) throw fail(403, 'forbidden', 'users.forbiddenTarget');
  }

  /** At least one active superadmin must remain after `target` stops being one. */
  private async assertNotLastSuperadmin(target: StoredUser): Promise<void> {
    if (target.role !== 'superadmin' || target.status !== 'active') return;
    const active = await this.repo.countUsers({ role: 'superadmin', status: 'active' });
    if (active <= 1) throw fail(409, 'last_superadmin', 'users.lastSuperadmin');
  }

  private async target(id: string): Promise<StoredUser> {
    const user = await this.repo.getUser(id);
    if (!user) throw fail(404, 'user_not_found', 'users.notFound');
    return user;
  }

  async listUsers(principal: Principal, filter: { status?: UserStatus } = {}): Promise<User[]> {
    this.require(principal, 'users.view');
    return (await this.repo.listUsers(filter)).map(publicUser);
  }

  async getUserFor(principal: Principal, id: string): Promise<User> {
    this.require(principal, 'users.view');
    return publicUser(await this.target(id));
  }

  async pendingCount(principal: Principal): Promise<number> {
    this.require(principal, 'users.view');
    return this.repo.countUsers({ status: 'pending' });
  }

  /** A superadmin creates an active account directly. */
  async createUser(principal: Principal, input: NewAccount & { role: Role }): Promise<User> {
    this.require(principal, 'users.manage');
    this.assertAssignable(principal, input.role);
    const account = this.validateAccount(input);
    return this.exclusive(principal, async () => {
      await this.assertAvailable(account);
      const user = await this.newUser(account, input.role, 'active', principal.id);
      await this.store(user);
      log.info(`${principal.id} created the account "${user.username}" (${user.id}, ${user.role})`);
      await this.announceUsers();
      return publicUser(user);
    });
  }

  /**
   * Changes an account's role, status (active/disabled) or name by the role rules. Activating a pending account is
   * an approval. A role change, disabling and deleting end every session of the account.
   */
  async updateUser(principal: Principal, id: string, patch: { role?: Role; status?: 'active' | 'disabled'; name?: string }): Promise<User> {
    if (patch.role === undefined && patch.status === undefined && patch.name === undefined) return this.getUserFor(principal, id);
    const name = patch.name === undefined ? undefined : normalizeName(patch.name);
    if (name !== undefined && !isValidName(name)) throw fail(400, 'invalid_input', 'auth.name.invalid');
    return this.exclusive(principal, async () => {
      const target = await this.target(id);
      const changes: UserPatch = {};
      const nextRole = patch.role ?? target.role;
      if (patch.role !== undefined && patch.role !== target.role) {
        this.assertMay(principal, target, 'role');
        this.assertAssignable(principal, patch.role);
        changes.role = patch.role;
      }
      if (patch.status !== undefined && patch.status !== target.status) {
        if (patch.status === 'disabled') this.assertMay(principal, target, 'disable');
        else if (target.status === 'pending') {
          this.assertMay(principal, target, 'approve');
          this.assertAssignable(principal, nextRole);
          changes.approvedAt = new Date(this.now()).toISOString();
          changes.approvedBy = principal.id;
        } else this.assertMay(principal, target, 'enable');
        changes.status = patch.status;
      }
      if (name !== undefined && name !== target.name) {
        this.assertMay(principal, target, 'rename');
        changes.name = name;
      }
      if (Object.keys(changes).length === 0) return publicUser(target);
      const demoted = changes.role !== undefined && changes.role !== 'superadmin';
      const deactivated = changes.status !== undefined && changes.status !== 'active';
      if (demoted || deactivated) await this.assertNotLastSuperadmin(target);
      changes.updatedAt = new Date(this.now()).toISOString();
      const updated = await this.repo.updateUser(id, changes);
      if (!updated) throw fail(404, 'user_not_found', 'users.notFound');
      this.invalidateUser(id);
      if (changes.role !== undefined || changes.status === 'disabled') await this.revokeSessions(id);
      log.info(`${principal.id} changed the account ${id}: ${Object.keys(changes).filter((k) => k !== 'updatedAt').join(', ')}`);
      await this.announceUsers();
      return publicUser(updated);
    });
  }

  /** Approves a pending registration, as `role` (default staff; the Head of IT may only approve as staff). */
  async approve(principal: Principal, id: string, role: Role = 'staff'): Promise<User> {
    this.require(principal, 'users.approve');
    return this.exclusive(principal, async () => {
      const target = await this.target(id);
      if (target.status !== 'pending') throw fail(409, 'not_pending', 'users.notPending');
      this.assertMay(principal, target, 'approve');
      this.assertAssignable(principal, role);
      const now = new Date(this.now()).toISOString();
      const updated = await this.repo.updateUser(id, { status: 'active', role, approvedAt: now, approvedBy: principal.id, updatedAt: now });
      if (!updated) throw fail(404, 'user_not_found', 'users.notFound');
      this.invalidateUser(id);
      log.info(`${principal.id} approved the account "${target.username}" (${id}) as ${role}`);
      await this.announceUsers();
      return publicUser(updated);
    });
  }

  /** A superadmin sets a new password for another account; all its sessions end. */
  async resetPassword(principal: Principal, id: string, password: string): Promise<void> {
    this.require(principal, 'users.manage');
    await this.exclusive(principal, async () => {
      const target = await this.target(id);
      this.assertMay(principal, target, 'password');
      this.checkPassword(password, { username: target.username, email: target.email });
      const passwordHash = await hashPassword(password, this.scryptParams);
      await this.repo.updateUser(id, { passwordHash, updatedAt: new Date(this.now()).toISOString() });
      this.invalidateUser(id);
      await this.revokeSessions(id);
      log.info(`${principal.id} reset the password of ${id}`);
    });
  }

  /** A superadmin deletes an account; its tasks keep their ownerId (shown as a deleted user). */
  async deleteUser(principal: Principal, id: string): Promise<void> {
    this.require(principal, 'users.manage');
    await this.exclusive(principal, async () => {
      const target = await this.target(id);
      this.assertMay(principal, target, 'delete');
      await this.assertNotLastSuperadmin(target);
      await this.revokeSessions(id);
      await this.repo.deleteUser(id);
      this.invalidateUser(id);
      log.info(`${principal.id} deleted the account "${target.username}" (${id})`);
      await this.announceUsers();
    });
  }

  /** Tells open UIs of approvers that accounts changed (with the number of pending registrations). */
  private async announceUsers(): Promise<void> {
    try {
      const pendingCount = await this.repo.countUsers({ status: 'pending' });
      this.bus.publish({ kind: 'users_changed', pendingCount }, { kind: 'permission', permission: 'users.view' });
    } catch (err) {
      log.warn(`Could not announce an account change: ${String(err)}`);
    }
  }

  // ---- owners of tasks ------------------------------------------------------------------------------------------------

  /** Who created a task, for viewers that see every user's tasks; null for tasks from before accounts existed. */
  async ownerOf(ownerId: string | undefined, lang: Lang): Promise<TaskOwner | null> {
    if (!ownerId) return null;
    if (ownerId === ACCESS_TOKEN_PRINCIPAL_ID) {
      return { id: ownerId, name: t(lang, 'users.tokenOwner'), username: null, role: 'superadmin', kind: 'token', deleted: false };
    }
    const user = await this.user(ownerId);
    if (!user) return { id: ownerId, name: t(lang, 'users.deletedOwner'), username: null, role: null, kind: 'user', deleted: true };
    return { id: user.id, name: user.name, username: user.username, role: user.role, kind: 'user', deleted: false };
  }

  /** The requester of a task for the agent's context and the tools' access checks. */
  async requesterOf(ownerId: string | undefined): Promise<Requester | null> {
    if (!ownerId) return null;
    if (ownerId === ACCESS_TOKEN_PRINCIPAL_ID) return { id: ownerId, name: 'SOLAR_ACCESS_TOKEN', role: 'superadmin' };
    const user = await this.user(ownerId);
    return user ? { id: user.id, name: user.name, role: user.role } : null;
  }
}
