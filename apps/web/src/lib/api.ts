import type {
  Artifact,
  Attachment,
  Confirmation,
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
  SkillDetail,
  SkillInput,
  Task,
  TaskDetail,
  TaskStats,
  TaskStatus,
} from '@solar/shared';
import { LANGUAGE_HEADER } from '@solar/shared';
import { getLang, t } from './i18n';

const TOKEN_KEY = 'solar.accessToken';

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

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable (private window): the token lives for this page only
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
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
async function failure(res: Response): Promise<ApiError> {
  let data: unknown = null;
  try {
    data = JSON.parse(await res.text());
  } catch {
    // no JSON error body
  }
  return new ApiError(res.status, failureMessage(res.status, res.statusText, data));
}

/**
 * Headers of every request: the access token and the interface language, in which the server writes its messages
 * (errors, warnings, notices).
 */
function baseHeaders(): Record<string, string> {
  const token = getToken();
  return { [LANGUAGE_HEADER]: getLang(), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

/** Adds the access token to URLs used directly by the browser (SSE, downloads, previews). */
export function withToken(url: string): string {
  const token = getToken();
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...baseHeaders(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new ApiError(res.status, failureMessage(res.status, res.statusText, data));
  return data as T;
}

export const api = {
  config: () => request<PublicConfig>('GET', '/api/config'),
  /** The task carries the interface language: the server writes its steps and messages in it. */
  createTask: (prompt: string, sessionId: string, attachmentIds: string[] = []) =>
    request<Task>('POST', '/api/tasks', { prompt, sessionId, attachmentIds, language: getLang() } satisfies CreateTaskRequest),
  listAttachments: (sessionId: string, unsentOnly = false) =>
    request<Attachment[]>('GET', `/api/attachments?sessionId=${encodeURIComponent(sessionId)}${unsentOnly ? '&unsent=1' : ''}`),
  deleteAttachment: (id: string) => request<null>('DELETE', `/api/attachments/${encodeURIComponent(id)}`),
  attachmentDownloadUrl: (id: string) => withToken(`/api/attachments/${encodeURIComponent(id)}/content`),
  attachmentText: async (id: string) => {
    const res = await fetch(`/api/attachments/${encodeURIComponent(id)}/text`, { headers: baseHeaders() });
    if (!res.ok) throw await failure(res);
    return res.text();
  },
  listTasks: (params: { limit?: number; sessionId?: string; status?: TaskStatus } = {}) => {
    const q = new URLSearchParams();
    if (params.limit) q.set('limit', String(params.limit));
    if (params.sessionId) q.set('sessionId', params.sessionId);
    if (params.status) q.set('status', params.status);
    return request<Task[]>('GET', `/api/tasks?${q.toString()}`);
  },
  stats: () => request<TaskStats>('GET', '/api/tasks/stats'),
  task: (id: string) => request<TaskDetail>('GET', `/api/tasks/${encodeURIComponent(id)}`),
  cancelTask: (id: string) => request<{ ok: true }>('POST', `/api/tasks/${encodeURIComponent(id)}/cancel`),
  confirmations: () => request<Confirmation[]>('GET', '/api/confirmations'),
  resolveConfirmation: (id: string, approved: boolean, note?: string) =>
    request<{ ok: true }>('POST', `/api/confirmations/${encodeURIComponent(id)}`, { approved, note }),
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
  artifactUrl: (id: string, download = false) => withToken(`/api/artifacts/${encodeURIComponent(id)}/content${download ? '?download=1' : ''}`),
  /** Creates the Word (.docx) file of a TSD made without one; `artifactId` is any artifact of the TSD (e.g. its .tsd.json). */
  exportWord: (artifactId: string) => request<WordExport>('POST', `/api/artifacts/${encodeURIComponent(artifactId)}/docx`),
  zipUrl: (taskId: string) => withToken(`/api/tasks/${encodeURIComponent(taskId)}/artifacts.zip`),
  artifactText: async (id: string) => {
    const res = await fetch(`/api/artifacts/${encodeURIComponent(id)}/content`, { headers: baseHeaders() });
    if (!res.ok) throw await failure(res);
    return res.text();
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
  const res = await fetch(`${path}?${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', ...baseHeaders() },
    body: file,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new ApiError(res.status, failureMessage(res.status, res.statusText, data));
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
      else reject(new ApiError(xhr.status, failureMessage(xhr.status, xhr.statusText, data)));
    };
    xhr.onerror = () => reject(new ApiError(0, t().api.uploadDisconnected));
    xhr.onabort = () => reject(new DOMException(t().api.uploadCancelled, 'AbortError'));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}
