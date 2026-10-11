/**
 * Shared contracts between the SOLAR server, web UI and desktop shell.
 * Types only (plus a few constants) so every workspace can import it directly from source.
 */

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

/**
 * Interface languages of SOLAR: Bahasa Indonesia and English. The web client sends its language with every request
 * (header `X-Solar-Language`) and stores it on each task it creates ({@link Task.language}); the server answers in
 * Indonesian when no language is given.
 */
export type Language = 'id' | 'en';

export const LANGUAGES: readonly Language[] = ['id', 'en'];

/** Request header carrying the client's interface language (`id` | `en`); `Accept-Language` is the fallback. */
export const LANGUAGE_HEADER = 'X-Solar-Language';

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
  /** Documents attached to the request (see {@link Attachment}); empty for older tasks. */
  attachmentIds: string[];
  /**
   * Interface language of the client that created the task: task-scoped server text (current step, status messages,
   * confirmation reasons, tool names, errors) is written in it, and the agent falls back to it when the language of
   * the request is unclear. Absent on older tasks, which are Indonesian.
   */
  language?: Language;
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
  /** The TSD as a Word document (.docx) for delivery to the client. Binary. */
  | 'tsd-docx'
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
// Attachments (project documents the agent reads before designing)
// ---------------------------------------------------------------------------

export type AttachmentKind = 'pdf' | 'docx' | 'xlsx' | 'csv' | 'pptx' | 'markdown' | 'text';

/** File extensions accepted for attachments (lower case, with dot). */
export const ATTACHMENT_EXTENSIONS: readonly string[] = ['.pdf', '.docx', '.xlsx', '.xlsm', '.csv', '.pptx', '.md', '.markdown', '.txt'];

export interface Attachment {
  id: string;
  sessionId: string;
  /** Original file name as uploaded. */
  name: string;
  kind: AttachmentKind;
  mimeType: string;
  /** Size of the original file in bytes. */
  size: number;
  /** Number of pages (pdf), slides (pptx) or sheets (xlsx); null when not applicable. */
  parts: number | null;
  /** Length of the extracted Markdown text in characters. */
  chars: number;
  /** First headings of the extracted text (orientation for the agent and the UI). */
  outline: string[];
  /** E.g. "page 4 has no text layer (scanned?)", "sheet truncated to 2000 rows". */
  warnings: string[];
  /** Object-store keys of the original file and of the extracted Markdown. */
  storageKey: string;
  textKey: string;
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
// LLM providers (multi-provider model routing)
// ---------------------------------------------------------------------------

/**
 * `openai-responses`: OpenAI Responses API (OpenAI, Azure OpenAI v1 and compatible gateways).
 * `openai-chat`: Chat Completions API - the de-facto standard of gateways and other vendors
 * (OmniRoute, OpenRouter, LiteLLM, Ollama, vLLM, Gemini and Anthropic OpenAI-compatible endpoints, ...).
 */
export type LlmProviderKind = 'openai-responses' | 'openai-chat';

export interface LlmModelConfig {
  /** Model id as the provider expects it. */
  id: string;
  label?: string;
  /** Reasoning model: sends the reasoning effort. Default: detected from the id for OpenAI models, false otherwise. */
  reasoning?: boolean;
  /** Reasoning effort for this model (overrides SOLAR_EFFORT). */
  effort?: string;
  /** Largest output (incl. reasoning) the model accepts. */
  maxOutputTokens?: number;
  /** USD per 1M tokens, for cost estimates (0 for local models). */
  price?: { input: number; cachedInput: number; output: number };
}

export interface LlmProviderConfig {
  /** Lower-case id used in routes: "<provider>/<model>". */
  id: string;
  name: string;
  kind: LlmProviderKind;
  enabled: boolean;
  /** API base URL incl. version path, e.g. https://api.openai.com/v1 or http://localhost:11434/v1. */
  baseUrl?: string;
  /** API key or a ${ENV_VAR} reference; empty for keyless local endpoints. */
  apiKey?: string;
  /** Extra HTTP headers (values may use ${ENV_VAR}). */
  headers?: Record<string, string>;
  /** Chat Completions only: name of the output limit parameter. Default max_completion_tokens on api.openai.com, max_tokens elsewhere. */
  maxTokensParam?: 'max_tokens' | 'max_completion_tokens';
  /** The models accept images in tool results (default true). */
  vision?: boolean;
  /** Known models with optional overrides. Routes may also name models not listed here. */
  models: LlmModelConfig[];
}

export interface LlmProviderView extends LlmProviderConfig {
  /** `env` = defined by OPENAI_* in .env (read-only in the UI). */
  source: 'env' | 'user';
  /** An API key is set (or none is needed). */
  ready: boolean;
  /** ${VAR} references without a value. */
  missingVars: string[];
}

export interface LlmSettingsView {
  providers: LlmProviderView[];
  /** Named routes; "default" is used by the agent. Each is an ordered list of "provider/model" (primary, then fallbacks). */
  routes: Record<string, string[]>;
}

export interface LlmTestResult {
  ok: boolean;
  models?: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Knowledge base (the architect's own Markdown rules and facts)
// ---------------------------------------------------------------------------

export type KnowledgeType =
  | 'system'
  | 'integration'
  | 'standard'
  | 'principle'
  | 'nfr'
  | 'process'
  | 'document'
  | 'decision'
  | 'glossary'
  | 'landscape'
  | 'reference';

export interface KnowledgeEntry {
  /** Relative path inside the knowledge base, e.g. "systems/AD1GATE.md". */
  path: string;
  id: string;
  type: KnowledgeType;
  title: string;
  description: string;
  aliases: string[];
  tags: string[];
  /** Lifecycle from front matter, e.g. active, sunset, retired (empty = not stated). */
  status: string;
  source: 'builtin' | 'user';
  size: number;
  updatedAt: string;
}

export interface KnowledgeFile {
  entry: KnowledgeEntry;
  content: string;
}

export interface KnowledgeSearchHit {
  entry: KnowledgeEntry;
  score: number;
  snippets: Array<{ line: number; text: string }>;
}

// ---------------------------------------------------------------------------
// Server configuration exposed to the UI
// ---------------------------------------------------------------------------

export interface PublicConfig {
  appName: string;
  version: string;
  provider: string;
  model: string;
  effort: string;
  /** True when the primary model of the default route has a usable provider (API key, or a keyless local endpoint). */
  llmConfigured: boolean;
  /** Kept for older clients: same value as llmConfigured. */
  openaiConfigured: boolean;
  /** The default model route: primary first, then the fallbacks ("provider/model"). */
  modelRoute: string[];
  /** Number of files in the knowledge base. */
  knowledgeFiles: number;
  authRequired: boolean;
  attachments: {
    maxFileMb: number;
    maxPerTask: number;
    extensions: readonly string[];
  };
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
  /** Documents uploaded beforehand (POST /api/attachments) to attach to this request. */
  attachmentIds?: string[];
  /** Interface language of the client; the server's default is `id`. */
  language?: Language;
}

export interface TaskDetail {
  task: Task;
  events: TaskEvent[];
  artifacts: Artifact[];
  confirmations: Confirmation[];
  attachments: Attachment[];
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
