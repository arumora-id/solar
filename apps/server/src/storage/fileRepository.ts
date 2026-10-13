import { appendFile, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ActivityEntry, Artifact, Attachment, Confirmation, Task, TaskEvent, TaskStats, User, UserStatus } from '@solar/shared';
import { KeyedQueue, writeFileAtomic } from '../util/fs.js';
import { FileActivityStore } from './fileActivityStore.js';
import {
  emptyStats,
  type ActivityCursor,
  type ActivityQuery,
  type CreateUserResult,
  type ListTasksOptions,
  type Repository,
  type StoredSession,
  type StoredUser,
  type UserPatch,
} from './repository.js';

interface TaskRecord {
  task: Task;
  events: TaskEvent[] | null; // lazily loaded
  artifacts: Artifact[];
  confirmations: Confirmation[];
}

/** Files holding password hashes and session hashes: readable by the server's own OS user only. */
const PRIVATE_FILE = 0o600;

/**
 * Zero-configuration storage used when DATABASE_URL is not set.
 * Layout: <dataDir>/tasks/<taskId>.json, .events.jsonl, .artifacts.json, .confirmations.json,
 * <dataDir>/attachments/<attachmentId>.json (metadata; the files themselves live in the object store),
 * <dataDir>/users.json (accounts with password hashes), <dataDir>/sessions.json (hashes of login sessions) and
 * <dataDir>/activity/activity-<YYYY-MM>.jsonl (the activity log, one file per month - see FileActivityStore). Roles are
 * not stored: they are the code's (packages/shared ROLE_PERMISSIONS).
 */
export class FileRepository implements Repository {
  readonly kind = 'local-file' as const;
  private readonly dir: string;
  private readonly records = new Map<string, TaskRecord>();
  private readonly artifactIndex = new Map<string, Artifact>();
  private readonly attachments = new Map<string, Attachment>();
  private readonly attachmentDir: string;
  private readonly usersFile: string;
  private readonly sessionsFile: string;
  private readonly users = new Map<string, StoredUser>();
  private readonly sessions = new Map<string, StoredSession>();
  private readonly queue = new KeyedQueue();
  private readonly activity: FileActivityStore;

  constructor(dataDir: string) {
    this.activity = new FileActivityStore(join(dataDir, 'activity'));
    this.dir = join(dataDir, 'tasks');
    this.attachmentDir = join(dataDir, 'attachments');
    this.usersFile = join(dataDir, 'users.json');
    this.sessionsFile = join(dataDir, 'sessions.json');
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await mkdir(this.attachmentDir, { recursive: true });
    await this.activity.init();
    // accounts must load or the server must not start: an unreadable users.json silently treated as "no users" would
    // reopen the first-superadmin setup to whoever comes first
    for (const u of await readJsonFile<StoredUser[]>(this.usersFile, [], true)) this.users.set(u.id, u);
    // sessions are disposable: an unreadable file only logs everybody out
    for (const s of await readJsonFile<StoredSession[]>(this.sessionsFile, [], false)) this.sessions.set(s.tokenHash, s);
    for (const file of await readdir(this.attachmentDir)) {
      if (!/^att_[A-Za-z0-9]+\.json$/.test(file)) continue;
      try {
        const a = JSON.parse(await readFile(join(this.attachmentDir, file), 'utf8')) as Attachment;
        this.attachments.set(a.id, a);
      } catch {
        // skip unreadable metadata instead of refusing to start
      }
    }
    const files = await readdir(this.dir);
    for (const file of files) {
      if (!/^[A-Za-z0-9_-]+\.json$/.test(file)) continue;
      const id = file.slice(0, -'.json'.length);
      try {
        const stored = JSON.parse(await readFile(join(this.dir, file), 'utf8')) as Task;
        // tasks written before attachments existed have no attachmentIds; before languages existed tasks were Indonesian
        const task: Task = { ...stored, attachmentIds: stored.attachmentIds ?? [], language: stored.language === 'en' ? 'en' : 'id' };
        const artifacts = await this.readJson<Artifact[]>(`${id}.artifacts.json`, []);
        const confirmations = await this.readJson<Confirmation[]>(`${id}.confirmations.json`, []);
        this.records.set(id, { task, events: null, artifacts, confirmations });
        for (const a of artifacts) this.artifactIndex.set(a.id, a);
      } catch {
        // skip unreadable task files instead of refusing to start
      }
    }
  }

  async close(): Promise<void> {
    // nothing to release
  }

  private async readJson<T>(name: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await readFile(join(this.dir, name), 'utf8')) as T;
    } catch {
      return fallback;
    }
  }

  private persist(name: string, value: unknown): Promise<void> {
    return this.queue.run(name, () => writeFileAtomic(join(this.dir, name), JSON.stringify(value, null, 2)));
  }

  async upsertTask(task: Task): Promise<void> {
    const existing = this.records.get(task.id);
    // the owner is set once, when the task is created (an update never moves a task to another user)
    const stored: Task = { ...task, owner: undefined, ownerId: existing ? existing.task.ownerId : task.ownerId };
    delete stored.owner;
    if (stored.ownerId === undefined) delete stored.ownerId;
    if (existing) existing.task = stored;
    else this.records.set(task.id, { task: stored, events: [], artifacts: [], confirmations: [] });
    await this.persist(`${task.id}.json`, stored);
  }

  async getTask(id: string): Promise<Task | null> {
    const r = this.records.get(id);
    return r ? { ...r.task } : null;
  }

  async listTasks(options: ListTasksOptions): Promise<Task[]> {
    let tasks = [...this.records.values()].map((r) => r.task);
    if (options.sessionId) tasks = tasks.filter((t) => t.sessionId === options.sessionId);
    if (options.status) tasks = tasks.filter((t) => t.status === options.status);
    if (options.ownerId !== undefined) tasks = tasks.filter((t) => (t.ownerId ?? null) === options.ownerId);
    tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const offset = options.offset ?? 0;
    return tasks.slice(offset, offset + options.limit).map((t) => ({ ...t }));
  }

  async stats(filter: { ownerId?: string } = {}): Promise<TaskStats> {
    const stats = emptyStats();
    for (const { task } of this.records.values()) {
      if (filter.ownerId !== undefined && task.ownerId !== filter.ownerId) continue;
      stats.total += 1;
      stats.byStatus[task.status] += 1;
      stats.costUsd += task.usage.costUsd;
    }
    return stats;
  }

  async appendEvent(event: TaskEvent): Promise<void> {
    const record = this.records.get(event.taskId);
    if (record?.events) record.events.push(event);
    const file = join(this.dir, `${event.taskId}.events.jsonl`);
    await this.queue.run(file, () => appendFile(file, `${JSON.stringify(event)}\n`));
  }

  async listEvents(taskId: string): Promise<TaskEvent[]> {
    const record = this.records.get(taskId);
    if (!record) return [];
    if (!record.events) {
      const file = join(this.dir, `${taskId}.events.jsonl`);
      const events: TaskEvent[] = [];
      try {
        const raw = await this.queue.run(file, () => readFile(file, 'utf8'));
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue;
          try {
            events.push(JSON.parse(line) as TaskEvent);
          } catch {
            // a torn last line after a crash is skipped
          }
        }
      } catch {
        // no events yet
      }
      record.events = events;
    }
    return [...record.events].sort((a, b) => a.seq - b.seq);
  }

  async saveArtifact(artifact: Artifact): Promise<void> {
    const record = this.records.get(artifact.taskId);
    if (!record) throw new Error(`Task ${artifact.taskId} not found`);
    record.artifacts = [...record.artifacts.filter((a) => a.id !== artifact.id), artifact];
    this.artifactIndex.set(artifact.id, artifact);
    await this.persist(`${artifact.taskId}.artifacts.json`, record.artifacts);
  }

  async getArtifact(id: string): Promise<Artifact | null> {
    return this.artifactIndex.get(id) ?? null;
  }

  async listArtifacts(taskId: string): Promise<Artifact[]> {
    return [...(this.records.get(taskId)?.artifacts ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async upsertConfirmation(confirmation: Confirmation): Promise<void> {
    const record = this.records.get(confirmation.taskId);
    if (!record) throw new Error(`Task ${confirmation.taskId} not found`);
    record.confirmations = [...record.confirmations.filter((c) => c.id !== confirmation.id), confirmation];
    await this.persist(`${confirmation.taskId}.confirmations.json`, record.confirmations);
  }

  async saveAttachment(attachment: Attachment): Promise<void> {
    this.attachments.set(attachment.id, attachment);
    await this.queue.run(attachment.id, () => writeFileAtomic(join(this.attachmentDir, `${attachment.id}.json`), JSON.stringify(attachment, null, 2)));
  }

  async getAttachment(id: string): Promise<Attachment | null> {
    return this.attachments.get(id) ?? null;
  }

  async listAttachments(filter: { sessionId?: string; ids?: string[] }): Promise<Attachment[]> {
    let list = [...this.attachments.values()];
    if (filter.sessionId) list = list.filter((a) => a.sessionId === filter.sessionId);
    if (filter.ids) {
      const ids = new Set(filter.ids);
      list = list.filter((a) => ids.has(a.id));
    }
    return list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async deleteAttachment(id: string): Promise<void> {
    this.attachments.delete(id);
    await this.queue.run(id, () => rm(join(this.attachmentDir, `${id}.json`), { force: true }));
  }

  async isAttachmentReferenced(id: string): Promise<boolean> {
    for (const { task } of this.records.values()) if (task.attachmentIds.includes(id)) return true;
    return false;
  }

  async listConfirmations(filter: { taskId?: string; status?: Confirmation['status'] }): Promise<Confirmation[]> {
    const source = filter.taskId
      ? (this.records.get(filter.taskId)?.confirmations ?? [])
      : [...this.records.values()].flatMap((r) => r.confirmations);
    return source
      .filter((c) => !filter.status || c.status === filter.status)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // ---- user accounts ------------------------------------------------------------------------------------------

  private persistUsers(): Promise<void> {
    return this.queue.run(this.usersFile, () =>
      writeFileAtomic(this.usersFile, JSON.stringify([...this.users.values()], null, 2), { mode: PRIVATE_FILE }),
    );
  }

  private persistSessions(): Promise<void> {
    return this.queue.run(this.sessionsFile, () =>
      writeFileAtomic(this.sessionsFile, JSON.stringify([...this.sessions.values()], null, 2), { mode: PRIVATE_FILE }),
    );
  }

  /** Runs `op` alone among the account changes (the uniqueness checks and the "no account yet" check need it). */
  private exclusive<T>(op: () => Promise<T>): Promise<T> {
    return this.queue.run('users:lock', op);
  }

  private taken(user: StoredUser): CreateUserResult | null {
    for (const u of this.users.values()) {
      if (u.username.toLowerCase() === user.username.toLowerCase()) return 'username-taken';
      if (u.email.toLowerCase() === user.email.toLowerCase()) return 'email-taken';
    }
    return null;
  }

  createUser(user: StoredUser): Promise<CreateUserResult> {
    return this.exclusive(async () => {
      const taken = this.taken(user);
      if (taken) return taken;
      this.users.set(user.id, { ...user });
      await this.persistUsers();
      return 'created';
    });
  }

  createFirstUser(user: StoredUser): Promise<boolean> {
    return this.exclusive(async () => {
      if (this.users.size > 0) return false;
      this.users.set(user.id, { ...user });
      await this.persistUsers();
      return true;
    });
  }

  async getUser(id: string): Promise<StoredUser | null> {
    const u = this.users.get(id);
    return u ? { ...u } : null;
  }

  async findUserByUsername(username: string): Promise<StoredUser | null> {
    const key = username.toLowerCase();
    for (const u of this.users.values()) if (u.username.toLowerCase() === key) return { ...u };
    return null;
  }

  async findUserByEmail(email: string): Promise<StoredUser | null> {
    const key = email.toLowerCase();
    for (const u of this.users.values()) if (u.email.toLowerCase() === key) return { ...u };
    return null;
  }

  async listUsers(filter: { status?: UserStatus } = {}): Promise<StoredUser[]> {
    return [...this.users.values()]
      .filter((u) => !filter.status || u.status === filter.status)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map((u) => ({ ...u }));
  }

  async countUsers(filter: { status?: UserStatus; role?: User['role'] } = {}): Promise<number> {
    let n = 0;
    for (const u of this.users.values()) if ((!filter.status || u.status === filter.status) && (!filter.role || u.role === filter.role)) n += 1;
    return n;
  }

  updateUser(id: string, patch: UserPatch): Promise<StoredUser | null> {
    return this.exclusive(async () => {
      const u = this.users.get(id);
      if (!u) return null;
      const updated: StoredUser = { ...u, ...patch };
      this.users.set(id, updated);
      await this.persistUsers();
      return { ...updated };
    });
  }

  deleteUser(id: string): Promise<boolean> {
    return this.exclusive(async () => {
      if (!this.users.delete(id)) return false;
      await this.persistUsers();
      let removed = false;
      for (const [hash, s] of this.sessions) {
        if (s.userId === id) {
          this.sessions.delete(hash);
          removed = true;
        }
      }
      if (removed) await this.persistSessions();
      return true;
    });
  }

  // ---- login sessions -----------------------------------------------------------------------------------------

  async createSession(session: StoredSession): Promise<void> {
    this.sessions.set(session.tokenHash, { ...session });
    await this.persistSessions();
  }

  async getSession(tokenHash: string): Promise<StoredSession | null> {
    const s = this.sessions.get(tokenHash);
    return s ? { ...s } : null;
  }

  async touchSession(tokenHash: string, lastSeenAt: string, expiresAt: string): Promise<void> {
    const s = this.sessions.get(tokenHash);
    if (!s) return;
    this.sessions.set(tokenHash, { ...s, lastSeenAt, expiresAt });
    await this.persistSessions();
  }

  async deleteSession(tokenHash: string): Promise<void> {
    if (this.sessions.delete(tokenHash)) await this.persistSessions();
  }

  async deleteUserSessions(userId: string, exceptTokenHash?: string): Promise<string[]> {
    const deleted: string[] = [];
    for (const [hash, s] of this.sessions) {
      if (s.userId === userId && hash !== exceptTokenHash) {
        this.sessions.delete(hash);
        deleted.push(hash);
      }
    }
    if (deleted.length) await this.persistSessions();
    return deleted;
  }

  async deleteExpiredSessions(nowIso: string): Promise<number> {
    let n = 0;
    for (const [hash, s] of this.sessions) {
      if (s.expiresAt <= nowIso) {
        this.sessions.delete(hash);
        n += 1;
      }
    }
    if (n) await this.persistSessions();
    return n;
  }

  // ---- activity log ---------------------------------------------------------------------------------------------

  appendActivity(entries: ActivityEntry[]): Promise<void> {
    return this.activity.append(entries);
  }

  listActivity(query: ActivityQuery): Promise<{ items: ActivityEntry[]; next: ActivityCursor | null }> {
    return this.activity.list(query);
  }

  deleteActivityBefore(cutoffIso: string): Promise<number> {
    return this.activity.deleteBefore(cutoffIso);
  }
}

/**
 * Reads a JSON array file; a missing file is the fallback. An unreadable or malformed file is the fallback too, unless
 * `required`: then it is an error (the server refuses to start rather than run without its accounts).
 */
async function readJsonFile<T>(path: string, fallback: T, required: boolean): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    if (required) throw err;
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as T;
    throw new Error('expected a JSON array');
  } catch (err) {
    if (required) throw new Error(`${path} is not valid (${(err as Error).message}); fix or restore it before starting SOLAR`);
    return fallback;
  }
}
