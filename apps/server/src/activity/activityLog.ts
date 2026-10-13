import { randomBytes } from 'node:crypto';
import {
  ACCESS_TOKEN_PRINCIPAL_ID,
  ACTIVITY_ACTIONS,
  ROLE_INFO,
  ROLES,
  type ActivityAction,
  type ActivityActorKind,
  type ActivityEntry,
  type ActivityItem,
  type ActivityOutcome,
  type ActivityTargetType,
  type Role,
} from '@solar/shared';
import { t, type Lang } from '../i18n.js';
import type { ActivitySummaryParams } from '../i18n/activity.js';
import { createLogger } from '../logger.js';
import { ActivityPartialWriteError, type ActivityCursor, type ActivityQuery, type Repository } from '../storage/repository.js';

const log = createLogger('activity');

// ---- what is recorded ----------------------------------------------------------------------------------------------

/** Who acted (a snapshot: the name and role at that moment). */
export interface ActivityActor {
  id: string | null;
  name: string | null;
  role: Role | null;
  kind: ActivityActorKind;
}

export interface ActivityTarget {
  type: ActivityTargetType;
  id?: string | null;
  /** Human name (title, username, path...); shortened when stored. */
  label?: string | null;
}

export interface ActivityInput {
  action: ActivityAction;
  actor: ActivityActor;
  /** Default `success`. */
  outcome?: ActivityOutcome;
  target?: ActivityTarget | null;
  ip?: string | null;
  userAgent?: string | null;
  /** Facts of the action. Never passwords, tokens, hashes, setup codes or file contents (keys that look so are dropped). */
  details?: Record<string, unknown> | null;
}

/** Where code records activity (the AuthService and the task manager depend on this much only). */
export interface ActivitySink {
  /** Queues an entry; never throws and never waits (writing happens in the background, in batches). */
  record(input: ActivityInput): void;
}

export const ANONYMOUS_ACTOR: ActivityActor = { id: null, name: null, role: null, kind: 'anonymous' };
export const SYSTEM_ACTOR: ActivityActor = { id: null, name: null, role: null, kind: 'system' };
export const TOKEN_ACTOR: ActivityActor = { id: ACCESS_TOKEN_PRINCIPAL_ID, name: 'SOLAR_ACCESS_TOKEN', role: 'superadmin', kind: 'token' };

export function userActor(user: { id: string; name: string; role: Role }): ActivityActor {
  return { id: user.id, name: user.name, role: user.role, kind: 'user' };
}

/** The actor of a request's principal (see AuthService's Principal): an account, the access token, or nobody. */
export function principalActor(principal: { kind: 'user' | 'token'; id: string; role: Role; user: { name: string } | null } | null | undefined): ActivityActor {
  if (!principal) return ANONYMOUS_ACTOR;
  if (principal.kind === 'token') return TOKEN_ACTOR;
  return { id: principal.id, name: principal.user?.name ?? null, role: principal.role, kind: 'user' };
}

/**
 * The actor of what the agent does for a task: the task's owner (its account as it is now, the access token, or just
 * the owner id when the account was deleted); SOLAR itself for tasks from before accounts existed.
 */
export function taskOwnerActor(ownerId: string | undefined, requester: { id: string; name: string; role: Role } | null): ActivityActor {
  if (!ownerId) return SYSTEM_ACTOR;
  if (ownerId === ACCESS_TOKEN_PRINCIPAL_ID) return TOKEN_ACTOR;
  if (requester && requester.id === ownerId) return userActor(requester);
  return { id: ownerId, name: null, role: null, kind: 'user' };
}

// ---- sanitising -----------------------------------------------------------------------------------------------------

const MAX_ID = 200;
const MAX_NAME = 120;
const MAX_LABEL = 200;
const MAX_IP = 64;
const MAX_USER_AGENT = 300;
const MAX_DETAIL_STRING = 300;
const MAX_DETAIL_KEY = 100;
const MAX_DETAIL_ITEMS = 50;
const MAX_DETAIL_KEYS = 30;
/** details (0) -> a list (1) -> its objects (2) -> their lists (3), e.g. `{ to: [{ name, models: [...] }] }`. */
const MAX_DETAIL_DEPTH = 4;
const MAX_DETAILS_JSON = 4_000;

/** Detail keys that could carry a secret: dropped whatever their value (defence in depth). */
const SENSITIVE_KEY = /pass(word)?|secret|token|hash|setup.?code|api.?key|authori[sz]ation|cookie|credential|private.?key|content/i;

/** Lone UTF-16 surrogates: Postgres rejects them in jsonb (`"\ud800"`), which would sink the whole batch insert. */
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/**
 * Characters that change how the text around them is shown without being visible themselves: bidi controls (ALM, LRM,
 * RLM, the embeddings, overrides and isolates), zero-width characters, word joiners and invisible operators, the soft
 * hyphen, the BOM, interlinear annotation marks and tag characters. "invoice\u202efdp.exe" reads as "invoiceexe.pdf",
 * "ad\u200bmin" looks like "admin". A run of them is stored as one U+FFFD, so an audit reader sees something was there.
 */
const INVISIBLE = /[\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb\u{e0000}-\u{e007f}]+/gu;
/** A zero-width joiner between two pictographs is part of one emoji (a woman + laptop, a rainbow flag): kept. */
const EMOJI_BEFORE = /[\p{Extended_Pictographic}\u{1f3fb}-\u{1f3ff}\ufe0f]$/u;
const EMOJI_AFTER = /^\p{Extended_Pictographic}/u;

function visibleText(text: string): string {
  return text.replace(INVISIBLE, (run: string, offset: number) =>
    run === '\u200d' && EMOJI_BEFORE.test(text.slice(Math.max(0, offset - 2), offset)) && EMOJI_AFTER.test(text.slice(offset + 1, offset + 3))
      ? run
      : '\ufffd',
  );
}

/**
 * One line of well-formed, visible text, at most `max` characters (an ellipsis marks the cut): control characters
 * become spaces; lone surrogates, bidi controls and zero-width characters become U+FFFD.
 */
export function clip(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const text = visibleText(
    String(value)
      .replace(LONE_SURROGATE, '\ufffd')
      .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' '),
  ).trim();
  if (!text) return null;
  if (text.length <= max) return text;
  // never cut a surrogate pair in half
  let end = max - 1;
  if (/[\ud800-\udbff]/.test(text[end - 1] ?? '')) end -= 1;
  return `${text.slice(0, end)}…`;
}

function cleanDetail(value: unknown, depth: number, redacted: { keys: number }): unknown {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return clip(value, MAX_DETAIL_STRING) ?? '';
  if (depth >= MAX_DETAIL_DEPTH) return undefined;
  if (Array.isArray(value)) return value.slice(0, MAX_DETAIL_ITEMS).map((v) => cleanDetail(v, depth + 1, redacted) ?? null);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [rawKey, v] of Object.entries(value as Record<string, unknown>).slice(0, MAX_DETAIL_KEYS)) {
      // keys are stored text as much as values (jsonb refuses a lone surrogate in either)
      const key = clip(rawKey, MAX_DETAIL_KEY);
      if (key === null) continue;
      if (SENSITIVE_KEY.test(key)) {
        redacted.keys += 1;
        continue;
      }
      const cleaned = cleanDetail(v, depth + 1, redacted);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  return undefined;
}

/**
 * The details as stored: secrets-looking keys dropped and counted in `redactedKeys` (so a reader knows the entry is not
 * the whole picture), strings shortened and made well-formed, small; null when empty. Names people choose (model routes,
 * fields) are passed as values, not as keys, so that the secret filter never hides them.
 */
export function cleanDetails(details: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!details) return null;
  const redacted = { keys: 0 };
  const cleaned = cleanDetail(details, 0, redacted) as Record<string, unknown> | undefined;
  if (cleaned && redacted.keys > 0) cleaned.redactedKeys = redacted.keys;
  if (!cleaned || Object.keys(cleaned).length === 0) return null;
  if (JSON.stringify(cleaned).length <= MAX_DETAILS_JSON) return cleaned;
  // too large: keep the scalar facts only
  const scalars = Object.fromEntries(Object.entries(cleaned).filter(([, v]) => v === null || typeof v !== 'object'));
  return JSON.stringify(scalars).length <= MAX_DETAILS_JSON ? { ...scalars, truncated: true } : { truncated: true };
}

const isRole = (value: unknown): value is Role => typeof value === 'string' && (ROLES as readonly string[]).includes(value);

// ---- ids ---------------------------------------------------------------------------------------------------------

let lastMs = 0;
let sequence = 0;
/** 36^3 entries per millisecond before the clock part is moved on. */
const SEQUENCE_LIMIT = 36 ** 3;

/** A clock going back by up to this much keeps the stamps monotonic; a larger jump is taken as the new time. */
const CLOCK_TOLERANCE_MS = 5_000;

/**
 * A time and an id that sort the same way: `act_` + milliseconds (base 36, 9 digits) + a per-millisecond sequence
 * (3 digits) + 10 random hex digits. Monotonic within the process, also when the clock goes back a little (NTP
 * adjustments); after a larger correction the stamps follow the corrected clock.
 */
export function nextActivityStamp(now: number): { id: string; at: string } {
  if (now > lastMs || now < lastMs - CLOCK_TOLERANCE_MS) {
    lastMs = now;
    sequence = 0;
  } else {
    sequence += 1;
    if (sequence >= SEQUENCE_LIMIT) {
      lastMs += 1;
      sequence = 0;
    }
  }
  const id = `act_${lastMs.toString(36).padStart(9, '0')}${sequence.toString(36).padStart(3, '0')}${randomBytes(5).toString('hex')}`;
  return { id, at: new Date(lastMs).toISOString() };
}

// ---- cursors ------------------------------------------------------------------------------------------------------

/** An opaque cursor of the next page (base64url JSON of [at, id]). */
export function encodeCursor(cursor: ActivityCursor): string {
  return Buffer.from(JSON.stringify([cursor.at, cursor.id]), 'utf8').toString('base64url');
}

/** The cursor of `encodeCursor`, or null when it is not one. */
export function decodeCursor(value: string): ActivityCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [at, id] = parsed as unknown[];
    if (typeof at !== 'string' || typeof id !== 'string' || !/^[\w.-]{1,200}$/.test(id) || Number.isNaN(Date.parse(at))) return null;
    return { at: new Date(at).toISOString(), id };
  } catch {
    return null;
  }
}

// ---- summaries ----------------------------------------------------------------------------------------------------

const KNOWN_ACTIONS = new Set<string>(ACTIVITY_ACTIONS);

/** The label of an action code in a language (the code itself for one this version does not know). */
export function actionLabel(action: string, lang: Lang): string {
  return KNOWN_ACTIONS.has(action) ? t(lang, `activity.action.${action as ActivityAction}`) : action;
}

/** How people read an entry's actor. */
function actorText(e: ActivityEntry, lang: Lang): string {
  if (e.actorKind === 'token') return t(lang, 'activity.actor.token');
  if (e.actorKind === 'anonymous') return t(lang, 'activity.actor.anonymous');
  if (e.actorKind === 'system') return t(lang, 'activity.actor.system');
  return e.actorName ?? (e.actorId ? `${t(lang, 'activity.actor.unknown')} (${e.actorId})` : t(lang, 'activity.actor.unknown'));
}

/** A one-line description of an entry in a language. */
export function summarizeActivity(e: ActivityEntry, lang: Lang): string {
  if (!KNOWN_ACTIONS.has(e.action)) return `${actorText(e, lang)}: ${e.action}`;
  const params: ActivitySummaryParams = {
    actor: actorText(e, lang),
    target: e.targetLabel ?? e.targetId ?? t(lang, 'activity.target.none'),
    outcome: e.outcome,
    d: e.details ?? {},
    role: (code) => (isRole(code) ? ROLE_INFO[code].name[lang] : typeof code === 'string' && code ? code : '-'),
  };
  try {
    return t(lang, `activity.summary.${e.action}`, params);
  } catch {
    return `${params.actor}: ${actionLabel(e.action, lang)}`;
  }
}

export function toItem(e: ActivityEntry, lang: Lang): ActivityItem {
  return { ...e, summary: summarizeActivity(e, lang) };
}

// ---- the log ------------------------------------------------------------------------------------------------------

export interface ActivityLogOptions {
  /** Days an entry is kept; 0 = forever. */
  retentionDays: number;
  now?: () => number;
  /** How long an entry may wait to be written with others (default 250 ms). */
  flushDelayMs?: number;
  /** Entries per write (default 100). */
  batchSize?: number;
  /** Entries kept waiting while storage fails; the oldest are dropped beyond it (default 10 000). */
  maxQueue?: number;
  /** Wait before writing again after storage failed (default 5 s). */
  retryDelayMs?: number;
}

type ActivityStore = Pick<Repository, 'appendActivity' | 'listActivity' | 'deleteActivityBefore'>;

const DAY_MS = 86_400_000;
/** Attempts to write an entry before it is given up. */
const MAX_ATTEMPTS = 3;
/** Wait before writing again after storage failed. */
const RETRY_DELAY_MS = 5_000;
/** At most one "retrying" warning, and one report of dropped entries, per this interval (each throttled on its own). */
const WARN_INTERVAL_MS = 60_000;

/**
 * The activity log (audit trail): records what people do, without slowing them down or ever failing their request.
 *
 * `record()` only builds the entry (actor snapshot, shortened texts, details without secrets) and queues it; the queue is
 * written in batches a moment later (one insert / one file append per batch). A write that fails is retried a few
 * times, RETRY_DELAY_MS apart, then the entries are dropped - the request that caused them succeeded long ago. Every
 * dropped entry is counted in a warning of the server log (at most one report a minute, none lost: what is held back is
 * reported with the next one, or when the log closes). Reads write the queue first, so a page always shows what was
 * just recorded; while a write waits for its retry, a read does not try again (it would only use up the attempts).
 * Entries older than the retention are removed once a day.
 */
export class ActivityLog implements ActivitySink {
  private readonly now: () => number;
  private readonly flushDelayMs: number;
  private readonly batchSize: number;
  private readonly maxQueue: number;
  private readonly retryDelayMs: number;
  private queue: Array<{ entry: ActivityEntry; attempts: number }> = [];
  private timer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  /** close() was called: no more timers (what is queued is written by close itself). */
  private closing = false;
  private closed = false;
  /** Storage failed: no write before this time (except when closing). */
  private retryAt = 0;
  private dropped = 0;
  /** Dropped entries not reported in the server log yet, and why the last of them were. */
  private unreported = 0;
  private unreportedWhy = '';
  private lastDropReport = Number.NEGATIVE_INFINITY;
  private dropReportTimer: NodeJS.Timeout | null = null;
  private lastRetryWarning = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly store: ActivityStore,
    private readonly options: ActivityLogOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.flushDelayMs = options.flushDelayMs ?? 250;
    this.batchSize = options.batchSize ?? 100;
    this.maxQueue = options.maxQueue ?? 10_000;
    this.retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
  }

  /** Starts the daily retention cleanup (and runs it once now, in the background). */
  start(): void {
    if (this.options.retentionDays <= 0 || this.cleanupTimer) return;
    const run = () => void this.cleanup().catch((err) => log.warn(`Activity log cleanup failed: ${String(err)}`));
    setImmediate(run).unref?.();
    this.cleanupTimer = setInterval(run, DAY_MS);
    this.cleanupTimer.unref();
  }

  /** Writes what is queued and stops; entries recorded afterwards are ignored. */
  async close(): Promise<void> {
    this.closing = true;
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.flush();
    this.closed = true;
    this.reportDrops(true);
  }

  record(input: ActivityInput): void {
    if (this.closed) return;
    try {
      this.queue.push({ entry: this.build(input), attempts: 0 });
      if (this.queue.length > this.maxQueue) this.drop(this.queue.splice(0, this.queue.length - this.maxQueue).length, 'the queue is full');
      this.schedule(this.queue.length >= this.batchSize ? 0 : this.flushDelayMs);
    } catch (err) {
      log.warn(`Could not record activity ${input.action}: ${String(err)}`);
    }
  }

  /** The entry an input becomes (exported for tests through record + list; kept pure). */
  private build(input: ActivityInput): ActivityEntry {
    const { id, at } = nextActivityStamp(this.now());
    const actor = input.actor;
    return {
      id,
      at,
      actorId: clip(actor.id, MAX_ID),
      actorName: clip(actor.name, MAX_NAME),
      actorRole: isRole(actor.role) ? actor.role : null,
      actorKind: actor.kind,
      action: input.action,
      targetType: input.target?.type ?? null,
      targetId: clip(input.target?.id, MAX_ID),
      targetLabel: clip(input.target?.label, MAX_LABEL),
      outcome: input.outcome ?? 'success',
      ip: clip(input.ip, MAX_IP),
      userAgent: clip(input.userAgent, MAX_USER_AGENT),
      details: cleanDetails(input.details),
    };
  }

  private schedule(delay: number): void {
    if (this.closing) return;
    if (this.timer) {
      if (delay > 0) return;
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
    this.timer.unref();
  }

  /** Writes everything queued so far (also waits for a write in progress). Never rejects. */
  flush(): Promise<void> {
    this.writing = this.writing.then(() => this.drain()).catch(() => undefined);
    return this.writing;
  }

  private async drain(): Promise<void> {
    // storage failed a moment ago: wait for the retry (a read must not use up the attempts meanwhile)
    const wait = this.retryAt - this.now();
    if (!this.closing && wait > 0) {
      if (this.queue.length > 0) this.schedule(wait);
      return;
    }
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.batchSize);
      try {
        await this.store.appendActivity(batch.map((b) => b.entry));
        this.retryAt = 0;
      } catch (err) {
        // part of the batch may be stored (another month file of the file backend): only the rest is written again
        const stored = err instanceof ActivityPartialWriteError ? err.storedIds : null;
        const why = String(stored ? (err as ActivityPartialWriteError).cause : err);
        const pending = stored ? batch.filter((b) => !stored.has(b.entry.id)) : batch;
        const retry = pending.filter((b) => (b.attempts += 1) < MAX_ATTEMPTS);
        this.drop(pending.length - retry.length, why);
        this.queue.unshift(...retry);
        if (retry.length) {
          this.warnRetry(`Writing the activity log failed, retrying in ${Math.round(this.retryDelayMs / 1000)} s: ${why}`);
          // later, not in a loop: storage that is down stays down for a while (when closing: given up now)
          if (this.closing) this.drop(this.queue.splice(0).length, why);
          else {
            this.retryAt = this.now() + this.retryDelayMs;
            this.schedule(this.retryDelayMs);
          }
          return;
        }
      }
    }
  }

  private drop(n: number, why: string): void {
    if (n <= 0) return;
    this.dropped += n;
    this.unreported += n;
    this.unreportedWhy = why;
    this.reportDrops(false);
  }

  /**
   * Reports the dropped entries not reported yet: now when the last report is a minute old (or `force`), else once
   * that minute is over (a timer), so that every dropped entry is counted in some warning.
   */
  private reportDrops(force: boolean): void {
    if (this.unreported === 0) return;
    const wait = this.lastDropReport + WARN_INTERVAL_MS - this.now();
    if (!force && wait > 0) {
      if (!this.dropReportTimer && !this.closed) {
        this.dropReportTimer = setTimeout(() => {
          this.dropReportTimer = null;
          this.reportDrops(true);
        }, wait);
        this.dropReportTimer.unref();
      }
      return;
    }
    if (this.dropReportTimer) clearTimeout(this.dropReportTimer);
    this.dropReportTimer = null;
    const n = this.unreported;
    this.unreported = 0;
    this.lastDropReport = this.now();
    log.warn(`${n} activity log entr${n === 1 ? 'y' : 'ies'} could not be written and were dropped (${this.dropped} in total): ${this.unreportedWhy}`);
  }

  private warnRetry(message: string): void {
    const now = this.now();
    if (now - this.lastRetryWarning < WARN_INTERVAL_MS) return;
    this.lastRetryWarning = now;
    log.warn(message);
  }

  /** Entries dropped since the start (tests, diagnostics). */
  droppedCount(): number {
    return this.dropped;
  }

  /** A page of the log, newest first (what is still queued is written first). */
  async list(query: ActivityQuery): Promise<{ items: ActivityEntry[]; next: ActivityCursor | null }> {
    await this.flush();
    return this.store.listActivity(query);
  }

  /** Removes entries older than the retention; returns how many. */
  async cleanup(): Promise<number> {
    const days = this.options.retentionDays;
    if (days <= 0) return 0;
    await this.flush();
    const cutoff = new Date(this.now() - days * DAY_MS).toISOString();
    const removed = await this.store.deleteActivityBefore(cutoff);
    if (removed) log.info(`Removed ${removed} activity log entr${removed === 1 ? 'y' : 'ies'} older than ${days} day(s)`);
    return removed;
  }
}
