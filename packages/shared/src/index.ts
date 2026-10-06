/**
 * Shared contracts between the SOLAR server, web UI and desktop shell.
 * Types only (plus a few constants) so every workspace can import it directly from source.
 */

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'awaiting_confirmation'
  | 'completed'
  | 'failed'
  | 'cancelled';

export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ['completed', 'failed', 'cancelled'];

export interface TaskUsage {
  apiCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Estimated cost in USD based on the public list price of the model. */
  costUsd: number;
}

export const EMPTY_USAGE: TaskUsage = {
  apiCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
};

export interface Task {
  id: string;
  sessionId: string;
  title: string;
  prompt: string;
  status: TaskStatus;
  /** 0..100 */
  progress: number;
  currentStep: string | null;
  model: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Final answer of the agent (markdown). */
  result: string | null;
  error: string | null;
  usage: TaskUsage;
}

export type ToolSource = 'builtin' | 'mcp';

export type TaskEventPayload =
  | { type: 'status'; status: TaskStatus; message?: string }
  | { type: 'progress'; progress: number; step: string; detail?: string }
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | {
      type: 'tool_call';
      toolUseId: string;
      tool: string;
      displayName: string;
      source: ToolSource;
      pluginId?: string;
      input: unknown;
    }
  | {
      type: 'tool_result';
      toolUseId: string;
      tool: string;
      ok: boolean;
      summary: string;
      durationMs: number;
    }
  | { type: 'confirmation_requested'; confirmation: Confirmation }
  | { type: 'confirmation_resolved'; confirmationId: string; approved: boolean; note?: string }
  | { type: 'artifact'; artifact: Artifact }
  | { type: 'usage'; usage: TaskUsage }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'result'; text: string }
  | { type: 'error'; message: string };

export type TaskEventType = TaskEventPayload['type'];

export type TaskEvent = TaskEventPayload & {
  id: string;
  taskId: string;
  seq: number;
  at: string;
};

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

export type ArtifactKind =
  | 'archimate-exchange'
  | 'archimate-svg'
  | 'archimate-model'
  | 'sequence-svg'
  | 'sequence-mermaid'
  | 'sequence-plantuml'
  | 'sequence-model'
  | 'tsd-markdown'
  | 'tsd-html'
  | 'tsd-model'
  | 'other';

export interface Artifact {
  id: string;
  taskId: string;
  /** File name, e.g. `order-platform.archimate.xml`. */
  name: string;
  title: string;
  kind: ArtifactKind;
  mimeType: string;
  size: number;
  storageKey: string;
  /** Groups the files that belong to one deliverable (e.g. one ArchiMate model). */
  bundle: string;
  description: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Confirmations (human in the loop)
// ---------------------------------------------------------------------------

export type ConfirmationStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface Confirmation {
  id: string;
  taskId: string;
  toolUseId: string;
  tool: string;
  displayName: string;
  pluginId: string | null;
  pluginName: string | null;
  reason: string;
  input: unknown;
  status: ConfirmationStatus;
  createdAt: string;
  resolvedAt: string | null;
  note: string | null;
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export type SkillSource = 'builtin' | 'user';

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  enabled: boolean;
  files: string[];
  updatedAt: string;
}

export interface SkillDetail extends SkillSummary {
  /** Markdown body of SKILL.md (without the front matter). */
  content: string;
}

export interface SkillInput {
  name: string;
  description: string;
  content: string;
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// MCP plugins
// ---------------------------------------------------------------------------

export type PluginTransport = 'stdio' | 'http' | 'sse';
export type ConfirmPolicy = 'never' | 'writes' | 'always';
export type PluginPreset = 'github' | 'plane' | 'visual-paradigm' | 'custom';

export interface PluginConfig {
  id: string;
  name: string;
  description: string;
  preset: PluginPreset;
  enabled: boolean;
  transport: PluginTransport;
  /** stdio */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** http / sse */
  url?: string;
  headers?: Record<string, string>;
  /** When the user must approve a tool call coming from this plugin. */
  confirm: ConfirmPolicy;
  /** Only expose these tool names to the agent (empty / undefined = all). */
  toolAllowlist?: string[];
  /** Never expose these tool names to the agent. */
  toolDenylist?: string[];
}

/** `unconfigured` = enabled but a referenced ${ENV_VAR} (token, URL...) is not set yet. */
export type PluginState = 'disabled' | 'unconfigured' | 'connecting' | 'connected' | 'error';

export interface PluginToolInfo {
  name: string;
  description: string;
}

export interface PluginStatus {
  id: string;
  state: PluginState;
  error: string | null;
  tools: PluginToolInfo[];
  connectedAt: string | null;
}

export interface PluginView extends PluginConfig {
  status: PluginStatus;
}

/** Placeholder returned instead of secret values; send it back unchanged to keep the stored value. */
export const SECRET_MASK = '••••••••';

// ---------------------------------------------------------------------------
// Server configuration exposed to the UI
// ---------------------------------------------------------------------------

export interface PublicConfig {
  appName: string;
  version: string;
  provider: string;
  model: string;
  effort: string;
  openaiConfigured: boolean;
  authRequired: boolean;
  storage: {
    database: 'neon-postgres' | 'local-file';
    objects: 's3' | 'local-file';
  };
  github: {
    configured: boolean;
    defaultRepo: string | null;
    defaultBranch: string;
  };
  plane: {
    hostUrl: string;
  };
}

// ---------------------------------------------------------------------------
// API payloads
// ---------------------------------------------------------------------------

export interface CreateTaskRequest {
  prompt: string;
  sessionId: string;
}

export interface TaskDetail {
  task: Task;
  events: TaskEvent[];
  artifacts: Artifact[];
  confirmations: Confirmation[];
}

export interface TaskStats {
  total: number;
  byStatus: Record<TaskStatus, number>;
  costUsd: number;
}

export interface ResolveConfirmationRequest {
  approved: boolean;
  note?: string;
}

/** Messages pushed over the server-sent events stream (`GET /api/stream`). */
export type StreamMessage =
  | { kind: 'hello'; serverTime: string }
  | { kind: 'task'; task: Task }
  | { kind: 'event'; event: TaskEvent }
  | { kind: 'delta'; taskId: string; channel: 'text' | 'thinking'; text: string }
  | { kind: 'plugins'; plugins: PluginStatus[] };
