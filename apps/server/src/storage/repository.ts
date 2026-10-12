import type { Artifact, Attachment, Confirmation, Task, TaskEvent, TaskStats, TaskStatus, User, UserStatus } from '@solar/shared';

export interface ListTasksOptions {
  limit: number;
  offset?: number;
  sessionId?: string;
  status?: TaskStatus;
  /**
   * Only the tasks of this owner (a user id); `null` = only tasks without an owner (created before user accounts
   * existed); absent = every task.
   */
  ownerId?: string | null;
}

/** A user account as stored: the API shape plus the password hash, which never leaves the server. */
export interface StoredUser extends User {
  /** `scrypt$N$r$p$salt$hash` (see auth/password.ts). */
  passwordHash: string;
}

/** A login session. The cookie carries a random token; only its SHA-256 is stored. */
export interface StoredSession {
  /** Hex SHA-256 of the session token. */
  tokenHash: string;
  userId: string;
  createdAt: string;
  lastSeenAt: string;
  /** Idle expiry, renewed while the session is used, never past createdAt + the absolute maximum. */
  expiresAt: string;
  userAgent: string | null;
  ip: string | null;
}

export type CreateUserResult = 'created' | 'username-taken' | 'email-taken';

export type UserPatch = Partial<Pick<StoredUser, 'name' | 'role' | 'status' | 'passwordHash' | 'lastLoginAt' | 'approvedAt' | 'approvedBy' | 'updatedAt'>>;

/** Persistence for tasks, their event timeline, artifact metadata and confirmations. */
export interface Repository {
  readonly kind: 'neon-postgres' | 'local-file';
  init(): Promise<void>;
  close(): Promise<void>;

  /** Saves a task. Its `ownerId` is written when the task is created and never changed afterwards. */
  upsertTask(task: Task): Promise<void>;
  getTask(id: string): Promise<Task | null>;
  listTasks(options: ListTasksOptions): Promise<Task[]>;
  /** Totals of every task, or of one owner's tasks. */
  stats(filter?: { ownerId?: string }): Promise<TaskStats>;

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

  // ---- user accounts ------------------------------------------------------------------------------------------
  /** Adds an account unless its username or email (both lower case) is taken. */
  createUser(user: StoredUser): Promise<CreateUserResult>;
  /**
   * Adds the account only when no account exists at all, atomically (also across processes sharing a database): of
   * concurrent first-account setups exactly one wins. False when an account already existed.
   */
  createFirstUser(user: StoredUser): Promise<boolean>;
  getUser(id: string): Promise<StoredUser | null>;
  /** By lower-case username or email. */
  findUserByUsername(username: string): Promise<StoredUser | null>;
  findUserByEmail(email: string): Promise<StoredUser | null>;
  /** Oldest first. */
  listUsers(filter?: { status?: UserStatus }): Promise<StoredUser[]>;
  countUsers(filter?: { status?: UserStatus; role?: User['role'] }): Promise<number>;
  /** Changes an account; null when it does not exist. */
  updateUser(id: string, patch: UserPatch): Promise<StoredUser | null>;
  /** Deletes an account and its sessions; false when it did not exist. */
  deleteUser(id: string): Promise<boolean>;

  // ---- login sessions -------------------------------------------------------------------------------------------
  createSession(session: StoredSession): Promise<void>;
  getSession(tokenHash: string): Promise<StoredSession | null>;
  /** Records use of a session (sliding expiry). */
  touchSession(tokenHash: string, lastSeenAt: string, expiresAt: string): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  /** Deletes every session of a user except `exceptTokenHash`; returns the deleted token hashes. */
  deleteUserSessions(userId: string, exceptTokenHash?: string): Promise<string[]>;
  /** Deletes sessions whose expiry is before `nowIso`; returns how many. */
  deleteExpiredSessions(nowIso: string): Promise<number>;
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
