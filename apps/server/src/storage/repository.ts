import type { Artifact, Attachment, Confirmation, Task, TaskEvent, TaskStats, TaskStatus } from '@solar/shared';

export interface ListTasksOptions {
  limit: number;
  offset?: number;
  sessionId?: string;
  status?: TaskStatus;
}

/** Persistence for tasks, their event timeline, artifact metadata and confirmations. */
export interface Repository {
  readonly kind: 'neon-postgres' | 'local-file';
  init(): Promise<void>;
  close(): Promise<void>;

  upsertTask(task: Task): Promise<void>;
  getTask(id: string): Promise<Task | null>;
  listTasks(options: ListTasksOptions): Promise<Task[]>;
  stats(): Promise<TaskStats>;

  appendEvent(event: TaskEvent): Promise<void>;
  listEvents(taskId: string): Promise<TaskEvent[]>;

  saveArtifact(artifact: Artifact): Promise<void>;
  getArtifact(id: string): Promise<Artifact | null>;
  listArtifacts(taskId: string): Promise<Artifact[]>;

  upsertConfirmation(confirmation: Confirmation): Promise<void>;
  listConfirmations(filter: { taskId?: string; status?: Confirmation['status'] }): Promise<Confirmation[]>;

  saveAttachment(attachment: Attachment): Promise<void>;
  getAttachment(id: string): Promise<Attachment | null>;
  /** Oldest first. With `ids`, only those (in no particular order). */
  listAttachments(filter: { sessionId?: string; ids?: string[] }): Promise<Attachment[]>;
  deleteAttachment(id: string): Promise<void>;
  /** True when a task was created with this attachment (it is then kept as part of the task history). */
  isAttachmentReferenced(id: string): Promise<boolean>;
}

export function emptyStats(): TaskStats {
  return {
    total: 0,
    costUsd: 0,
    byStatus: {
      queued: 0,
      running: 0,
      awaiting_confirmation: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    },
  };
}
