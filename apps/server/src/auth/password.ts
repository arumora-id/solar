import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password hashing with scrypt from node:crypto (memory-hard, no native dependency).
 *
 * Stored format: `scrypt$<N>$<r>$<p>$<salt>$<hash>` (salt and hash base64url). The parameters travel with every hash,
 * so they can be raised later: {@link verifyPassword} reports `needsRehash` for a hash made with other parameters, and
 * the login stores a new hash while it still has the plain password.
 */

export interface ScryptParams {
  /** CPU/memory cost, a power of two. */
  N: number;
  r: number;
  p: number;
}

/** Current parameters: N=2^15, r=8, p=1 = 32 MiB of memory and roughly 50-100 ms per hash on a server CPU. */
export const DEFAULT_SCRYPT: Readonly<ScryptParams> = { N: 2 ** 15, r: 8, p: 1 };

const SALT_BYTES = 16;
const KEY_BYTES = 64;

/** Limits that keep a stored (or forged) hash string from asking for absurd amounts of memory or CPU. */
const MAX_N = 2 ** 20;
const MAX_R = 32;
const MAX_P = 16;
const MAX_MEMORY = 256 * 1024 * 1024;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** The memory scrypt needs is about 128 * N * r bytes; node's default limit (32 MiB) is too tight for N=2^15, r=8. */
function maxmemFor(params: ScryptParams): number {
  return 128 * params.N * params.r * 2 + 1024 * 1024;
}

/** Too many password hashes are running or waiting: the request is answered 503 (with Retry-After) instead. */
export class HashBusyError extends Error {
  constructor() {
    super('Too many password checks at once');
    this.name = 'HashBusyError';
  }
}

/**
 * Admits at most `concurrency` operations at once; up to `maxQueue` more wait for a slot, beyond that `run` throws
 * HashBusyError at once (a flood is shed, not queued without bound).
 */
export class ConcurrencyGate {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    public concurrency: number,
    public maxQueue: number,
  ) {}

  async run<T>(op: () => Promise<T>): Promise<T> {
    if (this.active < this.concurrency) this.active += 1;
    else {
      if (this.waiting.length >= this.maxQueue) throw new HashBusyError();
      // the finishing operation hands its slot over (active stays the same)
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    try {
      return await op();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }

  /** Operations running / waiting (tests). */
  get load(): { active: number; waiting: number } {
    return { active: this.active, waiting: this.waiting.length };
  }
}

/**
 * Every scrypt of this process goes through one gate. scrypt runs on libuv's thread pool (UV_THREADPOOL_SIZE, default 4
 * threads), which file storage, static files and DNS use too: without a cap, a flood of logins (from many addresses, so
 * the per-address limits do not stop it) fills every thread with 32 MiB hashes and stalls the whole server. Half the
 * pool (at least one thread) is left for everything else; a short queue absorbs bursts, the rest is refused.
 */
const POOL_SIZE = Math.max(1, Number.parseInt(process.env.UV_THREADPOOL_SIZE ?? '', 10) || 4);
export const DEFAULT_HASH_LIMITS = { concurrency: Math.max(1, Math.floor(POOL_SIZE / 2)), maxQueue: 32 } as const;
const gate = new ConcurrencyGate(DEFAULT_HASH_LIMITS.concurrency, DEFAULT_HASH_LIMITS.maxQueue);

/** Changes the gate's limits (tests); returns a function restoring the previous ones. */
export function setHashLimits(limits: { concurrency?: number; maxQueue?: number }): () => void {
  const previous = { concurrency: gate.concurrency, maxQueue: gate.maxQueue };
  gate.concurrency = limits.concurrency ?? gate.concurrency;
  gate.maxQueue = limits.maxQueue ?? gate.maxQueue;
  return () => {
    gate.concurrency = previous.concurrency;
    gate.maxQueue = previous.maxQueue;
  };
}

/** Current load of the hashing gate (tests). */
export function hashLoad(): { active: number; waiting: number } {
  return gate.load;
}

/** scrypt through the gate; throws HashBusyError when the gate's queue is full. */
function scrypt(password: string, salt: Buffer, keylen: number, params: ScryptParams): Promise<Buffer> {
  const options: ScryptOptions = { N: params.N, r: params.r, p: params.p, maxmem: maxmemFor(params) };
  return gate.run(
    () =>
      new Promise<Buffer>((resolve, reject) => {
        scryptCallback(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
      }),
  );
}

/**
 * The form a password is hashed and compared in: Unicode NFKC, so the same characters typed on different keyboards or
 * systems (composed / decomposed accents, full-width forms) give the same password.
 */
export function normalizePassword(password: string): string {
  return password.normalize('NFKC');
}

/** Length in characters (code points), as people count them. */
export function passwordLength(password: string): number {
  return [...normalizePassword(password)].length;
}

export async function hashPassword(password: string, params: ScryptParams = DEFAULT_SCRYPT): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(normalizePassword(password), salt, KEY_BYTES, params);
  return ['scrypt', params.N, params.r, params.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

interface ParsedHash {
  params: ScryptParams;
  salt: Buffer;
  key: Buffer;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [N, r, p] = parts.slice(1, 4).map((v) => (/^\d{1,8}$/.test(v!) ? Number(v) : NaN)) as [number, number, number];
  if (!Number.isInteger(N) || N < 2 || N > MAX_N || (N & (N - 1)) !== 0) return null;
  if (!Number.isInteger(r) || r < 1 || r > MAX_R || !Number.isInteger(p) || p < 1 || p > MAX_P) return null;
  if (128 * N * r > MAX_MEMORY) return null;
  const salt = Buffer.from(parts[4]!, 'base64url');
  const key = Buffer.from(parts[5]!, 'base64url');
  if (salt.length < 8 || key.length < 16 || key.length > 256) return null;
  return { params: { N, r, p }, salt, key };
}

export interface VerifyResult {
  ok: boolean;
  /** The hash was made with other parameters than `current`: store a new one (only meaningful when ok). */
  needsRehash: boolean;
}

/**
 * Compares a password with a stored hash in constant time (for the key). A malformed hash never matches.
 */
export async function verifyPassword(password: string, stored: string, current: ScryptParams = DEFAULT_SCRYPT): Promise<VerifyResult> {
  const parsed = parseHash(stored);
  if (!parsed) {
    // same work as a real check, so a broken record does not answer faster than a wrong password
    await scrypt(normalizePassword(password), randomBytes(SALT_BYTES), KEY_BYTES, current);
    return { ok: false, needsRehash: false };
  }
  const key = await scrypt(normalizePassword(password), parsed.salt, parsed.key.length, parsed.params);
  const ok = key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
  const needsRehash =
    parsed.params.N !== current.N || parsed.params.r !== current.r || parsed.params.p !== current.p || parsed.key.length !== KEY_BYTES || parsed.salt.length !== SALT_BYTES;
  return { ok, needsRehash };
}

/** One dummy hash per parameter set (a server uses one set; tests may use several). */
const dummyHashes = new Map<string, Promise<string>>();

/**
 * Burns the same time as checking a real password, for logins naming an account that does not exist: the answer
 * time does not reveal which usernames / emails are registered. Always false.
 */
export async function verifyDummy(password: string, current: ScryptParams = DEFAULT_SCRYPT): Promise<false> {
  const key = `${current.N}$${current.r}$${current.p}`;
  let hash = dummyHashes.get(key);
  if (!hash) {
    const created = hashPassword(randomBytes(18).toString('base64url'), current);
    dummyHashes.set(key, created);
    // a failed computation (e.g. HashBusyError under load) must not stay cached: the next login computes it again
    created.catch(() => {
      if (dummyHashes.get(key) === created) dummyHashes.delete(key);
    });
    hash = created;
  }
  await verifyPassword(password, await hash, current);
  return false;
}

export type PasswordProblem = 'too_short' | 'too_long' | 'same_as_identity' | 'blank';

/**
 * Password rules: 10-128 characters (after NFKC), not only white space, and not the username or the email address
 * (compared case-insensitively). Returns the first problem, or null.
 */
export function passwordProblem(password: string, identity: { username?: string; email?: string } = {}): PasswordProblem | null {
  const normalized = normalizePassword(password);
  const length = [...normalized].length;
  if (length < PASSWORD_MIN_LENGTH) return 'too_short';
  if (length > PASSWORD_MAX_LENGTH) return 'too_long';
  if (!normalized.trim()) return 'blank';
  const lower = normalized.trim().toLowerCase();
  const email = identity.email?.trim().toLowerCase();
  if ((identity.username && lower === identity.username.trim().toLowerCase()) || (email && (lower === email || lower === email.split('@')[0]))) {
    return 'same_as_identity';
  }
  return null;
}
