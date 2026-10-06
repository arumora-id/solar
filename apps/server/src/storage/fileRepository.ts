import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Artifact, Confirmation, Task, TaskEvent, TaskStats } from '@solar/shared';
import { KeyedQueue, writeFileAtomic } from '../util/fs.js';
import { emptyStats, type ListTasksOptions, type Repository } from './repository.js';

interface TaskRecord {
  task: Task;
  events: TaskEvent[] | null; // lazily loaded
  artifacts: Artifact[];
  confirmations: Confirmation[];
}

/**
 * Zero-configuration storage used when DATABASE_URL is not set.
 * Layout: <dataDir>/tasks/<taskId>.json, .events.jsonl, .artifacts.json, .confirmations.json
 */
export class FileRepository implements Repository {
  readonly kind = 'local-file' as const;
  private readonly dir: string;
  private readonly records = new Map<string, TaskRecord>();
  private readonly artifactIndex = new Map<string, Artifact>();
  private readonly queue = new KeyedQueue();

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'tasks');
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const files = await readdir(this.dir);
    for (const file of files) {
      if (!/^[A-Za-z0-9_-]+\.json$/.test(file)) continue;
      const id = file.slice(0, -'.json'.length);
      try {
        const task = JSON.parse(await readFile(join(this.dir, file), 'utf8')) as Task;
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
    if (existing) existing.task = { ...task };
    else this.records.set(task.id, { task: { ...task }, events: [], artifacts: [], confirmations: [] });
    await this.persist(`${task.id}.json`, task);
  }

  async getTask(id: string): Promise<Task | null> {
    const r = this.records.get(id);
    return r ? { ...r.task } : null;
  }

  async listTasks(options: ListTasksOptions): Promise<Task[]> {
    let tasks = [...this.records.values()].map((r) => r.task);
    if (options.sessionId) tasks = tasks.filter((t) => t.sessionId === options.sessionId);
    if (options.status) tasks = tasks.filter((t) => t.status === options.status);
    tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const offset = options.offset ?? 0;
    return tasks.slice(offset, offset + options.limit).map((t) => ({ ...t }));
  }

  async stats(): Promise<TaskStats> {
    const stats = emptyStats();
    for (const { task } of this.records.values()) {
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

  async listConfirmations(filter: { taskId?: string; status?: Confirmation['status'] }): Promise<Confirmation[]> {
    const source = filter.taskId
      ? (this.records.get(filter.taskId)?.confirmations ?? [])
      : [...this.records.values()].flatMap((r) => r.confirmations);
    return source
      .filter((c) => !filter.status || c.status === filter.status)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}
