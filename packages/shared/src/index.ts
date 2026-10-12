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
  /**
   * Id of the user who created the task ({@link User.id}), or {@link ACCESS_TOKEN_PRINCIPAL_ID} for a task created with
   * SOLAR_ACCESS_TOKEN. Absent on tasks created before user accounts existed: only roles with `tasks.all` see those.
   */
  ownerId?: string;
  /**
   * Who created the task, added by the API for viewers who see every user's tasks (`tasks.all`) - in task lists, task
   * details and `task` messages of the event stream. `null` for tasks from before user accounts existed.
   */
  owner?: TaskOwner | null;
}

/** The creator of a task as shown to superadmins and heads of IT (monitor). */
export interface TaskOwner {
  id: string;
  /**
   * Display name. For a deleted account `deleted` is true, `username` and `role` are null and `name` is a placeholder
   * in the language of the request ("deleted user"); for the access token it names the token.
   */
  name: string;
  username: string | null;
  role: Role | null;
  /** `token` = created with SOLAR_ACCESS_TOKEN (scripts), not by a person's account. */
  kind: 'user' | 'token';
  /** The account was deleted after it created the task (the UI shows e.g. "deleted user"). */
  deleted: boolean;
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
  /** Id of the user who uploaded it (see {@link Task.ownerId}); absent on uploads from before user accounts existed. */
  ownerId?: string;
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
// Users, roles and permissions
// ---------------------------------------------------------------------------

/**
 * `superadmin`: everything, incl. system settings and every user account. `head_of_it` (Head of IT Solar): sees and acts
 * on every task, approves registrations (as staff) and disables/enables staff accounts. `staff` (Solar Staff): the
 * agent for their own tasks, the knowledge base and skills.
 */
export type Role = 'superadmin' | 'head_of_it' | 'staff';

export const ROLES: readonly Role[] = ['superadmin', 'head_of_it', 'staff'];

/** `pending`: registered, waiting for approval (cannot log in). `disabled`: cannot log in. */
export type UserStatus = 'pending' | 'active' | 'disabled';

export const USER_STATUSES: readonly UserStatus[] = ['pending', 'active', 'disabled'];

/** A user account as the API returns it (never with its password hash). */
export interface User {
  id: string;
  /** Lower case, 3-32 of a-z 0-9 . _ - */
  username: string;
  /** Lower case. */
  email: string;
  /** Display name. */
  name: string;
  role: Role;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  /** When and by whom (user id, or {@link ACCESS_TOKEN_PRINCIPAL_ID}) a registration was approved. */
  approvedAt: string | null;
  approvedBy: string | null;
}

/**
 * Owner id of what is created with SOLAR_ACCESS_TOKEN (scripts, CI): the token acts as a superadmin that is not a user
 * account.
 */
export const ACCESS_TOKEN_PRINCIPAL_ID = 'system:access-token';

export type Permission =
  /** Use the agent: create tasks, upload attachments, read own artifacts, answer approvals of own tasks. */
  | 'agent.use'
  /** See and act on every user's tasks (events, artifacts, attachments, approvals, cancel); else only one's own. */
  | 'tasks.all'
  /** List user accounts and the number of pending registrations. */
  | 'users.view'
  /** Approve pending registrations (head_of_it: only as staff - see {@link assignableRoles}). */
  | 'users.approve'
  /** Disable / enable accounts (head_of_it: staff accounts only - see {@link canActOnUser}). */
  | 'users.disable'
  /** Create accounts, change roles and names, reset passwords, delete accounts. */
  | 'users.manage'
  | 'knowledge.read'
  /** Create, edit, delete and import knowledge files. */
  | 'knowledge.write'
  | 'skills.read'
  /** Create, edit, import, enable/disable and delete skills. */
  | 'skills.manage'
  /** LLM providers and routes, model tests, MCP plugins, configuration and tokens. */
  | 'settings.manage';

export const PERMISSIONS: readonly Permission[] = [
  'agent.use',
  'tasks.all',
  'users.view',
  'users.approve',
  'users.disable',
  'users.manage',
  'knowledge.read',
  'knowledge.write',
  'skills.read',
  'skills.manage',
  'settings.manage',
];

/** The one table of what each role may do (server checks and UI both use it). */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  superadmin: PERMISSIONS,
  head_of_it: ['agent.use', 'tasks.all', 'users.view', 'users.approve', 'users.disable', 'knowledge.read', 'knowledge.write', 'skills.read', 'skills.manage'],
  staff: ['agent.use', 'knowledge.read', 'knowledge.write', 'skills.read', 'skills.manage'],
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return Boolean(role && ROLE_PERMISSIONS[role]?.includes(permission));
}

export function permissionsOf(role: Role | null | undefined): Permission[] {
  return role ? [...(ROLE_PERMISSIONS[role] ?? [])] : [];
}

/** Roles an actor may give an account (when approving a registration or changing a role). */
export function assignableRoles(actor: Role | null | undefined): Role[] {
  if (actor === 'superadmin') return [...ROLES];
  if (actor === 'head_of_it') return ['staff'];
  return [];
}

export type UserAction = 'approve' | 'disable' | 'enable' | 'role' | 'rename' | 'password' | 'delete';

/**
 * Whether `actor` may do `action` to the account `target` by role alone (the server also refuses: acting on oneself
 * for role/disable/password/delete, and anything that would leave no active superadmin).
 * - superadmin: everything.
 * - head_of_it: approve pending accounts (as staff), disable/enable staff accounts; never superadmin or head_of_it accounts.
 * - staff: nothing.
 */
export function canActOnUser(actor: { id: string; role: Role }, target: { id: string; role: Role }, action: UserAction): boolean {
  const self = actor.id === target.id;
  if (self && action !== 'rename') return false;
  if (actor.role === 'superadmin') return true;
  if (actor.role === 'head_of_it') {
    if (target.role !== 'staff') return false;
    return action === 'approve' || action === 'disable' || action === 'enable';
  }
  return false;
}

/** Answer of `GET /api/auth/me` and of a successful login or setup. */
export interface AuthMe {
  /** The account; `null` when the request is authenticated with SOLAR_ACCESS_TOKEN. */
  user: User | null;
  role: Role;
  permissions: Permission[];
  /** `session` = the solar_session cookie; `token` = SOLAR_ACCESS_TOKEN (acts as a superadmin). */
  via: 'session' | 'token';
}

/** Answer of `GET /api/auth/state` (public: what the login screen needs). */
export interface AuthState {
  appName: string;
  version: string;
  /** No account exists yet: the first superadmin is created with POST /api/auth/setup. */
  setupRequired: boolean;
  /**
   * The setup needs `setupCode`: the one-time code printed in the server log at startup and stored in
   * DATA_DIR/setup-code.txt (not needed with SOLAR_ACCESS_TOKEN). False when no setup is required.
   */
  setupCodeRequired: boolean;
  /** Anyone may register (the account then waits for approval). */
  registrationOpen: boolean;
  /** The current user, when the request carries a valid session (or the access token). */
  me: AuthMe | null;
  /** Password rules, for the forms. */
  passwordPolicy: { minLength: number; maxLength: number };
}

/** Machine-readable `code` of the auth API's errors (next to the human `error` text). */
export type AuthErrorCode =
  | 'unauthenticated'
  | 'invalid_token'
  | 'invalid_credentials'
  | 'account_pending'
  | 'account_disabled'
  | 'rate_limited'
  | 'invalid_input'
  | 'registration_closed'
  | 'username_taken'
  | 'email_taken'
  | 'weak_password'
  | 'setup_not_available'
  | 'setup_forbidden'
  | 'setup_code_invalid'
  | 'busy'
  | 'forbidden'
  | 'not_pending'
  | 'last_superadmin'
  | 'self_action'
  | 'wrong_password'
  | 'user_not_found';

export interface RegisterRequest {
  username: string;
  email: string;
  name: string;
  password: string;
}

/** POST /api/auth/setup: the first superadmin. */
export interface SetupRequest extends RegisterRequest {
  /** The one-time setup code (server log / DATA_DIR/setup-code.txt); not needed with SOLAR_ACCESS_TOKEN. */
  setupCode?: string;
}

export interface LoginRequest {
  /** Username or email. */
  identifier: string;
  password: string;
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
  /** SOLAR_ACCESS_TOKEN is set (it then also works as a superadmin API token). Users always log in. */
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
  | { kind: 'plugins'; plugins: PluginStatus[] }
  /**
   * Sent to users who may see accounts (`users.view`) when a registration arrives or an account changes, so the UI
   * can refresh its user list and show the number of registrations waiting for approval.
   */
  | { kind: 'users_changed'; pendingCount: number }
  /** The stream's session ended (logout, password change, account disabled or deleted, role changed): log in again. */
  | { kind: 'signed_out' };
