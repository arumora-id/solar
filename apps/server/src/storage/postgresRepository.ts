import pg from 'pg';
import type { Artifact, Attachment, Confirmation, Task, TaskEvent, TaskStats, TaskStatus, TaskUsage } from '@solar/shared';
import { EMPTY_USAGE } from '@solar/shared';
import { emptyStats, type ListTasksOptions, type Repository } from './repository.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS solar_tasks (
  id            text PRIMARY KEY,
  session_id    text NOT NULL,
  title         text NOT NULL,
  prompt        text NOT NULL,
  status        text NOT NULL,
  progress      integer NOT NULL DEFAULT 0,
  current_step  text,
  model         text NOT NULL,
  created_at    timestamptz NOT NULL,
  started_at    timestamptz,
  finished_at   timestamptz,
  result        text,
  error         text,
  usage         jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS solar_tasks_created_idx ON solar_tasks (created_at DESC);
CREATE INDEX IF NOT EXISTS solar_tasks_session_idx ON solar_tasks (session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS solar_task_events (
  id       text PRIMARY KEY,
  task_id  text NOT NULL REFERENCES solar_tasks(id) ON DELETE CASCADE,
  seq      integer NOT NULL,
  type     text NOT NULL,
  at       timestamptz NOT NULL,
  payload  jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS solar_task_events_task_idx ON solar_task_events (task_id, seq);

CREATE TABLE IF NOT EXISTS solar_artifacts (
  id           text PRIMARY KEY,
  task_id      text NOT NULL REFERENCES solar_tasks(id) ON DELETE CASCADE,
  name         text NOT NULL,
  title        text NOT NULL,
  kind         text NOT NULL,
  mime_type    text NOT NULL,
  size         integer NOT NULL,
  storage_key  text NOT NULL,
  bundle       text NOT NULL,
  description  text,
  created_at   timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS solar_artifacts_task_idx ON solar_artifacts (task_id, created_at);

CREATE TABLE IF NOT EXISTS solar_confirmations (
  id            text PRIMARY KEY,
  task_id       text NOT NULL REFERENCES solar_tasks(id) ON DELETE CASCADE,
  tool_use_id   text NOT NULL,
  tool          text NOT NULL,
  display_name  text NOT NULL,
  plugin_id     text,
  plugin_name   text,
  reason        text NOT NULL,
  input         jsonb,
  status        text NOT NULL,
  created_at    timestamptz NOT NULL,
  resolved_at   timestamptz,
  note          text
);
CREATE INDEX IF NOT EXISTS solar_confirmations_status_idx ON solar_confirmations (status, created_at);

ALTER TABLE solar_tasks ADD COLUMN IF NOT EXISTS attachment_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS solar_attachments (
  id           text PRIMARY KEY,
  session_id   text NOT NULL,
  name         text NOT NULL,
  kind         text NOT NULL,
  mime_type    text NOT NULL,
  size         integer NOT NULL,
  parts        integer,
  chars        integer NOT NULL,
  outline      jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings     jsonb NOT NULL DEFAULT '[]'::jsonb,
  storage_key  text NOT NULL,
  text_key     text NOT NULL,
  created_at   timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS solar_attachments_session_idx ON solar_attachments (session_id, created_at);
`;

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
  };
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

  async init(): Promise<void> {
    await this.pool.query(SCHEMA);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async upsertTask(t: Task): Promise<void> {
    await this.pool.query(
      `INSERT INTO solar_tasks (id, session_id, title, prompt, status, progress, current_step, model, created_at,
         started_at, finished_at, result, error, usage, attachment_ids)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
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
      ],
    );
  }

  async getTask(id: string): Promise<Task | null> {
    const { rows } = await this.pool.query('SELECT * FROM solar_tasks WHERE id = $1', [id]);
    return rows[0] ? toTask(rows[0]) : null;
  }

  async listTasks(o: ListTasksOptions): Promise<Task[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (o.sessionId) {
      params.push(o.sessionId);
      where.push(`session_id = $${params.length}`);
    }
    if (o.status) {
      params.push(o.status);
      where.push(`status = $${params.length}`);
    }
    params.push(o.limit, o.offset ?? 0);
    const sql = `SELECT * FROM solar_tasks ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const { rows } = await this.pool.query(sql, params);
    return rows.map(toTask);
  }

  async stats(): Promise<TaskStats> {
    const { rows } = await this.pool.query(
      `SELECT status, count(*)::int AS n, coalesce(sum((usage->>'costUsd')::float8), 0) AS cost
       FROM solar_tasks GROUP BY status`,
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
      `INSERT INTO solar_attachments (id, session_id, name, kind, mime_type, size, parts, chars, outline, warnings, storage_key, text_key, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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
}
