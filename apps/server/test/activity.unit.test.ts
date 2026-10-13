import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  ACTIVITY_ACTIONS,
  can,
  PERMISSIONS,
  ROLE_INFO,
  ROLE_PERMISSIONS,
  ROLES,
  type ActivityEntry,
  type Role,
} from '@solar/shared';
import {
  ActivityLog,
  cleanDetails,
  clip,
  decodeCursor,
  encodeCursor,
  nextActivityStamp,
  summarizeActivity,
  taskOwnerActor,
  TOKEN_ACTOR,
} from '../src/activity/activityLog.js';
import { messageEntry } from '../src/i18n.js';
import { activityActions, csvCell, csvRow, roleInfos } from '../src/routes/activity.js';
import { FileActivityStore } from '../src/storage/fileActivityStore.js';
import type { ActivityQuery } from '../src/storage/repository.js';
import { POSTGRES_SCHEMA, renderSchemaSql, roleRows, SCHEMA_TABLES, USERS_ROLE_FK } from '../src/storage/schema.js';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** An entry as the log stores it (ids from the real generator: time-sortable). */
function entry(at: number, extra: Partial<ActivityEntry> = {}): ActivityEntry {
  const { id, at: iso } = nextActivityStamp(at);
  return {
    id,
    at: iso,
    actorId: 'usr_a',
    actorName: 'Alice',
    actorRole: 'staff',
    actorKind: 'user',
    action: 'auth.login',
    targetType: 'user',
    targetId: 'usr_a',
    targetLabel: 'alice',
    outcome: 'success',
    ip: '127.0.0.1',
    userAgent: 'test',
    details: null,
    ...extra,
  };
}

describe('roles from the code', () => {
  it('GET /api/roles data: every role, both languages, permissions in canonical order', () => {
    const en = roleInfos('en');
    expect(en.map((r) => r.id)).toEqual(['superadmin', 'head_of_it', 'staff']);
    for (const r of en) {
      expect(r.permissions).toEqual(PERMISSIONS.filter((p) => ROLE_PERMISSIONS[r.id].includes(p)));
      expect(r.name).toBe(ROLE_INFO[r.id].name.en);
      expect(r.names).toEqual(ROLE_INFO[r.id].name);
      expect(r.descriptions.id.length).toBeGreaterThan(10);
    }
    expect(roleInfos('id').find((r) => r.id === 'staff')?.name).toBe('Staf Solar');
  });

  it('activity permissions: everyone sees their own log, only superadmin and Head of IT everyone else', () => {
    for (const role of ROLES) expect(can(role, 'activity.view_own'), role).toBe(true);
    expect(ROLES.filter((r) => can(r, 'activity.view_all'))).toEqual(['superadmin', 'head_of_it']);
  });

  it('seeds solar_roles with exactly the code: the upsert holds each role and its permissions', () => {
    const upsert = POSTGRES_SCHEMA.find((s) => /INSERT INTO solar_roles/.test(s))!;
    expect(upsert).toBeDefined();
    for (const row of roleRows()) {
      expect(row.permissions).toEqual(PERMISSIONS.filter((p) => ROLE_PERMISSIONS[row.id as Role].includes(p)));
      expect(upsert).toContain(`('${row.id}', `);
      expect(upsert).toContain(`'${JSON.stringify(row.permissions)}'::jsonb, ${row.sortOrder}, now())`);
    }
    expect(upsert).toMatch(/ON CONFLICT \(id\) DO UPDATE SET/);
    // updated_at only moves when a row really changed
    expect(upsert).toMatch(/IS DISTINCT FROM/);
    // quotes in texts are doubled (every user''s ...)
    expect(upsert).toContain("user''s");
  });
});

describe('Postgres schema', () => {
  const sql = POSTGRES_SCHEMA.join('\n');
  const indexOf = (re: RegExp) => POSTGRES_SCHEMA.findIndex((s) => re.test(s));

  it('docs/schema.sql is the output of npm run db:schema (regenerate: npm run db:schema -- --out docs/schema.sql)', () => {
    expect(readFileSync(join(ROOT, 'docs/schema.sql'), 'utf8')).toBe(renderSchemaSql());
  });

  it('creates every table the app uses', () => {
    for (const table of SCHEMA_TABLES) expect(sql, table).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`));
    // every table the Postgres repository reads or writes is in the schema
    const repoSource = readFileSync(join(ROOT, 'apps/server/src/storage/postgresRepository.ts'), 'utf8');
    const used = new Set([...repoSource.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+(solar_[a-z_]+)/g)].map((m) => m[1]!));
    expect(used.size).toBeGreaterThanOrEqual(8);
    for (const table of used) expect(SCHEMA_TABLES as readonly string[], table).toContain(table);
  });

  it('is idempotent statement by statement', () => {
    for (const statement of POSTGRES_SCHEMA) {
      const body = statement.replace(/^--.*$/gm, '').trim();
      if (/^CREATE (UNIQUE )?(TABLE|INDEX)/.test(body)) expect(body, body.slice(0, 60)).toMatch(/^CREATE (UNIQUE )?(TABLE|INDEX) IF NOT EXISTS/);
      else if (/^ALTER TABLE/.test(body)) expect(body).toMatch(/ADD COLUMN IF NOT EXISTS/);
      else if (/^INSERT/.test(body)) expect(body).toMatch(/ON CONFLICT/);
      else expect(body, body.slice(0, 60)).toMatch(/^DO \$\$/);
      // nothing destructive (ON DELETE CASCADE of a foreign key is a rule, not a statement)
      expect(body.replace(/ON DELETE CASCADE/g, '')).not.toMatch(/\bDROP\b|\bTRUNCATE\b|\bDELETE\b/i);
    }
  });

  it('upserts the roles before it adds the users -> roles foreign key, once, checked in pg_constraint', () => {
    const users = indexOf(/CREATE TABLE IF NOT EXISTS solar_users/);
    const roles = indexOf(/CREATE TABLE IF NOT EXISTS solar_roles/);
    const upsert = indexOf(/INSERT INTO solar_roles/);
    const fk = indexOf(/ADD CONSTRAINT solar_users_role_fkey/);
    expect(users).toBeGreaterThanOrEqual(0);
    expect(users).toBeLessThan(fk);
    expect(roles).toBeLessThan(upsert);
    expect(upsert).toBeLessThan(fk);
    const block = POSTGRES_SCHEMA[fk]!;
    expect(block).toMatch(new RegExp(`IF NOT EXISTS \\(SELECT 1 FROM pg_constraint WHERE conname = '${USERS_ROLE_FK}'`));
    expect(block).toMatch(/FOREIGN KEY \(role\) REFERENCES solar_roles \(id\) NOT VALID/);
    // validated only when every existing account has a known role (else the server still starts)
    expect(block).toMatch(/NOT EXISTS \(SELECT 1 FROM solar_roles r WHERE r\.id = u\.role\)/);
    expect(block).toMatch(/VALIDATE CONSTRAINT solar_users_role_fkey/);
    expect(block).toMatch(/EXCEPTION WHEN duplicate_object/);
  });

  it('activity table with the indexes the API pages by', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS solar_activity \(\s+id\s+text PRIMARY KEY,\s+at\s+timestamptz NOT NULL/);
    for (const column of ['actor_id', 'actor_name', 'actor_role', 'actor_kind', 'action', 'target_type', 'target_id', 'target_label', 'outcome', 'ip', 'user_agent', 'details']) {
      expect(sql).toMatch(new RegExp(`\\n  ${column}\\s+(text|jsonb)`));
    }
    expect(sql).toContain('ON solar_activity (at DESC, id DESC)');
    expect(sql).toContain('ON solar_activity (actor_id, at DESC, id DESC)');
    expect(sql).toContain('ON solar_activity (action, at DESC, id DESC)');
    // the log outlives deleted accounts: no foreign key from it
    expect(POSTGRES_SCHEMA.find((s) => s.includes('CREATE TABLE IF NOT EXISTS solar_activity'))).not.toMatch(/REFERENCES/);
  });

  it('prints as one file that splits back into the statements', () => {
    const text = renderSchemaSql();
    const parts = text
      .split(/;\n\n|;\n$/)
      .map((p) => p.replace(/^(--[^\n]*\n|\n)*/, '').trim())
      .filter(Boolean);
    expect(parts).toEqual(POSTGRES_SCHEMA.map((s) => s.replace(/^(--[^\n]*\n)*/, '').trim()));
  });
});

describe('what an entry may hold', () => {
  it('clips texts to one line', () => {
    expect(clip('a\nb\tc\u0000d', 50)).toBe('a b c d');
    expect(clip('x'.repeat(500), 10)).toBe(`${'x'.repeat(9)}…`);
    expect(clip('   ', 10)).toBeNull();
    // a surrogate pair is never cut in half
    expect(clip(`${'a'.repeat(8)}😀bc`, 10)).toBe(`${'a'.repeat(8)}…`);
  });

  it('drops detail keys that could hold secrets, shortens strings, caps the size', () => {
    const cleaned = cleanDetails({
      password: 'hunter2',
      newPassword: 'x',
      apiKey: 'sk-1',
      api_key: 'sk-2',
      token: 't',
      passwordHash: 'scrypt$...',
      setupCode: 'ABCD-EFGH',
      authorization: 'Bearer x',
      content: '# file',
      nested: { secret: 's', ok: 1 },
      reason: 'wrong_password',
      long: 'y'.repeat(1000),
    });
    // the dropped keys are counted, so a reader knows the entry is not the whole picture
    expect(cleaned).toEqual({ nested: { ok: 1 }, reason: 'wrong_password', long: `${'y'.repeat(299)}…`, redactedKeys: 10 });
    expect(cleanDetails({})).toBeNull();
    const huge = cleanDetails({ list: Array.from({ length: 50 }, () => 'z'.repeat(290)), n: 1 });
    expect(huge).toEqual({ n: 1, truncated: true });
  });

  it('ids sort like the time, also within one millisecond and when the clock goes back', () => {
    const stamps = [nextActivityStamp(2_000_000_000_000), nextActivityStamp(2_000_000_000_000), nextActivityStamp(1_999_999_999_000)];
    const ids = stamps.map((s) => s.id);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(3);
    expect(stamps[2]!.at >= stamps[1]!.at).toBe(true);
    expect(ids[0]).toMatch(/^act_[0-9a-z]{9}[0-9a-z]{3}[0-9a-f]{10}$/);
  });

  it('cursors round-trip and reject garbage', () => {
    const c = { at: '2026-10-12T10:00:00.000Z', id: 'act_abc' };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor('not a cursor')).toBeNull();
    expect(decodeCursor(Buffer.from('["x","act_1"]').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('["2026-10-12T10:00:00Z","a b"]').toString('base64url'))).toBeNull();
  });

  it('the agent acts as the task owner', () => {
    expect(taskOwnerActor('usr_1', { id: 'usr_1', name: 'Budi', role: 'staff' })).toEqual({ id: 'usr_1', name: 'Budi', role: 'staff', kind: 'user' });
    expect(taskOwnerActor('system:access-token', null)).toEqual(TOKEN_ACTOR);
    expect(taskOwnerActor('usr_gone', null)).toEqual({ id: 'usr_gone', name: null, role: null, kind: 'user' });
    expect(taskOwnerActor(undefined, null).kind).toBe('system');
  });
});

describe('summaries and labels', () => {
  it('every action has a label and a summary in both languages', () => {
    for (const action of ACTIVITY_ACTIONS) {
      for (const key of [`activity.action.${action}`, `activity.summary.${action}`] as const) {
        const e = messageEntry(key as never);
        expect(e, key).toBeDefined();
      }
      for (const lang of ['id', 'en'] as const) {
        const text = summarizeActivity(entry(Date.now(), { action, details: { reason: 'forbidden', from: 'staff', to: 'head_of_it', role: 'staff' } }), lang);
        expect(text.length, `${action} ${lang}`).toBeGreaterThan(3);
        expect(text).not.toMatch(/undefined|\[object/);
      }
    }
    expect(activityActions('en').map((a) => a.action)).toEqual([...ACTIVITY_ACTIONS]);
    expect(activityActions('en').find((a) => a.action === 'settings.llm.route_change')).toEqual({
      action: 'settings.llm.route_change',
      group: 'settings.llm',
      label: 'AI model routes changed',
    });
  });

  it('reads like a sentence in the language asked', () => {
    const roleChange = entry(Date.now(), {
      actorName: 'Root',
      actorRole: 'superadmin',
      action: 'user.role_change',
      targetLabel: 'budi',
      details: { from: 'staff', to: 'head_of_it' },
    });
    expect(summarizeActivity(roleChange, 'en')).toBe('Root changed the role of budi: Solar Staff → Head of IT Solar');
    expect(summarizeActivity(roleChange, 'id')).toBe('Root mengubah peran budi: Staf Solar → Head of IT Solar');
    const refused = { ...roleChange, outcome: 'failure' as const, details: { from: 'staff', to: 'superadmin', reason: 'forbidden' } };
    expect(summarizeActivity(refused, 'en')).toBe('Refused: Root changed the role of budi: Solar Staff → Superadmin (not allowed)');
    const failed = entry(Date.now(), { actorKind: 'anonymous', actorId: null, actorName: null, action: 'auth.login_failed', targetId: null, targetLabel: null, outcome: 'failure', details: { reason: 'wrong_password' } });
    expect(summarizeActivity(failed, 'en')).toBe('Failed login: wrong username/email or password');
    const known = { ...failed, targetId: 'usr_b', targetLabel: 'budi', details: { reason: 'wrong_password', identifier: 'budi' } };
    expect(summarizeActivity(known, 'id')).toBe('Login gagal untuk budi: password salah');
    const agent = entry(Date.now(), { action: 'knowledge.write', targetLabel: 'systems/AD1GATE.md', details: { via: 'agent', taskId: 'task_1' } });
    expect(summarizeActivity(agent, 'en')).toBe('Alice saved the knowledge file systems/AD1GATE.md (through the agent)');
  });
});

describe('CSV export', () => {
  it('quotes every cell and defuses formulas', () => {
    expect(csvCell('plain')).toBe('"plain"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('""');
    for (const bad of ['=1+2', '+SUM(A1)', '-2+3', '@cmd', '\tx', '\r=x', '  =HYPERLINK("http://evil")', '＝1']) {
      expect(csvCell(bad).startsWith(`"'`), bad).toBe(true);
    }
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
    const row = csvRow(entry(Date.now(), { actorName: '=cmd|"/c calc"!A1', targetLabel: '@SUM(1)' }), 'en');
    expect(row).toContain('"\'=cmd|""/c calc""!A1"');
    expect(row).toContain('"\'@SUM(1)"');
    expect(row.split('","').length).toBe(16);
  });
});

describe('ActivityLog: batching and failures', () => {
  it('writes in batches in the background and never throws', async () => {
    const batches: ActivityEntry[][] = [];
    const store = {
      appendActivity: async (e: ActivityEntry[]) => void batches.push(e),
      listActivity: async (_q: ActivityQuery) => ({ items: batches.flat().reverse(), next: null }),
      deleteActivityBefore: async () => 0,
    };
    const log = new ActivityLog(store, { retentionDays: 0, flushDelayMs: 10_000, batchSize: 50 });
    for (let i = 0; i < 120; i++) log.record({ action: 'auth.login', actor: TOKEN_ACTOR });
    // a full batch is written at once, the rest waits for the delay or a read
    await new Promise((r) => setTimeout(r, 20));
    expect(batches.flat().length).toBeGreaterThanOrEqual(50);
    const page = await log.list({ limit: 200 });
    expect(page.items).toHaveLength(120);
    expect(batches.every((b) => b.length <= 50)).toBe(true);
    await log.close();
    log.record({ action: 'auth.login', actor: TOKEN_ACTOR });
    expect(batches.flat()).toHaveLength(120);
  });

  it('retries a failed write, then drops it - the caller never sees an error', async () => {
    let calls = 0;
    const written: ActivityEntry[] = [];
    const store = {
      appendActivity: async (e: ActivityEntry[]) => {
        calls += 1;
        if (calls === 1) throw new Error('database is down');
        written.push(...e);
      },
      listActivity: async () => ({ items: written, next: null }),
      deleteActivityBefore: async () => 0,
    };
    const log = new ActivityLog(store, { retentionDays: 0, flushDelayMs: 1, retryDelayMs: 0 });
    expect(() => log.record({ action: 'task.create', actor: TOKEN_ACTOR, target: { type: 'task', id: 't1' } })).not.toThrow();
    await log.flush();
    expect(written).toHaveLength(0);
    await log.flush();
    expect(written).toHaveLength(1);
    const broken = new ActivityLog(
      { appendActivity: async () => Promise.reject(new Error('always down')), listActivity: async () => ({ items: [], next: null }), deleteActivityBefore: async () => 0 },
      { retentionDays: 0, flushDelayMs: 1 },
    );
    broken.record({ action: 'task.create', actor: TOKEN_ACTOR });
    for (let i = 0; i < 4; i++) await broken.flush();
    await expect(broken.close()).resolves.toBeUndefined();
  });

  it('retention: removes entries older than the configured days', async () => {
    const now = Date.parse('2026-10-12T00:00:00.000Z');
    let cutoff = '';
    const log = new ActivityLog(
      { appendActivity: async () => undefined, listActivity: async () => ({ items: [], next: null }), deleteActivityBefore: async (c) => ((cutoff = c), 7) },
      { retentionDays: 30, now: () => now },
    );
    expect(await log.cleanup()).toBe(7);
    expect(cutoff).toBe('2026-09-12T00:00:00.000Z');
    const forever = new ActivityLog(
      { appendActivity: async () => undefined, listActivity: async () => ({ items: [], next: null }), deleteActivityBefore: async () => 99 },
      { retentionDays: 0 },
    );
    expect(await forever.cleanup()).toBe(0);
  });
});

describe('FileActivityStore', () => {
  const DAY = 86_400_000;
  const START = Date.parse('2026-08-20T00:00:00.000Z');

  async function filled(n: number): Promise<{ store: FileActivityStore; all: ActivityEntry[]; dir: string }> {
    const dir = mkdtempSync(join(tmpdir(), 'solar-activity-'));
    const store = new FileActivityStore(join(dir, 'activity'));
    await store.init();
    const all: ActivityEntry[] = [];
    const step = (60 * DAY) / n;
    for (let i = 0; i < n; i++) {
      const staff = i % 3 === 0;
      all.push(
        entry(START + Math.floor(i * step), {
          actorId: staff ? 'usr_staff' : 'usr_head',
          actorName: staff ? 'Siti Staff' : 'Hadi Head',
          action: i % 5 === 0 ? 'auth.login_failed' : i % 7 === 0 ? 'user.role_change' : 'task.create',
          outcome: i % 5 === 0 ? 'failure' : 'success',
          targetLabel: i % 1000 === 0 ? `Needle ${i} – ünïcödé` : `Task ${i}`,
        }),
      );
    }
    for (let i = 0; i < all.length; i += 500) await store.append(all.slice(i, i + 500));
    return { store, all, dir };
  }

  it('pages newest first through tens of thousands of entries, with filters, across month files', async () => {
    const { store, all, dir } = await filled(30_000);
    expect(readdirSync(join(dir, 'activity')).sort()).toEqual(['activity-2026-08.jsonl', 'activity-2026-09.jsonl', 'activity-2026-10.jsonl']);
    expect(statSync(join(dir, 'activity', 'activity-2026-09.jsonl')).mode & 0o777).toBe(0o600);
    const newestFirst = [...all].reverse();

    // first page and a deep page
    const started = Date.now();
    const first = await store.list({ limit: 50 });
    expect(first.items.map((e) => e.id)).toEqual(newestFirst.slice(0, 50).map((e) => e.id));
    let cursor = first.next!;
    let deep = first;
    for (let page = 0; page < 300; page++) {
      deep = await store.list({ limit: 50, before: cursor });
      cursor = deep.next!;
    }
    expect(deep.items.map((e) => e.id)).toEqual(newestFirst.slice(300 * 50, 301 * 50).map((e) => e.id));
    expect(Date.now() - started).toBeLessThan(20_000);

    // one actor, failures only, walked to the end page by page: exactly the matching entries, in order
    const wanted = newestFirst.filter((e) => e.actorId === 'usr_staff' && e.outcome === 'failure');
    const seen: string[] = [];
    let next: ActivityQuery['before'] | undefined;
    do {
      const page = await store.list({ limit: 200, actorId: 'usr_staff', outcome: 'failure', before: next });
      seen.push(...page.items.map((e) => e.id));
      next = page.next ?? undefined;
    } while (next);
    expect(seen).toEqual(wanted.map((e) => e.id));

    // time window, action prefix and text search
    const september = await store.list({ limit: 1000, from: '2026-09-01T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z', actionPrefixes: ['user.'] });
    expect(september.items.length).toBeGreaterThan(0);
    expect(september.items.every((e) => e.at.startsWith('2026-09-01') && e.action === 'user.role_change')).toBe(true);
    // a rare match over 30 000 lines: pages of what one request may read, walked with the cursor
    const needles: string[] = [];
    let after: ActivityQuery['before'] | undefined;
    do {
      const page = await store.list({ limit: 100, q: 'NEEDLE', before: after });
      needles.push(...page.items.map((e) => e.targetLabel!));
      after = page.next ?? undefined;
    } while (after);
    expect(needles).toEqual(newestFirst.filter((e) => e.targetLabel?.startsWith('Needle')).map((e) => e.targetLabel));
    expect((await store.list({ limit: 10, q: 'ünïcödé' })).items.length).toBe(10);
    expect((await store.list({ limit: 10, actions: ['auth.logout'] })).items).toEqual([]);
  });

  it('retention removes old month files and rewrites the month of the cutoff', async () => {
    const { store, all, dir } = await filled(3_000);
    const cutoff = '2026-09-10T00:00:00.000Z';
    const removed = await store.deleteBefore(cutoff);
    const older = all.filter((e) => e.at < cutoff);
    expect(removed).toBe(older.length);
    expect(readdirSync(join(dir, 'activity')).sort()).toEqual(['activity-2026-09.jsonl', 'activity-2026-10.jsonl']);
    const rest = await store.list({ limit: 1000 });
    const left: ActivityEntry[] = [...rest.items];
    let next = rest.next;
    while (next) {
      const page = await store.list({ limit: 1000, before: next });
      left.push(...page.items);
      next = page.next;
    }
    expect(left.length).toBe(all.length - older.length);
    expect(left.every((e) => e.at >= cutoff)).toBe(true);
    expect(await store.deleteBefore(cutoff)).toBe(0);
  });

  it('survives a torn last line: skipped when reading, cut off before the next append', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'solar-activity-torn-'));
    const store = new FileActivityStore(join(dir, 'activity'));
    await store.init();
    const a = entry(Date.parse('2026-10-01T00:00:00.000Z'));
    await store.append([a]);
    const file = join(dir, 'activity', 'activity-2026-10.jsonl');
    appendFileSync(file, '{"id":"act_torn","at":"2026-10-01T00:00:01.000Z","actor');
    expect((await store.list({ limit: 10 })).items.map((e) => e.id)).toEqual([a.id]);
    const restarted = new FileActivityStore(join(dir, 'activity'));
    await restarted.init();
    const b = entry(Date.parse('2026-10-01T00:00:02.000Z'));
    await restarted.append([b]);
    expect((await restarted.list({ limit: 10 })).items.map((e) => e.id)).toEqual([b.id, a.id]);
    expect(readFileSync(file, 'utf8').split('\n').filter(Boolean)).toHaveLength(2);
    writeFileSync(join(dir, 'activity', 'notes.txt'), 'ignored');
    expect((await restarted.list({ limit: 10 })).items).toHaveLength(2);
  });
});

// ---- review fixes ------------------------------------------------------------------------------------------------

/** True when a string has no lone surrogate (String.prototype.isWellFormed, which the TS lib in use does not type). */
const wellFormed = (text: string) => !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(text);

/** The repository side of a FileActivityStore, for an ActivityLog. */
const fileStore = (store: FileActivityStore) => ({
  appendActivity: (e: ActivityEntry[]) => store.append(e),
  listActivity: (q: ActivityQuery) => store.list(q),
  deleteActivityBefore: (cutoff: string) => store.deleteBefore(cutoff),
});

describe('stored text is well-formed and visible', () => {
  it('lone surrogates become U+FFFD in every stored text, detail keys included', () => {
    expect(clip('s\ud800', 10)).toBe('s\ufffd');
    expect(clip('\udc00x', 10)).toBe('\ufffdx');
    expect(clip('ok 😀', 10)).toBe('ok 😀');
    const details = cleanDetails({ sessionId: 's\ud800', ['k\udfff']: 'v', list: ['a\ud83d'], nested: { ['\ud800']: 1 } })!;
    expect(details).toEqual({ sessionId: 's\ufffd', 'k\ufffd': 'v', list: ['a\ufffd'], nested: { '\ufffd': 1 } });
    expect(JSON.stringify(details)).not.toMatch(/\\ud[89a-f]/i);
  });

  it('bidi controls and zero-width characters are shown as U+FFFD (no spoofed labels); emoji sequences stay', () => {
    expect(clip('invoice\u202efdp.exe', 50)).toBe('invoice\ufffdfdp.exe');
    expect(clip('ad\u200bmin', 50)).toBe('ad\ufffdmin');
    expect(clip('a\u2066\u2067\u2069b', 50)).toBe('a\ufffdb');
    expect(clip('\ufeffBOM\u200e', 50)).toBe('\ufffdBOM\ufffd');
    expect(clip('dev 👩\u200d💻 🏳\ufe0f\u200d🌈', 50)).toBe('dev 👩\u200d💻 🏳\ufe0f\u200d🌈');
    expect(clip('a\u200db', 50)).toBe('a\ufffdb');
    expect(cleanDetails({ title: 'x\u202ey' })).toEqual({ title: 'x\ufffdy' });
  });

  it('names people choose are values, not keys: a model route called token-saver is kept', () => {
    const routes = [
      { name: 'default', models: ['a/m1'] },
      { name: 'token-saver', models: ['a/m1', 'b/m2'] },
    ];
    expect(cleanDetails({ from: [], to: routes })).toEqual({ from: [], to: routes });
    // a key that looks like a secret is still dropped, but never silently
    expect(cleanDetails({ to: { 'token-saver': ['a/m1'], default: ['a/m1'] } })).toEqual({ to: { default: ['a/m1'] }, redactedKeys: 1 });
  });

  it('an entry with lone surrogates reaches a store as strict as jsonb, and so do the entries batched with it', async () => {
    const stored: ActivityEntry[] = [];
    const strict = {
      // like Postgres jsonb: one lone surrogate (written by JSON.stringify as \udXXX) fails the whole batch
      appendActivity: async (batch: ActivityEntry[]) => {
        if (batch.some((e) => /\\ud[89a-f][0-9a-f]{2}/i.test(JSON.stringify(e)))) throw new Error('invalid input syntax for type json');
        stored.push(...batch);
      },
      listActivity: async () => ({ items: [...stored].reverse(), next: null }),
      deleteActivityBefore: async () => 0,
    };
    const log = new ActivityLog(strict, { retentionDays: 0, flushDelayMs: 10_000 });
    log.record({ action: 'user.create', actor: TOKEN_ACTOR, target: { type: 'user', id: 'usr_1', label: 'victim' }, details: { role: 'superadmin' } });
    log.record({
      action: 'task.create',
      actor: { id: 'usr_2', name: 'Eve\ud800', role: 'staff', kind: 'user' },
      target: { type: 'task', id: 'task_1', label: `${'x'.repeat(86)} \ud83d` },
      details: { sessionId: 's\ud800', ['k\udc00']: 1 },
      userAgent: 'UA\udfff',
    });
    log.record({ action: 'knowledge.write', actor: TOKEN_ACTOR, target: { type: 'knowledge', id: 'systems/T.md', label: 'T\ud800' }, details: { title: 'T\ud800' } });
    const page = await log.list({ limit: 10 });
    expect(page.items.map((e) => e.action)).toEqual(['knowledge.write', 'task.create', 'user.create']);
    for (const e of page.items) expect(wellFormed(JSON.stringify(e)), e.action).toBe(true);
    expect(page.items[1]).toMatchObject({ actorName: 'Eve\ufffd', targetLabel: `${'x'.repeat(86)} \ufffd`, details: { sessionId: 's\ufffd', 'k\ufffd': 1 } });
    await log.close();
    expect(log.droppedCount()).toBe(0);
  });
});

describe('ActivityLog: retries and drops', () => {
  it('a read while a write waits for its retry does not use up the attempts', async () => {
    let calls = 0;
    const written: ActivityEntry[] = [];
    const store = {
      appendActivity: async (e: ActivityEntry[]) => {
        calls += 1;
        if (calls === 1) throw new Error('database is down');
        written.push(...e);
      },
      listActivity: async () => ({ items: [...written].reverse(), next: null }),
      deleteActivityBefore: async () => 0,
    };
    const log = new ActivityLog(store, { retentionDays: 0, flushDelayMs: 1, retryDelayMs: 300 });
    log.record({ action: 'auth.login', actor: TOKEN_ACTOR });
    await log.flush();
    expect(calls).toBe(1);
    // GET /api/activity flushes before reading: during the wait that must not count as attempts
    for (let i = 0; i < 5; i++) await log.list({ limit: 10 });
    expect(calls).toBe(1);
    // the scheduled retry writes it
    await vi.waitFor(() => expect(written).toHaveLength(1), { timeout: 3_000, interval: 20 });
    expect(calls).toBe(2);
    await log.close();
    expect(log.droppedCount()).toBe(0);
  });

  it('every dropped entry is counted in a warning, also when drops come faster than one report a minute', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((line: unknown) => void lines.push(String(line)));
    try {
      const down = {
        appendActivity: async () => Promise.reject(new Error('always down')),
        listActivity: async () => ({ items: [], next: null }),
        deleteActivityBefore: async () => 0,
      };
      const log = new ActivityLog(down, { retentionDays: 0, flushDelayMs: 10_000, retryDelayMs: 0, batchSize: 2 });
      for (let i = 0; i < 5; i++) log.record({ action: 'auth.login', actor: TOKEN_ACTOR });
      for (let i = 0; i < 12; i++) await log.flush();
      await log.close();
      expect(log.droppedCount()).toBe(5);
      const reported = lines
        .map((l) => /\] (\d+) activity log entr(?:y|ies) could not be written and were dropped/.exec(l)?.[1])
        .filter((n): n is string => n !== undefined)
        .map(Number);
      expect(reported.reduce((a, b) => a + b, 0)).toBe(5);
      // the "retrying" warning has its own throttle: it does not swallow the drop reports
      expect(lines.filter((l) => l.includes('retrying')).length).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('FileActivityStore: order, idempotent appends, bounded reads', () => {
  it('pages stay newest first by (at, id) when the clock goes back, also across a restart', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'solar-activity-clock-')), 'activity');
    const store = new FileActivityStore(dir);
    await store.init();
    let now = Date.parse('2026-10-12T10:00:00.000Z');
    const log = new ActivityLog(fileStore(store), { retentionDays: 0, flushDelayMs: 10_000, now: () => now });
    const rec = (l: ActivityLog, label: string) => l.record({ action: 'auth.login', actor: TOKEN_ACTOR, target: { type: 'user', label } });
    rec(log, 'A');
    await log.flush();
    // the clock is set back a minute (NTP, a user fixing the time)
    now -= 60_000;
    rec(log, 'B');
    rec(log, 'C');
    await log.close();
    // a restart with the clock back a further 30 s
    const restarted = new FileActivityStore(dir);
    await restarted.init();
    now -= 30_000;
    const log2 = new ActivityLog(fileStore(restarted), { retentionDays: 0, flushDelayMs: 10_000, now: () => now });
    rec(log2, 'D');
    await log2.close();
    expect(readdirSync(dir).length).toBeGreaterThanOrEqual(2);

    const labels = (items: ActivityEntry[]) => items.map((e) => e.targetLabel);
    expect(labels((await restarted.list({ limit: 100 })).items)).toEqual(['A', 'C', 'B', 'D']);
    // one at a time with the cursor: every entry once, in the same order
    const walked: ActivityEntry[] = [];
    let before: ActivityQuery['before'] | undefined;
    do {
      const page = await restarted.list({ limit: 1, before });
      walked.push(...page.items);
      before = page.next ?? undefined;
    } while (before);
    expect(labels(walked)).toEqual(['A', 'C', 'B', 'D']);
    expect(labels((await restarted.list({ limit: 10, from: '2026-10-12T09:59:30.000Z' })).items)).toEqual(['A']);
    expect(labels((await restarted.list({ limit: 10, from: '2026-10-12T09:58:00.000Z', to: '2026-10-12T09:59:30.000Z' })).items)).toEqual(['C', 'B', 'D']);
    // retention over several runs of a month
    expect(await restarted.deleteBefore('2026-10-12T09:59:30.000Z')).toBe(3);
    expect(labels((await restarted.list({ limit: 10 })).items)).toEqual(['A']);
    expect(readdirSync(dir)).toEqual(['activity-2026-10.jsonl']);
  });

  it('a batch written again after a failure is stored once; a torn line is cut off before the next append', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'solar-activity-retry-')), 'activity');
    const store = new FileActivityStore(dir);
    await store.init();
    // November cannot be written (a directory stands where its file would go)
    mkdirSync(join(dir, 'activity-2026-11.jsonl'));
    let now = Date.parse('2026-10-31T23:59:59.900Z');
    const log = new ActivityLog(fileStore(store), { retentionDays: 0, flushDelayMs: 10_000, retryDelayMs: 0, now: () => now });
    log.record({ action: 'auth.login', actor: TOKEN_ACTOR, target: { type: 'user', label: 'october' } });
    now = Date.parse('2026-11-01T00:00:00.100Z');
    log.record({ action: 'auth.login', actor: TOKEN_ACTOR, target: { type: 'user', label: 'november' } });
    for (let i = 0; i < 4; i++) await log.flush();
    const october = join(dir, 'activity-2026-10.jsonl');
    const lines = () => readFileSync(october, 'utf8').split('\n').filter(Boolean);
    expect(lines()).toHaveLength(1);
    expect(log.droppedCount()).toBe(1);

    // a write cut short in the middle of the month's file (not only at startup): cut off, then appended after
    appendFileSync(october, '{"id":"act_torn","at":"2026-10-31T23:59:59.950Z","actor');
    // (an explicit stamp: the generator keeps stamps monotonic, it would move this one into November)
    const later: ActivityEntry = { ...entry(Date.parse('2026-10-31T23:59:59.990Z')), id: 'act_later_in_october', at: '2026-10-31T23:59:59.990Z' };
    await store.append([later]);
    expect(lines()).toHaveLength(2);
    expect(lines().every((l) => JSON.parse(l).id)).toBe(true);
    rmSync(join(dir, 'activity-2026-11.jsonl'), { recursive: true });
    expect((await store.list({ limit: 10 })).items.map((e) => e.targetLabel)).toEqual([later.targetLabel, 'october']);
  });

  it('one request reads a bounded part of the log: a rare filter answers in steps, walked with the cursor', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'solar-activity-scan-')), 'activity');
    const store = new FileActivityStore(dir, { scanLimit: 500 });
    await store.init();
    const start = Date.parse('2026-10-01T00:00:00.000Z');
    const all = Array.from({ length: 5_000 }, (_, i) => entry(start + i * 60_000, { actorId: i % 700 === 0 ? 'usr_rare' : 'usr_busy' }));
    for (let i = 0; i < all.length; i += 1000) await store.append(all.slice(i, i + 1000));
    const wanted = [...all].reverse().filter((e) => e.actorId === 'usr_rare');

    const first = await store.list({ limit: 50, actorId: 'usr_rare' });
    expect(first.items.length).toBeLessThan(wanted.length);
    expect(first.next).not.toBeNull();
    const seen: string[] = [...first.items.map((e) => e.id)];
    let before = first.next ?? undefined;
    let requests = 1;
    while (before) {
      const page = await store.list({ limit: 50, actorId: 'usr_rare', before });
      seen.push(...page.items.map((e) => e.id));
      before = page.next ?? undefined;
      requests += 1;
    }
    expect(seen).toEqual(wanted.map((e) => e.id));
    expect(requests).toBeGreaterThanOrEqual(10);
    // nothing matching: an empty page with a cursor, not a read of the whole log
    const none = await store.list({ limit: 50, actorId: 'usr_nobody' });
    expect(none.items).toEqual([]);
    expect(none.next).not.toBeNull();
  });

  it('cursors and `to` are found by binary search: any position, ties within one millisecond', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'solar-activity-seek-')), 'activity');
    const store = new FileActivityStore(dir);
    await store.init();
    const start = Date.parse('2026-10-05T00:00:00.000Z');
    // ten entries per millisecond, some with long details (lines of different lengths)
    const all = Array.from({ length: 3_000 }, (_, i) => entry(start + Math.floor(i / 10), { details: i % 7 === 0 ? { note: 'n'.repeat(i % 290) } : null }));
    await store.append(all);
    for (let n = 0; n < 60; n++) {
      const i = 1 + ((n * 997) % (all.length - 1));
      const page = await store.list({ limit: 5, before: { at: all[i]!.at, id: all[i]!.id } });
      expect(page.items.map((e) => e.id)).toEqual(all.slice(Math.max(0, i - 5), i).reverse().map((e) => e.id));
      const to = await store.list({ limit: 3, to: all[i]!.at });
      expect(to.items.map((e) => e.id)).toEqual(all.filter((e) => e.at < all[i]!.at).slice(-3).reverse().map((e) => e.id));
    }
    expect((await store.list({ limit: 5, before: { at: all[0]!.at, id: all[0]!.id } })).items).toEqual([]);
    expect((await store.list({ limit: 1, before: { at: '2027-01-01T00:00:00.000Z', id: 'act_x' } })).items[0]!.id).toBe(all.at(-1)!.id);
  });
});
