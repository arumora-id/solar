/**
 * In-memory sliding-window rate limiter (no dependency, one process - SOLAR runs as a single server).
 *
 * Each key keeps the times of its last `limit` hits inside the window. `check` says whether the key is blocked (and for
 * how long) without counting; `hit` counts one attempt; `consume` does both in one synchronous step. An attempt whose
 * outcome is only known after awaiting something (a password check) must be counted with `consume` BEFORE the await:
 * a check now and a hit after the await lets every request that arrives in between pass the check (a parallel burst
 * would get unlimited attempts). `refund` gives such an up-front count back when the attempt turns out not to count
 * (the password was right, or it was never checked). The number of keys is capped so a flood of distinct keys (many
 * source addresses or invented user names) cannot grow memory without bound: past the cap, expired keys are dropped
 * first, then the oldest ones.
 */
export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  /** Most keys kept (default 20 000). */
  maxKeys?: number;
  now?: () => number;
}

export interface RateLimitState {
  blocked: boolean;
  /** Seconds until the next attempt is allowed (0 when not blocked). */
  retryAfterSeconds: number;
}

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(private readonly options: RateLimitOptions) {
    this.maxKeys = options.maxKeys ?? 20_000;
    this.now = options.now ?? Date.now;
  }

  private recent(key: string, now: number): number[] {
    const list = this.hits.get(key);
    if (!list) return [];
    const from = now - this.options.windowMs;
    const kept = list.filter((t) => t > from);
    if (kept.length === 0) this.hits.delete(key);
    else if (kept.length !== list.length) this.hits.set(key, kept);
    return kept;
  }

  check(key: string): RateLimitState {
    const now = this.now();
    const list = this.recent(key, now);
    if (list.length < this.options.limit) return { blocked: false, retryAfterSeconds: 0 };
    // the window frees one slot when the oldest counted hit leaves it
    const oldest = list[list.length - this.options.limit]!;
    return { blocked: true, retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.options.windowMs - now) / 1000)) };
  }

  /** Counts one attempt for the key. */
  hit(key: string): void {
    const now = this.now();
    const list = this.recent(key, now);
    list.push(now);
    // only the last `limit` hits matter for the decision
    if (list.length > this.options.limit) list.splice(0, list.length - this.options.limit);
    this.hits.delete(key);
    this.hits.set(key, list);
    if (this.hits.size > this.maxKeys) this.prune(now);
  }

  /**
   * Checks and counts in one step: when the key is not blocked, the attempt is counted at once (so at most `limit`
   * attempts are admitted per window, however many run concurrently). A blocked attempt is not counted.
   */
  consume(key: string): RateLimitState {
    const state = this.check(key);
    if (!state.blocked) this.hit(key);
    return state;
  }

  /** Takes back one counted attempt of the key (the most recent one), e.g. one counted up front that proved legitimate. */
  refund(key: string): void {
    const list = this.hits.get(key);
    if (!list) return;
    list.pop();
    if (list.length === 0) this.hits.delete(key);
  }

  /** Forgets a key (e.g. the failures of an identifier after a successful login). */
  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(now: number): void {
    for (const key of [...this.hits.keys()]) this.recent(key, now);
    // Map iteration order = insertion order; hit() re-inserts, so the first keys are the least recently hit
    for (const key of this.hits.keys()) {
      if (this.hits.size <= this.maxKeys) break;
      this.hits.delete(key);
    }
  }

  /** Number of keys tracked (tests). */
  get size(): number {
    return this.hits.size;
  }
}
