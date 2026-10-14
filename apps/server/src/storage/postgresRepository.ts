import pg from 'pg';
import type {
  ActivityActorKind,
  ActivityEntry,
  ActivityOutcome,
  ActivityTargetType,
  Artifact,
  Attachment,
  Confirmation,
  Role,
  Task,
  TaskEvent,
  TaskStats,
  TaskStatus,
  TaskUsage,
  User,
  UserStatus,
} from '@solar/shared';
import { EMPTY_USAGE } from '@solar/shared';
import {
  ActivityPartialWriteError,
  emptyStats,
  type ActivityCursor,
  type ActivityQuery,
  type CreateUserResult,
  type ListTasksOptions,
  type TaskListFilter,
  type Repository,
  type StoredSession,
  type StoredUser,
  type UserPatch,
} from './repository.js';
import { createLogger } from '../logger.js';
import { POSTGRES_SCHEMA, SCHEMA_LOCK } from './schema.js';

const log = createLogger('postgres');

/** Key of the transaction-level advisory lock that serialises the creation of the first account. */
const FIRST_USER_LOCK = 0x501a_0001;

const iso = (v: Date | string | null): string | null => (v === null ? null : new Date(v).toISOString());

type Row = Record<string, unknown>;

function toTask(r: Row): Task {
  return {
    id: r.id as string,
    sessionId: r.session_id as string,
    title: r.title as string,
    prompt: r.prompt as string,
    status: r.status as TaskStatus,
    progress: Number(r.progress),
    currentStep: (r.current_step as string | null) ?? null,
    model: r.model as string,
    createdAt: iso(r.created_at as Date)!,
    startedAt: iso(r.started_at as Date | null),
    finishedAt: iso(r.finished_at as Date | null),
    result: (r.result as string | null) ?? null,
    error: (r.error as string | null) ?? null,
    usage: { ...EMPTY_USAGE, ...((r.usage as Partial<TaskUsage> | null) ?? {}) },
    attachmentIds: (r.attachment_ids as string[] | null) ?? [],
    language: r.language === 'en' ? 'en' : 'id',
    ...(typeof r.owner_id === 'string' ? { ownerId: r.owner_id } : {}),
  };
}

function toUser(r: Row): StoredUser {
  return {
    id: r.id as string,
    username: r.username as string,
    email: r.email as string,
    name: r.name as string,
    role: r.role as Role,
    status: r.status as UserStatus,
    passwordHash: r.password_hash as string,
    createdAt: iso(r.created_at as Date)!,
    updatedAt: iso(r.updated_at as Date)!,
    lastLoginAt: iso(r.last_login_at as Date | null),
    approvedAt: iso(r.approved_at as Date | null),
    approvedBy: (r.approved_by as string | null) ?? null,
  };
}

function toSession(r: Row): StoredSession {
  return {
    tokenHash: r.token_hash as string,
    userId: r.user_id as string,
    createdAt: iso(r.created_at as Date)!,
    lastSeenAt: iso(r.last_seen_at as Date)!,
    expiresAt: iso(r.expires_at as Date)!,
    userAgent: (r.user_agent as string | null) ?? null,
    ip: (r.ip as string | null) ?? null,
  };
}

/** Columns of UserPatch fields. */
const USER_COLUMNS: Record<keyof UserPatch, string> = {
  name: 'name',
  role: 'role',
  status: 'status',
  passwordHash: 'password_hash',
  lastLoginAt: 'last_login_at',
  approvedAt: 'approved_at',
  approvedBy: 'approved_by',
  updatedAt: 'updated_at',
};

const USER_INSERT = `INSERT INTO solar_users (id, username, email, name, role, status, password_hash, created_at, updated_at,
  last_login_at, approved_at, approved_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`;

function userParams(u: StoredUser): unknown[] {
  return [u.id, u.username, u.email, u.name, u.role, u.status, u.passwordHash, u.createdAt, u.updatedAt, u.lastLoginAt, u.approvedAt, u.approvedBy];
}

function toAttachment(r: Row): Attachment {
  return {
    id: r.id as string,
    sessionId: r.session_id as string,
    name: r.name as string,
    kind: r.kind as Attachment['kind'],
    mimeType: r.mime_type as string,
    size: Number(r.size),
    parts: r.parts === null || r.parts === undefined ? null : Number(r.parts),
    chars: Number(r.chars),
    outline: (r.outline as string[] | null) ?? [],
    warnings: (r.warnings as string[] | null) ?? [],
    storageKey: r.storage_key as string,
    textKey: r.text_key as string,
    createdAt: iso(r.created_at as Date)!,
    ...(typeof r.owner_id === 'string' ? { ownerId: r.owner_id } : {}),
  };
}

function toArtifact(r: Row): Artifact {
  return {
    id: r.id as string,
    taskId: r.task_id as string,
    name: r.name as string,
    title: r.title as string,
    kind: r.kind as Artifact['kind'],
    mimeType: r.mime_type as string,
    size: Number(r.size),
    storageKey: r.storage_key as string,
    bundle: r.bundle as string,
    description: (r.description as string | null) ?? null,
    createdAt: iso(r.created_at as Date)!,
  };
}

function toConfirmation(r: Row): Confirmation {
  return {
    id: r.id as string,
    taskId: r.task_id as string,
    toolUseId: r.tool_use_id as string,
    tool: r.tool as string,
    displayName: r.display_name as string,
    pluginId: (r.plugin_id as string | null) ?? null,
    pluginName: (r.plugin_name as string | null) ?? null,
    reason: r.reason as string,
    input: r.input ?? null,
    status: r.status as Confirmation['status'],
    createdAt: iso(r.created_at as Date)!,
    resolvedAt: iso(r.resolved_at as Date | null),
    note: (r.note as string | null) ?? null,
  };
}

/** An error about the values of a statement (SQLSTATE class 22, 23 or 54), not about the connection or the server. */
function isDataError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^(22|23|54)[0-9A-Z]{3}$/.test(code);
}

/** Escapes LIKE / ILIKE wildcards (the default escape character is the backslash). */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function toActivity(r: Row): ActivityEntry {
  return {
    id: r.id as string,
    at: iso(r.at as Date)!,
    actorId: (r.actor_id as string | null) ?? null,
    actorName: (r.actor_name as string | null) ?? null,
    actorRole: (r.actor_role as Role | null) ?? null,
    actorKind: r.actor_kind as ActivityActorKind,
    action: r.action as ActivityEntry['action'],
    targetType: (r.target_type as ActivityTargetType | null) ?? null,
    targetId: (r.target_id as string | null) ?? null,
    targetLabel: (r.target_label as string | null) ?? null,
    outcome: r.outcome as ActivityOutcome,
    ip: (r.ip as string | null) ?? null,
    userAgent: (r.user_agent as string | null) ?? null,
    details: (r.details as Record<string, unknown> | null) ?? null,
  };
}

/** Neon (serverless Postgres) storage. Any Postgres 13+ works the same way. */
export class PostgresRepository implements Repository {
  readonly kind = 'neon-postgres' as const;
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
    });
    // Neon closes idle connections; an error on an idle client must not crash the process.
    this.pool.on('error', () => undefined);
  }

  /**
   * Creates or updates the schema (storage/schema.ts): every statement in order, in one transaction under an advisory
   * lock, so servers starting at the same time migrate one after the other and a failed start leaves nothing half done.
   */
  async init(): Promise<void> {
    const client = await this.pool.connect();
    // the schema's own warnings (e.g. accounts with a role the code does not know) go to the server log
    const onNotice = (notice: { severity?: string; message?: string }) => {
      if (notice.severity === 'WARNING') log.warn(`Database schema: ${notice.message ?? ''}`);
    };
    client.on('notice', onNotice);
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_LOCK]);
      for (const statement of POSTGRES_SCHEMA) await client.query(statement);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.off('notice', onNotice);
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async upsertTask(t: Task): Promise<void> {
    await this.pool.query(
      `INSERT INTO solar_tasks (id, session_id, title, prompt, status, progress, current_step, model, created_at,
         started_at, finished_at, result, error, usage, attachment_ids, language, owner_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title, status = EXCLUDED.status, progress = EXCLUDED.progress,
         current_step = EXCLUDED.current_step, started_at = EXCLUDED.started_at,
         finished_at = EXCLUDED.finished_at, result = EXCLUDED.result, error = EXCLUDED.error,
         usage = EXCLUDED.usage`,
      [
        t.id,
        t.sessionId,
        t.title,
        t.prompt,
        t.status,
        Math.round(t.progress),
        t.currentStep,
        t.model,
        t.createdAt,
        t.startedAt,
        t.finishedAt,
        t.result,
        t.error,
        JSON.stringify(t.usage),
        JSON.stringify(t.attachmentIds ?? []),
        t.language === 'en' ? 'en' : 'id',
        // written on creation only: the ON CONFLICT update above leaves the owner as it is
        t.ownerId ?? null,
      ],
    );
  }

  async getTask(id: string): Promise<Task | null> {
    const { rows } = await this.pool.query('SELECT * FROM solar_tasks WHERE id = $1', [id]);
    return rows[0] ? toTask(rows[0]) : null;
  }

  private taskConditions(o: TaskListFilter): { where: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (o.sessionId) {
      params.push(o.sessionId);
      clauses.push(`session_id = $${params.length}`);
    }
    if (o.status === 'active') {
      clauses.push("status IN ('queued', 'running', 'awaiting_confirmation')");
    } else if (o.status) {
      params.push(o.status);
      clauses.push(`status = $${params.length}`);
    }
    if (o.ownerId === null) clauses.push('owner_id IS NULL');
    else if (o.ownerId !== undefined) {
      params.push(o.ownerId);
      clauses.push(`owner_id = $${params.length}`);
    }
    const search = o.search?.trim().toLowerCase();
    if (search) {
      // strpos performs literal substring matching: %, _ and backslashes have no wildcard meaning.
      params.push(search);
      const parameter = `$${params.length}`;
      clauses.push(`(strpos(lower(title), ${parameter}) > 0 OR strpos(lower(prompt), ${parameter}) > 0 OR strpos(lower(id), ${parameter}) > 0)`);
    }
    return { where: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
  }

  async listTasks(o: ListTasksOptions): Promise<Task[]> {
    const { where, params } = this.taskConditions(o);
    params.push(o.limit, o.offset ?? 0);
    const sql = `SELECT * FROM solar_tasks${where}
                 ORDER BY created_at DESC, id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const { rows } = await this.pool.query(sql, params);
    return rows.map(toTask);
  }

  async countTasks(filter: TaskListFilter): Promise<number> {
    const { where, params } = this.taskConditions(filter);
    const { rows } = await this.pool.query(`SELECT COUNT(*)::int AS count FROM solar_tasks${where}`, params);
    return Number(rows[0]?.count ?? 0);
  }

  async stats(filter: { ownerId?: string } = {}): Promise<TaskStats> {
    const owned = filter.ownerId !== undefined;
    const { rows } = await this.pool.query(
      `SELECT status, count(*)::int AS n, coalesce(sum((usage->>'costUsd')::float8), 0) AS cost
       FROM solar_tasks ${owned ? 'WHERE owner_id = $1' : ''} GROUP BY status`,
      owned ? [filter.ownerId] : [],
    );
    const stats = emptyStats();
    for (const r of rows as Array<{ status: TaskStatus; n: number; cost: number }>) {
      if (r.status in stats.byStatus) stats.byStatus[r.status] = r.n;
      stats.total += r.n;
      stats.costUsd += Number(r.cost);
    }
    return stats;
  }

  async appendEvent(e: TaskEvent): Promise<void> {
    const { id, taskId, seq, at, type, ...payload } = e;
    await this.pool.query(
      'INSERT INTO solar_task_events (id, task_id, seq, type, at, payload) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING',
      [id, taskId, seq, type, at, JSON.stringify(payload)],
    );
  }

  async listEvents(taskId: string): Promise<TaskEvent[]> {
    const { rows } = await this.pool.query(
      'SELECT id, task_id, seq, type, at, payload FROM solar_task_events WHERE task_id = $1 ORDER BY seq ASC',
      [taskId],
    );
    return rows.map(
      (r: Row) =>
        ({
          ...(r.payload as object),
          id: r.id,
          taskId: r.task_id,
          seq: Number(r.seq),
          type: r.type,
          at: iso(r.at as Date),
        }) as TaskEvent,
    );
  }

  async saveArtifact(a: Artifact): Promise<void> {
    await this.pool.query(
      `INSERT INTO solar_artifacts (id, task_id, name, title, kind, mime_type, size, storage_key, bundle, description, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, title = EXCLUDED.title, size = EXCLUDED.size,
         storage_key = EXCLUDED.storage_key, description = EXCLUDED.description`,
      [a.id, a.taskId, a.name, a.title, a.kind, a.mimeType, a.size, a.storageKey, a.bundle, a.description, a.createdAt],
    );
  }

  async getArtifact(id: string): Promise<Artifact | null> {
    const { rows } = await this.pool.query('SELECT * FROM solar_artifacts WHERE id = $1', [id]);
    return rows[0] ? toArtifact(rows[0]) : null;
  }

  async listArtifacts(taskId: string): Promise<Artifact[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM solar_artifacts WHERE task_id = $1 ORDER BY created_at ASC',
      [taskId],
    );
    return rows.map(toArtifact);
  }

  async upsertConfirmation(c: Confirmation): Promise<void> {
    await this.pool.query(
      `INSERT INTO solar_confirmations (id, task_id, tool_use_id, tool, display_name, plugin_id, plugin_name, reason,
         input, status, created_at, resolved_at, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, resolved_at = EXCLUDED.resolved_at, note = EXCLUDED.note`,
      [
        c.id,
        c.taskId,
        c.toolUseId,
        c.tool,
        c.displayName,
        c.pluginId,
        c.pluginName,
        c.reason,
        JSON.stringify(c.input ?? null),
        c.status,
        c.createdAt,
        c.resolvedAt,
        c.note,
      ],
    );
  }

  async listConfirmations(filter: { taskId?: string; status?: Confirmation['status'] }): Promise<Confirmation[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.taskId) {
      params.push(filter.taskId);
      where.push(`task_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      where.push(`status = $${params.length}`);
    }
    const { rows } = await this.pool.query(
      `SELECT * FROM solar_confirmations ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at ASC`,
      params,
    );
    return rows.map(toConfirmation);
  }

  async saveAttachment(a: Attachment): Promise<void> {
    await this.pool.query(
      `INSERT INTO solar_attachments (id, session_id, name, kind, mime_type, size, parts, chars, outline, warnings, storage_key, text_key, created_at, owner_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, parts = EXCLUDED.parts, chars = EXCLUDED.chars,
         outline = EXCLUDED.outline, warnings = EXCLUDED.warnings, storage_key = EXCLUDED.storage_key, text_key = EXCLUDED.text_key`,
      [
        a.id,
        a.sessionId,
        a.name,
        a.kind,
        a.mimeType,
        a.size,
        a.parts,
        a.chars,
        JSON.stringify(a.outline),
        JSON.stringify(a.warnings),
        a.storageKey,
        a.textKey,
        a.createdAt,
        a.ownerId ?? null,
      ],
    );
  }

  async getAttachment(id: string): Promise<Attachment | null> {
    const { rows } = await this.pool.query('SELECT * FROM solar_attachments WHERE id = $1', [id]);
    return rows[0] ? toAttachment(rows[0]) : null;
  }

  async listAttachments(filter: { sessionId?: string; ids?: string[] }): Promise<Attachment[]> {
    if (filter.ids && filter.ids.length === 0) return [];
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.sessionId) {
      params.push(filter.sessionId);
      where.push(`session_id = $${params.length}`);
    }
    if (filter.ids) {
      params.push(filter.ids);
      where.push(`id = ANY($${params.length}::text[])`);
    }
    const { rows } = await this.pool.query(
      `SELECT * FROM solar_attachments ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at ASC`,
      params,
    );
    return rows.map(toAttachment);
  }

  async deleteAttachment(id: string): Promise<void> {
    await this.pool.query('DELETE FROM solar_attachments WHERE id = $1', [id]);
  }

  async isAttachmentReferenced(id: string): Promise<boolean> {
    // jsonb `?` tests whether the string is an element of the top-level array
    const { rows } = await this.pool.query('SELECT 1 FROM solar_tasks WHERE attachment_ids ? $1 LIMIT 1', [id]);
    return rows.length > 0;
  }

  // ---- user accounts ------------------------------------------------------------------------------------------

  async createUser(u: StoredUser): Promise<CreateUserResult> {
    try {
      await this.pool.query(USER_INSERT, userParams(u));
      return 'created';
    } catch (err) {
      const e = err as { code?: string; constraint?: string };
      // unique_violation on lower(username) / lower(email)
      if (e.code === '23505' && e.constraint === 'solar_users_username_key') return 'username-taken';
      if (e.code === '23505' && e.constraint === 'solar_users_email_key') return 'email-taken';
      throw err;
    }
  }

  async createFirstUser(u: StoredUser): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // every process sharing the database queues here, so "no account yet" cannot be true for two of them at once
      await client.query('SELECT pg_advisory_xact_lock($1)', [FIRST_USER_LOCK]);
      const { rows } = await client.query('SELECT 1 FROM solar_users LIMIT 1');
      if (rows.length > 0) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query(USER_INSERT, userParams(u));
      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async getUser(id: string): Promise<StoredUser | null> {
    const { rows } = await this.pool.query('SELECT * FROM solar_users WHERE id = $1', [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findUserByUsername(username: string): Promise<StoredUser | null> {
    const { rows } = await this.pool.query('SELECT * FROM solar_users WHERE lower(username) = lower($1)', [username]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findUserByEmail(email: string): Promise<StoredUser | null> {
    const { rows } = await this.pool.query('SELECT * FROM solar_users WHERE lower(email) = lower($1)', [email]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async listUsers(filter: { status?: UserStatus } = {}): Promise<StoredUser[]> {
    const { rows } = filter.status
      ? await this.pool.query('SELECT * FROM solar_users WHERE status = $1 ORDER BY created_at ASC, id ASC', [filter.status])
      : await this.pool.query('SELECT * FROM solar_users ORDER BY created_at ASC, id ASC');
    return rows.map(toUser);
  }

  async countUsers(filter: { status?: UserStatus; role?: User['role'] } = {}): Promise<number> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      params.push(filter.status);
      where.push(`status = $${params.length}`);
    }
    if (filter.role) {
      params.push(filter.role);
      where.push(`role = $${params.length}`);
    }
    const { rows } = await this.pool.query(`SELECT count(*)::int AS n FROM solar_users ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`, params);
    return Number((rows[0] as { n: number }).n);
  }

  async updateUser(id: string, patch: UserPatch): Promise<StoredUser | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, column] of Object.entries(USER_COLUMNS) as Array<[keyof UserPatch, string]>) {
      if (patch[key] === undefined) continue;
      params.push(patch[key]);
      sets.push(`${column} = $${params.length}`);
    }
    if (sets.length === 0) return this.getUser(id);
    params.push(id);
    const { rows } = await this.pool.query(`UPDATE solar_users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async deleteUser(id: string): Promise<boolean> {
    // the sessions go with the account (ON DELETE CASCADE)
    const { rowCount } = await this.pool.query('DELETE FROM solar_users WHERE id = $1', [id]);
    return (rowCount ?? 0) > 0;
  }

  // ---- login sessions -----------------------------------------------------------------------------------------

  async createSession(s: StoredSession): Promise<void> {
    await this.pool.query(
      `INSERT INTO solar_sessions (token_hash, user_id, created_at, last_seen_at, expires_at, user_agent, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [s.tokenHash, s.userId, s.createdAt, s.lastSeenAt, s.expiresAt, s.userAgent, s.ip],
    );
  }

  async getSession(tokenHash: string): Promise<StoredSession | null> {
    const { rows } = await this.pool.query('SELECT * FROM solar_sessions WHERE token_hash = $1', [tokenHash]);
    return rows[0] ? toSession(rows[0]) : null;
  }

  async touchSession(tokenHash: string, lastSeenAt: string, expiresAt: string): Promise<void> {
    await this.pool.query('UPDATE solar_sessions SET last_seen_at = $2, expires_at = $3 WHERE token_hash = $1', [tokenHash, lastSeenAt, expiresAt]);
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query('DELETE FROM solar_sessions WHERE token_hash = $1', [tokenHash]);
  }

  async deleteUserSessions(userId: string, exceptTokenHash?: string): Promise<string[]> {
    const { rows } = exceptTokenHash
      ? await this.pool.query('DELETE FROM solar_sessions WHERE user_id = $1 AND token_hash <> $2 RETURNING token_hash', [userId, exceptTokenHash])
      : await this.pool.query('DELETE FROM solar_sessions WHERE user_id = $1 RETURNING token_hash', [userId]);
    return rows.map((r: Row) => r.token_hash as string);
  }

  async deleteExpiredSessions(nowIso: string): Promise<number> {
    const { rowCount } = await this.pool.query('DELETE FROM solar_sessions WHERE expires_at <= $1', [nowIso]);
    return rowCount ?? 0;
  }

  // ---- activity log ---------------------------------------------------------------------------------------------

  /**
   * One multi-row insert per batch. When it fails on the data of a row (SQLSTATE class 22 data exception, 23 integrity
   * constraint or 54 program limit, e.g. a value jsonb refuses), the rows are inserted one by one so that one bad row
   * cannot sink the others; a row that still fails is stored with `details` replaced by `{ invalid: true }`, and only
   * when even that fails is it dropped (with a warning). Other errors (connection, timeout) are thrown: the batch is
   * retried as a whole, and rows already stored are skipped (ON CONFLICT DO NOTHING).
   */
  async appendActivity(entries: ActivityEntry[]): Promise<void> {
    if (entries.length === 0) return;
    try {
      await this.insertActivity(entries);
      return;
    } catch (err) {
      if (!isDataError(err)) throw err;
      if (entries.length > 1) log.warn(`An activity log batch was refused (${String(err)}); storing its ${entries.length} entries one by one`);
    }
    // what is stored (or given up) so far: a connection lost half-way only makes the rest be written again
    const done = new Set<string>();
    const fail = (err: unknown) => (done.size > 0 ? new ActivityPartialWriteError(done, err) : err);
    for (const e of entries) {
      try {
        await this.insertActivity([e]);
        done.add(e.id);
        continue;
      } catch (err) {
        if (!isDataError(err)) throw fail(err);
      }
      try {
        await this.insertActivity([{ ...e, details: { invalid: true } }]);
        log.warn(`Activity log entry ${e.id} (${e.action}) was stored without its details: Postgres refused them`);
      } catch (err) {
        if (!isDataError(err)) throw fail(err);
        log.warn(`Activity log entry ${e.id} (${e.action}) could not be stored and was dropped: ${String(err)}`);
      }
      done.add(e.id);
    }
  }

  private async insertActivity(entries: ActivityEntry[]): Promise<void> {
    // 14 parameters per row, far below the 65535 limit for the batch sizes used
    const params: unknown[] = [];
    const rows: string[] = [];
    for (const e of entries) {
      const values = [
        e.id,
        e.at,
        e.actorId,
        e.actorName,
        e.actorRole,
        e.actorKind,
        e.action,
        e.targetType,
        e.targetId,
        e.targetLabel,
        e.outcome,
        e.ip,
        e.userAgent,
        e.details === null ? null : JSON.stringify(e.details),
      ];
      const placeholders = values.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      rows.push(`(${placeholders.join(',')})`);
    }
    await this.pool.query(
      `INSERT INTO solar_activity (id, at, actor_id, actor_name, actor_role, actor_kind, action, target_type, target_id, target_label,
         outcome, ip, user_agent, details) VALUES ${rows.join(',')} ON CONFLICT (id) DO NOTHING`,
      params,
    );
  }

  async listActivity(q: ActivityQuery): Promise<{ items: ActivityEntry[]; next: ActivityCursor | null }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const param = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    if (q.actorId !== undefined) where.push(`actor_id = ${param(q.actorId)}`);
    const actionTests: string[] = [];
    if (q.actions?.length) actionTests.push(`action = ANY(${param(q.actions)}::text[])`);
    for (const prefix of q.actionPrefixes ?? []) actionTests.push(`action LIKE ${param(`${escapeLike(prefix)}%`)}`);
    if (actionTests.length) where.push(`(${actionTests.join(' OR ')})`);
    if (q.outcome) where.push(`outcome = ${param(q.outcome)}`);
    if (q.from) where.push(`at >= ${param(q.from)}::timestamptz`);
    if (q.to) where.push(`at < ${param(q.to)}::timestamptz`);
    if (q.q) {
      const pattern = param(`%${escapeLike(q.q)}%`);
      where.push(
        `(actor_name ILIKE ${pattern} OR target_label ILIKE ${pattern} OR target_id ILIKE ${pattern} OR action ILIKE ${pattern} OR details::text ILIKE ${pattern})`,
      );
    }
    if (q.before) where.push(`(at, id) < (${param(q.before.at)}::timestamptz, ${param(q.before.id)})`);
    const limit = Math.max(1, Math.min(1000, Math.floor(q.limit)));
    const { rows } = await this.pool.query(
      `SELECT * FROM solar_activity ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY at DESC, id DESC LIMIT ${param(limit + 1)}`,
      params,
    );
    const items = (rows as Row[]).slice(0, limit).map(toActivity);
    const last = items[items.length - 1];
    return { items, next: rows.length > limit && last ? { at: last.at, id: last.id } : null };
  }

  async deleteActivityBefore(cutoffIso: string): Promise<number> {
    const { rowCount } = await this.pool.query('DELETE FROM solar_activity WHERE at < $1', [cutoffIso]);
    return rowCount ?? 0;
  }
}
