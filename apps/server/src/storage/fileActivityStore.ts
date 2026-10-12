import { appendFile, mkdir, open, readdir, rm, stat, truncate, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import type { ActivityEntry } from '@solar/shared';
import { KeyedQueue, writeFileAtomic } from '../util/fs.js';
import { ActivityPartialWriteError, type ActivityCursor, type ActivityQuery } from './repository.js';

/** Holds IP addresses and user names: readable by the server's own OS user only. */
const PRIVATE_FILE = 0o600;
const PRIVATE_DIR = 0o700;
/** Bytes read per step when reading a run backwards. */
const CHUNK = 256 * 1024;
/** Bytes read per step when looking for a line (seeking). */
const PROBE = 8 * 1024;
const NEWLINE = 0x0a;

/** Lines a page reads at most by default before it answers with what it found and a cursor to go on from. */
export const DEFAULT_SCAN_LIMIT = 10_000;
/** Ids of the entries this process appended last, remembered so that a batch written again is not stored twice. */
const RECENT_IDS = 20_000;
/** The key of the queue that serialises every change of the files (appends, retention). */
const WRITE = 'write';

/**
 * A month's runs: `activity-2026-10.jsonl` (run 0), `activity-2026-10.1.jsonl`, `activity-2026-10.2.jsonl`... Each
 * run holds its lines in ascending (at, id) order; a month normally has one, a new run starts only when an entry would
 * break that order (the clock was set back, or the server restarted within the same millisecond).
 */
const SEGMENT = /^activity-(\d{4}-\d{2})(?:\.(\d{1,6}))?\.jsonl$/;

/** Every line starts with the id and the time (written in that order), read without parsing. */
const LINE_HEAD = /^\{"id":"([^"]+)","at":"([^"]+)"/;

const monthOf = (iso: string) => iso.slice(0, 7);

interface Key {
  at: string;
  id: string;
}

/** Order of (at, id): the order of the log (newest = greatest). */
function compareKeys(a: Key, b: Key): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
}

function keyOf(line: string): Key | null {
  const head = LINE_HEAD.exec(line);
  return head ? { id: head[1]!, at: head[2]! } : null;
}

interface Run {
  file: string;
  month: string;
  run: number;
}

function runOf(file: string): Run | null {
  const m = SEGMENT.exec(file);
  return m ? { file, month: m[1]!, run: m[2] === undefined ? 0 : Number(m[2]) } : null;
}

const runFile = (month: string, run: number) => (run === 0 ? `activity-${month}.jsonl` : `activity-${month}.${run}.jsonl`);

/** The stored line of an entry: id and time first (LINE_HEAD), whatever order the object was built in. */
function lineOf(e: ActivityEntry): string {
  const { id, at, ...rest } = e;
  return JSON.stringify({ id, at, ...rest });
}

async function openIfExists(path: string): Promise<FileHandle | null> {
  try {
    return await open(path, 'r');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

/**
 * The lines of a file before byte `end`, from the last to the first, as raw strings (a line is decoded only once
 * complete, so multi-byte characters split across chunks stay intact). A last line without its newline (a write cut
 * short by a crash) is returned like the others; the caller skips what does not parse.
 */
async function* linesBackward(handle: FileHandle, end: number): AsyncGenerator<string> {
  let position = end;
  let carry: Buffer = Buffer.alloc(0);
  while (position > 0) {
    const length = Math.min(CHUNK, position);
    position -= length;
    const chunk = await readAt(handle, position, length);
    const buffer = carry.length ? Buffer.concat([chunk, carry]) : chunk;
    let stop = buffer.length;
    for (let i = buffer.length - 1; i >= 0; i--) {
      if (buffer[i] !== NEWLINE) continue;
      if (stop > i + 1) yield buffer.toString('utf8', i + 1, stop);
      stop = i;
    }
    carry = buffer.subarray(0, stop);
  }
  if (carry.length) yield carry.toString('utf8');
}

/** The next line that has a key, newest first. */
async function nextKeyed(lines: AsyncGenerator<string>): Promise<{ key: Key; line: string } | null> {
  for (;;) {
    const r = await lines.next();
    if (r.done) return null;
    const key = keyOf(r.value);
    if (key) return { key, line: r.value };
  }
}

/** The first line start at or after `from` and before `limit` (0 and every byte after a newline); `limit` if none. */
async function lineStartFrom(handle: FileHandle, from: number, limit: number): Promise<number> {
  if (from <= 0) return 0;
  let position = from - 1;
  while (position < limit) {
    const chunk = await readAt(handle, position, Math.min(PROBE, limit - position));
    if (chunk.length === 0) return limit;
    const i = chunk.indexOf(NEWLINE);
    if (i >= 0) return Math.min(position + i + 1, limit);
    position += chunk.length;
  }
  return limit;
}

/** The key of the line starting at `start`, and where the next line starts (`size` after the last one). */
async function lineAt(handle: FileHandle, start: number, size: number): Promise<{ key: Key | null; end: number }> {
  let position = start;
  let head: Buffer | null = null;
  while (position < size) {
    const chunk = await readAt(handle, position, Math.min(PROBE, size - position));
    if (chunk.length === 0) break;
    head ??= chunk;
    const i = chunk.indexOf(NEWLINE);
    if (i >= 0) return { key: keyOf(head.toString('utf8', 0, Math.min(head.length, 512))), end: position + i + 1 };
    position += chunk.length;
  }
  return { key: head ? keyOf(head.toString('utf8', 0, Math.min(head.length, 512))) : null, end: size };
}

/**
 * Byte offset of the first line of a run whose key is not before `bound` (binary search: a run is in ascending key
 * order), so that reading backwards from it yields exactly the lines before `bound`. A line without a key counts as
 * older. A few reads of a few kilobytes whatever the size of the file.
 */
async function seek(handle: FileHandle, size: number, bound: Key): Promise<number> {
  // invariant: lo is a line start and every line before it is older than bound; the line at hi (if any) is not
  let lo = 0;
  let hi = size;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    const start = await lineStartFrom(handle, mid, hi);
    if (start >= hi) {
      // no line starts in [mid, hi): the few lines from lo decide
      for (let position = lo; position < hi; ) {
        const line = await lineAt(handle, position, size);
        if (line.key && compareKeys(line.key, bound) >= 0) return position;
        position = line.end;
      }
      return hi;
    }
    const line = await lineAt(handle, start, size);
    if (!line.key || compareKeys(line.key, bound) < 0) lo = line.end;
    else hi = start;
  }
  return lo;
}

/** The key of the last complete line of a file with a key (null for an empty file). */
async function lastKey(path: string): Promise<Key | null> {
  const handle = await openIfExists(path);
  if (!handle) return null;
  try {
    const lines = linesBackward(handle, (await handle.stat()).size);
    const last = await nextKeyed(lines);
    await lines.return(undefined);
    return last?.key ?? null;
  } finally {
    await handle.close();
  }
}

/** Number of lines of a file. */
async function countLines(path: string): Promise<number> {
  const handle = await openIfExists(path);
  if (!handle) return 0;
  try {
    let n = 0;
    for await (const _line of linesBackward(handle, (await handle.stat()).size)) n += 1;
    return n;
  } finally {
    await handle.close();
  }
}

export interface FileActivityStoreOptions {
  /** Lines one `list` reads at most before answering with a cursor (default DEFAULT_SCAN_LIMIT). */
  scanLimit?: number;
}

/**
 * The activity log of the file storage: append-only JSON lines in `<dataDir>/activity/`, one file ("run") per month
 * (rotation) and more only when the clock went back, mode 0600.
 *
 * - Order: each run is in ascending (at, id) order. An entry that would break it (the clock was set back - by NTP, a
 *   user fixing the time, a dual-boot computer -, also across a restart) goes to another run of its month, so pages
 *   are always newest first by (at, id), exactly like the Postgres backend.
 * - Appends: one append write per run, serialised; before it, a torn last line (a write cut short) is cut off, and a
 *   write that fails is undone (the file is cut back to its size before), so a retried batch never leaves duplicates
 *   or joined lines. Entries already written by this process (by id) are skipped: appends are idempotent.
 * - Reads: newest first, reading the runs of a month backwards from their end and merging them. A cursor or `to` is
 *   found by binary search (a few small reads, whatever the depth of the page), a `from` ends the scan, and cheap text
 *   checks avoid parsing lines that cannot match. A page reads at most `scanLimit` lines: a rare filter (a staff
 *   member's own entries in a large log, a text search) answers with what it found so far and a cursor to go on from,
 *   so no request reads the whole log.
 * - Retention: whole month files older than the cutoff are deleted; the runs of the cutoff's month are rewritten
 *   without their older lines (temp file + rename).
 */
export class FileActivityStore {
  private readonly queue = new KeyedQueue();
  private readonly scanLimit: number;
  /** Every run file and the key of its last line (null: empty): where the next entry of a month may go. */
  private readonly tails = new Map<string, Key | null>();
  private readonly recent = new Set<string>();
  private readonly recentRing: Array<string | undefined> = new Array<string | undefined>(RECENT_IDS);
  private recentPos = 0;

  constructor(
    private readonly dir: string,
    options: FileActivityStoreOptions = {},
  ) {
    this.scanLimit = Math.max(1, Math.floor(options.scanLimit ?? DEFAULT_SCAN_LIMIT));
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: PRIVATE_DIR });
    await this.queue.run(WRITE, async () => {
      this.tails.clear();
      for (const run of await this.runs()) {
        const path = join(this.dir, run.file);
        const info = await stat(path);
        if (!info.isFile()) continue;
        await repairTail(path, info.size);
        this.tails.set(run.file, await lastKey(path));
      }
    });
  }

  /** Run files, newest month first (runs of a month in run order). */
  private async runs(): Promise<Run[]> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    return files
      .map(runOf)
      .filter((r): r is Run => r !== null)
      .sort((a, b) => (a.month !== b.month ? (a.month < b.month ? 1 : -1) : a.run - b.run));
  }

  /** Run files grouped by month, newest month first. */
  private async months(): Promise<Array<[string, Run[]]>> {
    const months = new Map<string, Run[]>();
    for (const run of await this.runs()) months.set(run.month, [...(months.get(run.month) ?? []), run]);
    return [...months];
  }

  private remember(id: string): void {
    const old = this.recentRing[this.recentPos];
    if (old !== undefined) this.recent.delete(old);
    this.recentRing[this.recentPos] = id;
    this.recentPos = (this.recentPos + 1) % RECENT_IDS;
    this.recent.add(id);
  }

  /** The run of `month` an entry with `key` goes to: the one whose last line is the latest still older; else a new run. */
  private runFor(month: string, key: Key, tails: Map<string, Key | null>): string {
    let best: string | null = null;
    let bestTail: Key | null = null;
    let lastRun = -1;
    for (const [file, tail] of tails) {
      const run = runOf(file);
      if (!run || run.month !== month) continue;
      lastRun = Math.max(lastRun, run.run);
      if (tail && compareKeys(tail, key) >= 0) continue;
      if (best === null || (tail && (!bestTail || compareKeys(tail, bestTail) > 0))) {
        best = file;
        bestTail = tail;
      }
    }
    return best ?? runFile(month, lastRun + 1);
  }

  /**
   * Appends a batch. When one run file cannot be written after others were, throws an ActivityPartialWriteError with
   * the ids that are stored (those of the written files and those skipped as already written).
   */
  async append(entries: ActivityEntry[]): Promise<void> {
    await this.queue.run(WRITE, async () => {
      const plan = new Map<string, { lines: string[]; ids: string[]; last: Key }>();
      const tails = new Map(this.tails);
      const stored = new Set<string>();
      for (const e of entries) {
        // already written (a batch written again after a failure further on): skipped
        if (this.recent.has(e.id)) {
          stored.add(e.id);
          continue;
        }
        const key = { at: e.at, id: e.id };
        const file = this.runFor(monthOf(e.at), key, tails);
        tails.set(file, key);
        const p = plan.get(file) ?? { lines: [], ids: [], last: key };
        p.lines.push(lineOf(e));
        p.ids.push(e.id);
        p.last = key;
        plan.set(file, p);
      }
      for (const [file, p] of plan) {
        try {
          await this.appendLines(join(this.dir, file), p.lines);
        } catch (err) {
          throw stored.size > 0 ? new ActivityPartialWriteError(stored, err) : err;
        }
        this.tails.set(file, p.last);
        for (const id of p.ids) {
          this.remember(id);
          stored.add(id);
        }
      }
    });
  }

  /** Appends whole lines to a file: after its last complete line, and nothing of them when the write fails. */
  private async appendLines(path: string, lines: string[]): Promise<void> {
    let size: number | null;
    try {
      size = (await stat(path)).size;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      size = null;
    }
    if (size) size = await repairTail(path, size);
    try {
      await appendFile(path, `${lines.join('\n')}\n`, { mode: PRIVATE_FILE });
    } catch (err) {
      // undo a partial write (e.g. the disk is full): the batch is retried as a whole
      await (size === null ? rm(path, { force: true }) : truncate(path, size)).catch(() => undefined);
      throw err;
    }
  }

  async list(q: ActivityQuery): Promise<{ items: ActivityEntry[]; next: ActivityCursor | null }> {
    const limit = Math.max(1, Math.min(1000, Math.floor(q.limit)));
    const items: ActivityEntry[] = [];
    // necessary conditions on the raw line, checked before parsing it
    const needles: string[] = [];
    if (q.actorId !== undefined) needles.push(`"actorId":${JSON.stringify(q.actorId)}`);
    if (q.outcome) needles.push(`"outcome":"${q.outcome}"`);
    const actionNeedles = (q.actions ?? []).map((a) => `"action":${JSON.stringify(a)}`);
    for (const p of q.actionPrefixes ?? []) actionNeedles.push(`"action":${JSON.stringify(p).slice(0, -1)}`);
    const text = q.q?.toLowerCase();
    // JSON escapes quotes, backslashes and control characters: such a search text is only checked after parsing
    const rawText = text && !/["\\\u0000-\u001f]/.test(text) ? text : undefined;

    // the page holds only lines before this key: the cursor and/or `to` (at < to)
    let bound: Key | null = q.before ? { at: q.before.at, id: q.before.id } : null;
    if (q.to && (!bound || compareKeys({ at: q.to, id: '' }, bound) < 0)) bound = { at: q.to, id: '' };
    const boundMonth = bound ? monthOf(bound.at) : null;
    const fromMonth = q.from ? monthOf(q.from) : null;

    let scanned = 0;
    let lastScanned: Key | null = null;
    for (const [month, runs] of await this.months()) {
      if (boundMonth && month > boundMonth) continue;
      if (fromMonth && month < fromMonth) break;
      const readers: Array<{ handle: FileHandle; lines: AsyncGenerator<string> | null; head: { key: Key; line: string } | null }> = [];
      try {
        for (const run of runs) {
          const handle = await openIfExists(join(this.dir, run.file));
          if (!handle) continue;
          const reader: (typeof readers)[number] = { handle, lines: null, head: null };
          readers.push(reader);
          const size = (await handle.stat()).size;
          const end = bound && month === boundMonth ? await seek(handle, size, bound) : size;
          reader.lines = linesBackward(handle, end);
          reader.head = await nextKeyed(reader.lines);
        }
        for (;;) {
          // the newest line of the month's runs
          let newest: (typeof readers)[number] | null = null;
          for (const r of readers) if (r.head && (!newest || compareKeys(r.head.key, newest.head!.key) > 0)) newest = r;
          if (!newest) break;
          const { key, line } = newest.head!;
          // newest first: everything after this is older still
          if (q.from && key.at < q.from) return { items, next: null };
          // read enough for one request: the rest is for the next one
          if (scanned >= this.scanLimit && lastScanned) return { items, next: lastScanned };
          scanned += 1;
          lastScanned = key;
          newest.head = await nextKeyed(newest.lines!);
          if (bound && compareKeys(key, bound) >= 0) continue;
          if (!needles.every((n) => line.includes(n))) continue;
          if (actionNeedles.length && !actionNeedles.some((n) => line.includes(n))) continue;
          if (rawText && !line.toLowerCase().includes(rawText)) continue;
          let entry: ActivityEntry;
          try {
            entry = JSON.parse(line) as ActivityEntry;
          } catch {
            continue; // a torn line
          }
          if (!matches(entry, q, text)) continue;
          if (items.length === limit) {
            const last = items[items.length - 1]!;
            return { items, next: { at: last.at, id: last.id } };
          }
          items.push(entry);
        }
      } finally {
        for (const r of readers) {
          await r.lines?.return(undefined);
          await r.handle.close();
        }
      }
    }
    return { items, next: null };
  }

  async deleteBefore(cutoffIso: string): Promise<number> {
    const cutoffMonth = monthOf(cutoffIso);
    return this.queue.run(WRITE, async () => {
      let removed = 0;
      for (const run of await this.runs()) {
        if (run.month > cutoffMonth) continue;
        const path = join(this.dir, run.file);
        if (run.month < cutoffMonth) {
          removed += await countLines(path);
          await rm(path, { force: true });
          this.tails.delete(run.file);
          continue;
        }
        const handle = await openIfExists(path);
        if (!handle) continue;
        const kept: string[] = [];
        let dropped = 0;
        try {
          for await (const line of linesBackward(handle, (await handle.stat()).size)) {
            const key = keyOf(line);
            if (key && key.at >= cutoffIso) kept.push(line);
            else dropped += 1;
          }
        } finally {
          await handle.close();
        }
        if (dropped === 0) continue;
        removed += dropped;
        if (kept.length === 0) {
          await rm(path, { force: true });
          this.tails.delete(run.file);
        } else {
          this.tails.set(run.file, keyOf(kept[0]!));
          await writeFileAtomic(path, `${kept.reverse().join('\n')}\n`, { mode: PRIVATE_FILE });
        }
      }
      return removed;
    });
  }

  /** Bytes on disk (tests, diagnostics). */
  async size(): Promise<number> {
    let total = 0;
    for (const run of await this.runs()) total += (await stat(join(this.dir, run.file))).size;
    return total;
  }
}

/**
 * Cuts off a last line without its newline (an append cut short), so that the next append starts on a line of its
 * own; returns the size of the file afterwards.
 */
async function repairTail(path: string, size: number): Promise<number> {
  if (size === 0) return 0;
  const handle = await open(path, 'r');
  let keep = 0;
  try {
    const last = await readAt(handle, size - 1, 1);
    if (last[0] === NEWLINE) return size;
    // the last newline
    let position = size;
    while (position > 0 && keep === 0) {
      const length = Math.min(CHUNK, position);
      position -= length;
      const chunk = await readAt(handle, position, length);
      const i = chunk.lastIndexOf(NEWLINE);
      if (i >= 0) keep = position + i + 1;
    }
  } finally {
    await handle.close();
  }
  await truncate(path, keep);
  return keep;
}

/** The filters on a parsed entry (the raw-line checks are only necessary conditions). */
function matches(e: ActivityEntry, q: ActivityQuery, text: string | undefined): boolean {
  if (q.actorId !== undefined && e.actorId !== q.actorId) return false;
  if (q.outcome && e.outcome !== q.outcome) return false;
  if (q.actions?.length || q.actionPrefixes?.length) {
    const ok = (q.actions ?? []).includes(e.action) || (q.actionPrefixes ?? []).some((p) => e.action.startsWith(p));
    if (!ok) return false;
  }
  if (text) {
    const fields = [e.actorName, e.targetLabel, e.targetId, e.action, e.details ? JSON.stringify(e.details) : null];
    if (!fields.some((f) => f?.toLowerCase().includes(text))) return false;
  }
  return true;
}
