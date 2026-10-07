import type {
  Attachment,
  Confirmation,
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

const TOKEN_KEY = 'solar.accessToken';

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

/** Adds the access token to URLs used directly by the browser (SSE, downloads, previews). */
export function withToken(url: string): string {
  const token = getToken();
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error ?? `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export const api = {
  config: () => request<PublicConfig>('GET', '/api/config'),
  createTask: (prompt: string, sessionId: string, attachmentIds: string[] = []) =>
    request<Task>('POST', '/api/tasks', { prompt, sessionId, attachmentIds }),
  listAttachments: (sessionId: string, unsentOnly = false) =>
    request<Attachment[]>('GET', `/api/attachments?sessionId=${encodeURIComponent(sessionId)}${unsentOnly ? '&unsent=1' : ''}`),
  deleteAttachment: (id: string) => request<null>('DELETE', `/api/attachments/${encodeURIComponent(id)}`),
  attachmentDownloadUrl: (id: string) => withToken(`/api/attachments/${encodeURIComponent(id)}/content`),
  attachmentText: async (id: string) => {
    const token = getToken();
    const res = await fetch(`/api/attachments/${encodeURIComponent(id)}/text`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new ApiError(res.status, await res.text());
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
  artifactUrl: (id: string, download = false) => withToken(`/api/artifacts/${encodeURIComponent(id)}/content${download ? '?download=1' : ''}`),
  zipUrl: (taskId: string) => withToken(`/api/tasks/${encodeURIComponent(taskId)}/artifacts.zip`),
  artifactText: async (id: string) => {
    const token = getToken();
    const res = await fetch(`/api/artifacts/${encodeURIComponent(id)}/content`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.text();
  },
};

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
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
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
      else reject(new ApiError(xhr.status, (data as { error?: string } | null)?.error ?? `${xhr.status} ${xhr.statusText}`));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Koneksi ke server terputus saat mengunggah.'));
    xhr.onabort = () => reject(new DOMException('Upload dibatalkan', 'AbortError'));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}
