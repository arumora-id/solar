import { renderMarkdown } from '../util/markdown.js';

export interface PlaneConfig {
  apiKey: string;
  workspaceSlug: string;
  hostUrl: string;
}

export interface PlaneProject {
  id: string;
  name: string;
  identifier: string;
}

export interface BacklogItemInput {
  ref: string;
  name: string;
  description?: string;
  priority?: 'urgent' | 'high' | 'medium' | 'low' | 'none';
  labels?: string[];
  parentRef?: string;
}

export interface CreatedBacklogItem {
  ref: string;
  id: string;
  key: string;
  name: string;
  skipped?: boolean;
}

interface PlaneIssue {
  id: string;
  name: string;
  sequence_id?: number;
}

interface PlaneLabel {
  id: string;
  name: string;
}

const MAX_THROTTLE_RETRIES = 4;

/** Retry-After is seconds (DRF) or an HTTP date; default to Plane's one-minute window. */
export function retryAfterMs(header: string | null): number {
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(120, seconds) * 1000 + 250;
    const at = Date.parse(header);
    if (!Number.isNaN(at)) return Math.min(120_000, Math.max(0, at - Date.now())) + 250;
  }
  return 60_000;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('Aborted'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason ?? new Error('Aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const LABEL_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#64748b'];

/** Plane REST API (same endpoints as the official Plane MCP server). */
export class PlaneClient {
  private readonly base: string;

  constructor(private readonly cfg: PlaneConfig) {
    this.base = `${cfg.hostUrl.replace(/\/+$/, '')}/api/v1/workspaces/${encodeURIComponent(cfg.workspaceSlug)}`;
  }

  private async request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${this.base}${path}`, {
        method,
        signal,
        headers: {
          'X-API-Key': this.cfg.apiKey,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      // Plane throttles API keys (default 60 requests/minute): wait as told by Retry-After, then retry
      if (res.status === 429 && attempt < MAX_THROTTLE_RETRIES) {
        await sleep(retryAfterMs(res.headers.get('retry-after')), signal);
        continue;
      }
      if (!res.ok) throw new Error(`Plane ${method} ${path} failed (${res.status}): ${text.slice(0, 500)}`);
      return (text ? JSON.parse(text) : {}) as T;
    }
  }

  private async listAll<T>(path: string, signal?: AbortSignal): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const sep = path.includes('?') ? '&' : '?';
      const data = await this.request<T[] | { results?: T[]; next_cursor?: string; next_page_results?: boolean }>(
        'GET',
        `${path}${sep}per_page=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        undefined,
        signal,
      );
      if (Array.isArray(data)) return data;
      out.push(...(data.results ?? []));
      if (!data.next_page_results || !data.next_cursor) break;
      cursor = data.next_cursor;
    }
    return out;
  }

  async listProjects(signal?: AbortSignal): Promise<PlaneProject[]> {
    const projects = await this.listAll<PlaneProject>('/projects/', signal);
    return projects.map((p) => ({ id: p.id, name: p.name, identifier: p.identifier }));
  }

  async getProject(projectId: string, signal?: AbortSignal): Promise<PlaneProject> {
    const p = await this.request<PlaneProject>('GET', `/projects/${encodeURIComponent(projectId)}/`, undefined, signal);
    return { id: p.id, name: p.name, identifier: p.identifier };
  }

  /**
   * Creates backlog items in order (parents before children), creating missing labels by name.
   * With `skipExisting`, items whose name already exists in the project are not duplicated.
   */
  async createBacklog(
    projectId: string,
    items: BacklogItemInput[],
    options: { skipExisting: boolean; signal?: AbortSignal },
  ): Promise<{ project: PlaneProject; created: CreatedBacklogItem[]; error?: string }> {
    const { signal } = options;
    const project = await this.getProject(projectId, signal);
    const pid = encodeURIComponent(projectId);

    // validate references and order parents first
    const refs = new Set<string>();
    for (const item of items) {
      if (refs.has(item.ref)) throw new Error(`Duplicate backlog ref "${item.ref}"`);
      refs.add(item.ref);
    }
    for (const item of items) {
      if (item.parentRef && !refs.has(item.parentRef)) throw new Error(`Item "${item.ref}" references unknown parentRef "${item.parentRef}"`);
    }
    const ordered: BacklogItemInput[] = [];
    const placed = new Set<string>();
    const visit = (item: BacklogItemInput, trail: string[]) => {
      if (placed.has(item.ref)) return;
      if (trail.includes(item.ref)) throw new Error(`Circular parentRef chain: ${[...trail, item.ref].join(' -> ')}`);
      if (item.parentRef) visit(items.find((i) => i.ref === item.parentRef)!, [...trail, item.ref]);
      placed.add(item.ref);
      ordered.push(item);
    };
    items.forEach((i) => visit(i, []));

    // labels
    const wanted = [...new Set(items.flatMap((i) => i.labels ?? []).map((l) => l.trim()).filter(Boolean))];
    const labelIds = new Map<string, string>();
    if (wanted.length) {
      const existing = await this.listAll<PlaneLabel>(`/projects/${pid}/labels/`, signal);
      for (const l of existing) labelIds.set(l.name.toLowerCase(), l.id);
      let colour = 0;
      for (const name of wanted) {
        if (labelIds.has(name.toLowerCase())) continue;
        const created = await this.request<PlaneLabel>(
          'POST',
          `/projects/${pid}/labels/`,
          { name, color: LABEL_COLORS[colour++ % LABEL_COLORS.length] },
          signal,
        );
        labelIds.set(name.toLowerCase(), created.id);
      }
    }

    const existingByName = new Map<string, PlaneIssue>();
    if (options.skipExisting) {
      for (const issue of await this.listAll<PlaneIssue>(`/projects/${pid}/issues/`, signal)) {
        existingByName.set(issue.name.trim().toLowerCase(), issue);
      }
    }

    const ids = new Map<string, string>();
    const created: CreatedBacklogItem[] = [];
    try {
      await this.createItems(pid, project, ordered, { existingByName, labelIds, ids, created, signal });
    } catch (err) {
      if (signal?.aborted) throw err;
      // keep what was already created so the caller can report it (and resume with skipExisting)
      return { project, created, error: err instanceof Error ? err.message : String(err) };
    }
    return { project, created };
  }

  private async createItems(
    pid: string,
    project: PlaneProject,
    ordered: BacklogItemInput[],
    state: {
      existingByName: Map<string, PlaneIssue>;
      labelIds: Map<string, string>;
      ids: Map<string, string>;
      created: CreatedBacklogItem[];
      signal?: AbortSignal;
    },
  ): Promise<void> {
    const { existingByName, labelIds, ids, created, signal } = state;
    for (const item of ordered) {
      const existing = existingByName.get(item.name.trim().toLowerCase());
      if (existing) {
        ids.set(item.ref, existing.id);
        created.push({ ref: item.ref, id: existing.id, key: `${project.identifier}-${existing.sequence_id ?? '?'}`, name: existing.name, skipped: true });
        continue;
      }
      const body: Record<string, unknown> = {
        name: item.name,
        description_html: item.description ? renderMarkdown(item.description) : '<p></p>',
        priority: item.priority ?? 'none',
      };
      const labels = (item.labels ?? []).map((l) => labelIds.get(l.trim().toLowerCase())).filter(Boolean);
      if (labels.length) body.labels = labels;
      if (item.parentRef) body.parent = ids.get(item.parentRef);
      const issue = await this.request<PlaneIssue>('POST', `/projects/${pid}/issues/`, body, signal);
      ids.set(item.ref, issue.id);
      created.push({ ref: item.ref, id: issue.id, key: `${project.identifier}-${issue.sequence_id ?? '?'}`, name: issue.name });
    }
  }
}
