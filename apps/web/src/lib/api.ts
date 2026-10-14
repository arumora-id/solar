import type {
  ActivityActionInfo,
  ActivityOutcome,
  ActivityPage,
  Artifact,
  Attachment,
  AuthMe,
  AuthState,
  Confirmation,
  ContentProposal,
  CreateTaskRequest,
  KnowledgeEntry,
  KnowledgeFile,
  KnowledgeSearchHit,
  KnowledgeType,
  LlmProviderConfig,
  LlmSettingsView,
  LlmTestResult,
  PluginConfig,
  PluginView,
  PublicConfig,
  RegisterRequest,
  Role,
  RoleInfo,
  SetupRequest,
  SkillDetail,
  SkillInput,
  Task,
  TaskDetail,
  TaskStats,
  TaskStatus,
  User,
  UserStatus,
} from '@solar/shared';
import { LANGUAGE_HEADER } from '@solar/shared';
import { getLang, t, type Lang } from './i18n';

/**
 * Where older versions kept the SOLAR_ACCESS_TOKEN typed into the web UI. Users now log in with an account (session
 * cookie); a token left in the browser would be sent as a wrong token and refused (401 invalid_token), so it is removed.
 */
const LEGACY_TOKEN_KEY = 'solar.accessToken';

/** Removes the access token older versions stored (call once at startup). */
export function clearLegacyToken(): void {
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    // storage unavailable: nothing was stored either
  }
}

export interface ArtifactKnowledgeImport {
  artifactId: string;
  type: KnowledgeType;
  path?: string;
  id?: string;
  title?: string;
  aliases?: string[];
  overwrite?: boolean;
}

/** Answer of POST /api/artifacts/:id/docx (Word file of a Technical Specification Document). */
export interface WordExport {
  artifact: Artifact;
  /** false when the TSD already had a Word file, which is returned as it is */
  created: boolean;
  warnings: string[];
}

/** A server-filtered slice of the complete authorized task history. */
export interface TaskPage {
  items: Task[];
  total: number;
  limit: number;
  offset: number;
  hasNext: boolean;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The server's machine-readable reason (`{ code }`), e.g. `invalid_credentials`, `last_superadmin`. */
    readonly code?: string,
    /** Seconds to wait before trying again (`Retry-After` of a 429 / 503). */
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

/** The `code` of a failed API call, if the server sent one. */
export function errorCode(err: unknown): string | undefined {
  return err instanceof ApiError ? err.code : undefined;
}

/**
 * Called when the server answers 401 to a request outside the public auth routes: the session ended (expired, logged
 * out elsewhere, account disabled or deleted). lib/auth.tsx returns to the login screen.
 */
type UnauthorizedListener = (code: string | undefined) => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

/** The routes that answer 401 as part of their job (wrong password...), not because the session ended. */
const PUBLIC_AUTH_ROUTE = /^\/api\/auth\/(?:state|login|register|setup|logout)(?:[/?]|$)/;

function noticeUnauthorized(path: string, status: number, code: string | undefined): void {
  if (status !== 401 || PUBLIC_AUTH_ROUTE.test(path)) return;
  for (const listener of [...unauthorizedListeners]) listener(code);
}

function codeOf(data: unknown): string | undefined {
  const code = (data as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code ? code : undefined;
}

function retryAfterOf(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/** A failed response as an ApiError (message, code, Retry-After); a 401 also ends the session (see onUnauthorized). */
function apiError(path: string, status: number, statusText: string, data: unknown, retryAfter: string | null): ApiError {
  const code = codeOf(data);
  noticeUnauthorized(path, status, code);
  return new ApiError(status, failureMessage(status, statusText, data), code, retryAfterOf(retryAfter));
}

/**
 * The message of a failed response: the server's `{error}` (already in the interface language), otherwise a generic
 * text with the HTTP status (a proxy's or framework's own error page is not shown).
 */
function failureMessage(status: number, statusText: string, data: unknown): string {
  const error = (data as { error?: unknown } | null)?.error;
  return typeof error === 'string' && error ? error : t().api.httpError(status, statusText);
}

/** A failed response read as an ApiError (for requests whose success body is not JSON). */
async function failure(path: string, res: Response): Promise<ApiError> {
  let data: unknown = null;
  try {
    data = JSON.parse(await res.text());
  } catch {
    // no JSON error body
  }
  return apiError(path, res.status, res.statusText, data, res.headers.get('Retry-After'));
}

/**
 * Headers of every request: the interface language, in which the server writes its messages (errors, warnings,
 * notices). Who is asking travels in the session cookie (HttpOnly, sent by the browser - also for the event stream,
 * downloads and previews, which therefore need nothing added to their URLs).
 */
function baseHeaders(): Record<string, string> {
  return { [LANGUAGE_HEADER]: getLang() };
}

/**
 * Adds the interface language to URLs the browser opens itself (the event stream, downloads), which cannot carry the
 * language header: the server writes their texts (a zip's README, an error page, plugin statuses) in it.
 */
export function withLang(url: string, lang: Lang = getLang()): string {
  return `${url}${url.includes('?') ? '&' : '?'}lang=${lang}`;
}

/**
 * fetch(), with a network failure (server down, connection lost) turned into an ApiError with status 0 and a message
 * in the interface language: the browser's own text ("Failed to fetch", "NetworkError when attempting to fetch
 * resource.") is in its language and means nothing to users. An abort is passed on as it is.
 */
async function send(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, t().api.unreachable);
  }
}

/** The body of a response; the connection dropping while it is read is the same failure as in send(). */
async function readText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, t().api.unreachable);
  }
}

/** true for an ApiError raised because the server could not be reached (no HTTP answer at all). */
export function isUnreachable(err: unknown): boolean {
  return err instanceof ApiError && err.status === 0;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await send(path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...baseHeaders(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await readText(res);
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw apiError(path, res.status, res.statusText, data, res.headers.get('Retry-After'));
  return data as T;
}

/** Query string of the set values (empty strings and undefined are left out). */
function query(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') q.set(key, String(value));
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** Filters of the activity log (GET /api/activity and the CSV export). */
export interface ActivityFilters {
  /** A user id, `me` or `system:access-token` (only for activity.view_all). */
  actor?: string;
  /** Codes separated by commas; `user.*` = every code of a group. */
  action?: string;
  outcome?: ActivityOutcome;
  /** `YYYY-MM-DD` (start of that day) or ISO time. */
  from?: string;
  /** `YYYY-MM-DD` (up to the end of that day) or ISO time. */
  to?: string;
  q?: string;
}

const userPath = (id: string) => `/api/users/${encodeURIComponent(id)}`;

export const api = {
  /** Login state of this browser (public): setup needed, registration open, the current user. */
  authState: () => request<AuthState>('GET', '/api/auth/state'),
  /** `identifier` = username or email. Sets the session cookie. */
  login: (identifier: string, password: string) => request<AuthMe>('POST', '/api/auth/login', { identifier, password }),
  /** Self-registration: the account waits for approval (no session). */
  register: (input: RegisterRequest) => request<{ status: 'pending' }>('POST', '/api/auth/register', input),
  /** The first superadmin (only while no account exists); logs in. */
  setup: (input: SetupRequest) => request<AuthMe>('POST', '/api/auth/setup', input),
  me: () => request<AuthMe>('GET', '/api/auth/me'),
  logout: () => request<null>('POST', '/api/auth/logout'),
  /** Ends the user's other sessions; this one stays. */
  changePassword: (currentPassword: string, newPassword: string) => request<null>('POST', '/api/auth/password', { currentPassword, newPassword }),

  users: (status?: UserStatus) => request<User[]>('GET', `/api/users${query({ status })}`),
  pendingCount: () => request<{ count: number }>('GET', '/api/users/pending-count'),
  createUser: (input: RegisterRequest & { role: Role }) => request<User>('POST', '/api/users', input),
  updateUser: (id: string, patch: { role?: Role; status?: 'active' | 'disabled'; name?: string }) => request<User>('PATCH', userPath(id), patch),
  approveUser: (id: string, role?: Role) => request<User>('POST', `${userPath(id)}/approve`, role ? { role } : {}),
  resetPassword: (id: string, password: string) => request<null>('POST', `${userPath(id)}/password`, { password }),
  deleteUser: (id: string) => request<null>('DELETE', userPath(id)),
  roles: () => request<RoleInfo[]>('GET', '/api/roles'),

  activity: (filters: ActivityFilters, cursor?: string | null, limit = 50) =>
    request<ActivityPage>('GET', `/api/activity${query({ ...filters, cursor, limit })}`),
  activityActions: () => request<ActivityActionInfo[]>('GET', '/api/activity/actions'),
  /** The filtered log as a CSV file the browser downloads (labels and summaries in the interface language). */
  activityCsvUrl: (filters: ActivityFilters) => withLang(`/api/activity.csv${query({ ...filters })}`),

  config: () => request<PublicConfig>('GET', '/api/config'),
  /** The task carries the interface language: the server writes its steps and messages in it. */
  createTask: (prompt: string, sessionId: string, attachmentIds: string[] = []) =>
    request<Task>('POST', '/api/tasks', { prompt, sessionId, attachmentIds, language: getLang() } satisfies CreateTaskRequest),
  listAttachments: (sessionId: string, unsentOnly = false) =>
    request<Attachment[]>('GET', `/api/attachments?sessionId=${encodeURIComponent(sessionId)}${unsentOnly ? '&unsent=1' : ''}`),
  deleteAttachment: (id: string) => request<null>('DELETE', `/api/attachments/${encodeURIComponent(id)}`),
  /** The original file of an attachment, downloaded by the browser (an error page is in the interface language). */
  attachmentDownloadUrl: (id: string) => withLang(`/api/attachments/${encodeURIComponent(id)}/content`),
  attachmentText: async (id: string) => {
    const path = `/api/attachments/${encodeURIComponent(id)}/text`;
    const res = await send(path, { headers: baseHeaders() });
    if (!res.ok) throw await failure(path, res);
    return readText(res);
  },
  /** `owner` (tasks.all only): `me`, `none` (tasks from before accounts) or a user id. */
  listTasks: (params: { limit?: number; sessionId?: string; status?: TaskStatus; owner?: string } = {}) =>
    request<Task[]>('GET', `/api/tasks${query({ limit: params.limit, sessionId: params.sessionId, status: params.status, owner: params.owner })}`),
  taskPage: (params: { limit: 5 | 10 | 20 | 50 | 100; offset: number; status?: TaskStatus | 'active'; owner?: string; search?: string }) =>
    request<TaskPage>('GET', `/api/tasks/page${query(params)}`),
  stats: () => request<TaskStats>('GET', '/api/tasks/stats'),
  task: (id: string) => request<TaskDetail>('GET', `/api/tasks/${encodeURIComponent(id)}`),
  cancelTask: (id: string) => request<{ ok: true }>('POST', `/api/tasks/${encodeURIComponent(id)}/cancel`),
  confirmations: () => request<Confirmation[]>('GET', '/api/confirmations'),
  resolveConfirmation: (id: string, approved: boolean, note?: string) =>
    request<{ ok: true }>('POST', `/api/confirmations/${encodeURIComponent(id)}`, { approved, note }),
  contentProposals: () => request<ContentProposal[]>('GET', '/api/content-proposals'),
  createContentProposal: (input: { kind: 'skill' | 'knowledge'; title: string; description?: string; path?: string; content: string }) =>
    request<ContentProposal>('POST', '/api/content-proposals', input),
  reviewContentProposal: (id: string, approved: boolean, reason: string) =>
    request<ContentProposal>('POST', `/api/content-proposals/${encodeURIComponent(id)}/review`, { approved, reason }),
  skills: () => request<SkillDetail[]>('GET', '/api/skills'),
  createSkill: (input: SkillInput) => request<SkillDetail>('POST', '/api/skills', input),
  importSkill: (markdown: string) => request<SkillDetail>('POST', '/api/skills/import', { markdown }),
  updateSkill: (id: string, input: Partial<SkillInput>) => request<SkillDetail>('PUT', `/api/skills/${encodeURIComponent(id)}`, input),
  deleteSkill: (id: string) => request<{ result: string }>('DELETE', `/api/skills/${encodeURIComponent(id)}`),
  plugins: () => request<PluginView[]>('GET', '/api/plugins'),
  createPlugin: (input: Partial<PluginConfig>) => request<PluginView>('POST', '/api/plugins', input),
  updatePlugin: (id: string, input: Partial<PluginConfig>) => request<PluginView>('PUT', `/api/plugins/${encodeURIComponent(id)}`, input),
  reconnectPlugin: (id: string) => request<PluginView>('POST', `/api/plugins/${encodeURIComponent(id)}/reconnect`),
  deletePlugin: (id: string) => request<{ ok: true }>('DELETE', `/api/plugins/${encodeURIComponent(id)}`),
  llm: () => request<LlmSettingsView>('GET', '/api/llm'),
  createProvider: (input: Partial<LlmProviderConfig>) => request<LlmSettingsView>('POST', '/api/llm/providers', input),
  updateProvider: (id: string, input: Partial<LlmProviderConfig>) => request<LlmSettingsView>('PUT', `/api/llm/providers/${encodeURIComponent(id)}`, input),
  deleteProvider: (id: string) => request<LlmSettingsView>('DELETE', `/api/llm/providers/${encodeURIComponent(id)}`),
  testProvider: (id: string) => request<LlmTestResult>('POST', `/api/llm/providers/${encodeURIComponent(id)}/test`),
  setRoutes: (routes: Record<string, string[]>) => request<LlmSettingsView>('PUT', '/api/llm/routes', { routes }),
  knowledge: () => request<KnowledgeEntry[]>('GET', '/api/knowledge'),
  knowledgeFile: (path: string) => request<KnowledgeFile>('GET', `/api/knowledge/file?path=${encodeURIComponent(path)}`),
  saveKnowledge: (path: string, content: string) => request<KnowledgeEntry>('PUT', '/api/knowledge/file', { path, content }),
  /** Saves a Markdown artifact as a knowledge file; ApiError 409 when the path is taken (retry with overwrite). */
  importArtifactToKnowledge: (input: ArtifactKnowledgeImport) =>
    request<{ entry: KnowledgeEntry; replaced: 'user' | 'builtin' | null }>('POST', '/api/knowledge/import-artifact', input),
  deleteKnowledge: (path: string) => request<{ result: string }>('DELETE', `/api/knowledge/file?path=${encodeURIComponent(path)}`),
  searchKnowledge: (q: string, type?: KnowledgeType) =>
    request<KnowledgeSearchHit[]>('GET', `/api/knowledge/search?q=${encodeURIComponent(q)}${type ? `&type=${type}` : ''}`),
  importKnowledge: (files: Array<{ path: string; content: string }>) =>
    request<{ imported: KnowledgeEntry[]; failed: Array<{ path: string; error: string }> }>('POST', '/api/knowledge/import', { files }),
  previewTables: (file: File) => uploadFile<SheetPreview[]>('/api/knowledge/tables', file),
  importTable: (file: File, options: TableImportOptions) =>
    uploadFile<{ written: KnowledgeEntry[]; removed: string[]; skipped: Array<{ row: number; reason: string }>; index: string }>(
      '/api/knowledge/import-table',
      file,
      options,
    ),
  importDocument: (file: File, options: DocumentImportOptions) =>
    uploadFile<{ written: KnowledgeEntry[]; removed: string[]; warnings: string[] }>('/api/knowledge/import-document', file, options),
  /**
   * An artifact's content: shown in place (<img>, <iframe>; the URL stays the same across a language switch, so nothing
   * reloads) or, with `download`, saved by the browser (with the interface language for a possible error page).
   */
  artifactUrl: (id: string, download = false) => {
    const url = `/api/artifacts/${encodeURIComponent(id)}/content`;
    return download ? withLang(`${url}?download=1`) : url;
  },
  /** Creates the Word (.docx) file of a TSD made without one; `artifactId` is any artifact of the TSD (e.g. its .tsd.json). */
  exportWord: (artifactId: string) => request<WordExport>('POST', `/api/artifacts/${encodeURIComponent(artifactId)}/docx`),
  /** All artifacts of a task as a zip; its README.txt is written in the interface language. */
  zipUrl: (taskId: string) => withLang(`/api/tasks/${encodeURIComponent(taskId)}/artifacts.zip`),
  artifactText: async (id: string) => {
    const path = `/api/artifacts/${encodeURIComponent(id)}/content`;
    const res = await send(path, { headers: baseHeaders() });
    if (!res.ok) throw await failure(path, res);
    return readText(res);
  },
};

export interface SheetPreview {
  name: string;
  headers: string[];
  rows: number;
  sample: string[][];
  truncated: boolean;
}

export interface TableImportOptions {
  sheet: string;
  headerRow: number;
  idColumn: string;
  titleColumn?: string;
  aliasColumns: string[];
  statusColumn?: string;
  folder: string;
  type?: KnowledgeType;
  removeStale: boolean;
}

export interface DocumentImportOptions {
  folder: string;
  split: 'none' | 1 | 2;
  type?: KnowledgeType;
  title?: string;
  removeStale: boolean;
}

/** Sends a file as the raw body (options as a JSON query parameter). */
async function uploadFile<T>(path: string, file: File, options?: unknown): Promise<T> {
  const qs = `name=${encodeURIComponent(file.name)}${options === undefined ? '' : `&options=${encodeURIComponent(JSON.stringify(options))}`}`;
  const res = await send(`${path}?${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', ...baseHeaders() },
    body: file,
  });
  const text = await readText(res);
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw apiError(path, res.status, res.statusText, data, res.headers.get('Retry-After'));
  return data as T;
}

export interface UploadHandle {
  promise: Promise<Attachment>;
  abort(): void;
}

/**
 * Uploads a document as the raw request body (XHR, for upload progress). The server extracts its text before
 * answering, so `onProgress('read')` means "uploaded, now being read".
 */
export function uploadAttachment(file: File, sessionId: string, onProgress: (phase: 'upload' | 'read', fraction: number) => void): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<Attachment>((resolve, reject) => {
    xhr.open('POST', `/api/attachments?sessionId=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    for (const [name, value] of Object.entries(baseHeaders())) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress('upload', e.loaded / e.total);
    };
    xhr.upload.onload = () => onProgress('read', 1);
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as Attachment);
      else reject(apiError('/api/attachments', xhr.status, xhr.statusText, data, xhr.getResponseHeader('Retry-After')));
    };
    xhr.onerror = () => reject(new ApiError(0, t().api.uploadDisconnected));
    xhr.onabort = () => reject(new DOMException(t().api.uploadCancelled, 'AbortError'));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}
