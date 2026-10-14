import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { zipSync, strToU8 } from 'fflate';
import { z } from 'zod';
import { slugify } from '../util/ids.js';
import {
  ATTACHMENT_EXTENSIONS,
  can,
  LANGUAGES,
  type ActivityAction,
  type Artifact,
  type ContentProposal,
  type Attachment,
  type KnowledgeType,
  type PluginView,
  type PublicConfig,
  type StreamMessage,
  type Task,
  type TaskOwner,
  type TaskStatus,
} from '@solar/shared';
import type { ActivityInput, ActivityLog, ActivityTarget } from '../activity/activityLog.js';
import type { AuthService, Principal } from '../auth/authService.js';
import type { ContentProposalStore } from '../approvals/contentProposalStore.js';
import { authenticate, principalOf, requestMeta, requirePermission, requireUser, sameOriginGuard } from '../auth/http.js';
import { APP_NAME, APP_VERSION, type AppConfig } from '../config.js';
import { errorMessage, langOf, t, taskLang, type Lang } from '../i18n.js';
import { formatZodIssues, zodErrorMap } from '../i18n/zodIssues.js';
import { KNOWLEDGE_TYPES, MAX_KNOWLEDGE_FILE_BYTES, type KnowledgeStore } from '../knowledge/knowledgeStore.js';
import { LlmProviderBaseSchema, RoutesSchema, type LlmProviderStore } from '../llm/providerStore.js';
import type { ModelRouter } from '../llm/router.js';
import type { McpManager } from '../plugins/mcpManager.js';
import { maskPlugin, PluginConfigBaseSchema, type PluginStore } from '../plugins/pluginStore.js';
import type { SkillStore } from '../skills/skillStore.js';
import type { Repository } from '../storage/repository.js';
import { DocumentError } from '../documents/index.js';
import { extractIsolated } from '../documents/isolated.js';
import { importDocument } from '../knowledge/documentImport.js';
import { importTable, MAX_IMPORT_ROWS, previewTables } from '../knowledge/tableImport.js';
import { importArtifactToKnowledge, KnowledgeConflictError, KnowledgeInputError } from '../knowledge/knowledgeWrite.js';
import type { ArtifactService } from '../tasks/artifactService.js';
import type { AttachmentService } from '../tasks/attachmentService.js';
import type { EventBus, MessageScope } from '../tasks/eventBus.js';
import type { TaskManager } from '../tasks/taskManager.js';
import { exportTechSpecDocx, TechSpecDocxError } from '../tasks/techSpecDocx.js';
import { registerActivityRoutes, requestActivity } from './activity.js';
import { createAuthRouter, createUsersRouter } from './auth.js';
import { HttpError } from './httpError.js';

export { HttpError } from './httpError.js';

export interface ApiDeps {
  config: AppConfig;
  repo: Repository;
  objectsKind: 's3' | 'local-file';
  tasks: TaskManager;
  artifacts: ArtifactService;
  attachments: AttachmentService;
  bus: EventBus;
  skills: SkillStore;
  plugins: PluginStore;
  mcp: McpManager;
  knowledge: KnowledgeStore;
  llm: LlmProviderStore;
  models: ModelRouter;
  auth: AuthService;
  activity: ActivityLog;
  contentProposals: ContentProposalStore;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * Language the API answers this request in, set by languageMiddleware before every API route (code that may run
       * before it, such as the app's error handler, reads it with langOf).
       */
      lang: Lang;
    }
  }
}

/**
 * Sets `req.lang`, the language of the API's messages for this request: the web client's `X-Solar-Language` header,
 * else a `lang` query parameter (the event stream and download links cannot send headers), else Accept-Language
 * (en* -> English, id* / ms* -> Indonesian), else Indonesian.
 */
export function languageMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.lang = langOf(req);
  next();
}

/** A store's or a parser's error as an HTTP error, its message in the language of the request. */
function httpError(status: number, err: unknown, lang: Lang): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof z.ZodError) return new HttpError(400, formatZodIssues(err.issues, lang));
  return new HttpError(status, errorMessage(err, lang));
}

const ATTACHMENT_ID = /^att_[A-Za-z0-9]+$/;

const TASK_STATUSES = ['queued', 'running', 'awaiting_confirmation', 'completed', 'failed', 'cancelled'] as const;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function hostnameOf(hostHeader: string): string {
  // "127.0.0.1:8790" -> "127.0.0.1", "[::1]:8790" -> "[::1]"
  const h = hostHeader.trim().toLowerCase();
  return h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0]!;
}

/**
 * Without an access token the API is served for the local machine only (HOST names it): a DNS-rebinding page
 * (evil.example -> 127.0.0.1) must not reach it under a name of its own - e.g. the public first-superadmin setup, which
 * is open to local requests (with the one-time setup code). So the Host header must name this machine and a browser
 * Origin, when present, must be local too. With SOLAR_ACCESS_TOKEN set the server is meant for the network; user
 * logins (cookie) are then protected by the same-origin check of sameOriginGuard, and the setup needs the token, or a
 * direct request on the server itself with the setup code.
 */
export function localOnlyMiddleware(token: string | undefined, configuredHost: string) {
  const allowed = new Set(LOOPBACK_HOSTS);
  if (!['0.0.0.0', '::'].includes(configuredHost)) allowed.add(configuredHost.toLowerCase());
  return (req: Request, _res: Response, next: NextFunction) => {
    if (token) return next();
    const host = req.headers.host ? hostnameOf(req.headers.host) : '';
    if (!allowed.has(host)) {
      return next(new HttpError(403, t(langOf(req), 'api.forbiddenHost', { host })));
    }
    const origin = req.headers.origin;
    if (origin !== undefined) {
      let originHost = '';
      try {
        originHost = new URL(origin).hostname.toLowerCase();
      } catch {
        // "null" or malformed origins are rejected below
      }
      const normalized = originHost.includes(':') && !originHost.startsWith('[') ? `[${originHost}]` : originHost;
      if (!allowed.has(normalized) && !allowed.has(originHost)) {
        return next(new HttpError(403, t(langOf(req), 'api.forbiddenOrigin', { origin })));
      }
    }
    next();
  };
}

/** Validates a request body or query; the messages are in `lang`, the field paths stay as they are ("prompt: ..."). */
function parse<T extends z.ZodType>(schema: T, value: unknown, lang: Lang): z.output<T> {
  const r = schema.safeParse(value, { error: zodErrorMap(lang) });
  if (!r.success) throw new HttpError(400, formatZodIssues(r.error.issues, lang, true));
  return r.data;
}

/** Keeps only the keys the client actually sent (zod defaults must not overwrite stored values on PATCH-like updates). */
function onlySent<T extends Record<string, unknown>>(parsed: T, body: unknown): Partial<T> {
  const sent = body && typeof body === 'object' ? Object.keys(body) : [];
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => sent.includes(k))) as Partial<T>;
}

function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Whether a principal receives a stream message of this scope (see EventBus). */
export function streamVisible(principal: Principal, scope: MessageScope | undefined): boolean {
  if (!scope) return true;
  if (scope.kind === 'permission') return can(principal.role, scope.permission);
  return can(principal.role, 'tasks.all') || (scope.ownerId !== null && scope.ownerId === principal.id);
}

export function createApiRouter(deps: ApiDeps): Router {
  const { config, tasks, artifacts, attachments, skills, plugins, mcp, bus, knowledge, llm, models, auth, activity, contentProposals } = deps;
  const r = express.Router();
  r.use(languageMiddleware);
  const jsonBody = express.json({ limit: '4mb' });
  // the knowledge import parses its own (larger) body
  r.use((req, res, next) => (req.path === '/knowledge/import' ? next() : jsonBody(req, res, next)));

  r.get('/health', (_req, res) => {
    res.json({ ok: true, name: APP_NAME, version: APP_VERSION });
  });

  r.use(localOnlyMiddleware(config.accessToken, config.host));
  // req.principal: the session cookie's account, or the access token acting as a superadmin
  r.use(authenticate(auth));
  // CSRF: state-changing requests not authenticated by a valid access token must come from SOLAR's own origin
  r.use(sameOriginGuard(config));
  // public: state, login, register, setup (the rest of /auth and everything below need a user)
  r.use('/auth', createAuthRouter({ config, auth }));
  r.use('/users', createUsersRouter({ config, auth }));
  r.use(requireUser);

  /** Records what the request's principal did (in the background: never slows or fails the request). */
  const record = (req: Request, input: Omit<ActivityInput, 'actor' | 'ip' | 'userAgent'>) => activity.record({ ...requestActivity(req), ...input });
  /**
   * Records an attempt refused by a route's permission check (`requirePermission(permission, refused(...))`): the action
   * tried and the target the URL names. Throttled per account, action and target by the AuthService.
   */
  const refused = (action: ActivityAction, target: (req: Request) => ActivityTarget | null) => (req: Request) =>
    auth.auditForbidden(principalOf(req), requestMeta(req), action, target(req));
  const paramId = (req: Request) => (typeof req.params.id === 'string' ? req.params.id : null);

  // roles (every logged-in user) and the activity log (own entries; everyone's with activity.view_all)
  registerActivityRoutes(r, { activity, refused });

  // ---- who may see what --------------------------------------------------------------------------------------------
  /** Roles with tasks.all see every task; everybody else only their own (never the ownerless tasks from before accounts). */
  const seesAll = (req: Request) => can(principalOf(req).role, 'tasks.all');
  const mayAccess = (req: Request, ownerId: string | undefined) => seesAll(req) || (ownerId !== undefined && ownerId === principalOf(req).id);
  /** The task, or 404 also when it exists but belongs to someone else (its existence is not revealed). */
  const visibleTask = async (req: Request, id: string): Promise<Task> => {
    const task = await tasks.get(id);
    if (!task || !mayAccess(req, task.ownerId)) throw new HttpError(404, t(req.lang, 'api.taskNotFound'));
    return task;
  };
  const visibleArtifact = async (req: Request, id: string): Promise<Artifact> => {
    const artifact = await artifacts.get(id);
    const task = artifact ? await tasks.get(artifact.taskId) : null;
    if (!artifact || !task || !mayAccess(req, task.ownerId)) throw new HttpError(404, t(req.lang, 'api.artifactNotFound'));
    return artifact;
  };
  const visibleAttachment = async (req: Request, id: string): Promise<Attachment> => {
    const attachment = await attachments.get(id);
    if (!attachment || !mayAccess(req, attachment.ownerId)) throw new HttpError(404, t(req.lang, 'api.attachmentNotFound'));
    return attachment;
  };
  /** Tasks with their creator, for viewers who see every user's tasks (the monitor shows who asked). */
  const withOwners = async (req: Request, list: Task[]): Promise<Task[]> => {
    if (!seesAll(req)) return list;
    const owners = new Map<string, TaskOwner | null>();
    for (const task of list) {
      const key = task.ownerId ?? '';
      if (!owners.has(key)) owners.set(key, await auth.ownerOf(task.ownerId, req.lang));
    }
    return list.map((task) => ({ ...task, owner: owners.get(task.ownerId ?? '') ?? null }));
  };

  r.get('/config', async (_req, res) => {
    const route = llm.route();
    const primary = route[0] ?? '';
    const ready = models.primaryReady();
    const body: PublicConfig = {
      appName: APP_NAME,
      version: APP_VERSION,
      provider: llm.get(primary.slice(0, primary.indexOf('/')))?.config.name ?? 'OpenAI',
      model: primary.slice(primary.indexOf('/') + 1) || config.openai.model,
      effort: config.openai.effort,
      llmConfigured: ready,
      openaiConfigured: ready,
      modelRoute: route,
      knowledgeFiles: (await knowledge.list()).length,
      authRequired: Boolean(config.accessToken),
      storage: { database: deps.repo.kind, objects: deps.objectsKind },
      github: { configured: Boolean(config.github.token), defaultRepo: config.github.defaultRepo ?? null, defaultBranch: config.github.defaultBranch },
      plane: { hostUrl: config.plane.hostUrl },
      attachments: {
        maxFileMb: Math.round(config.attachments.maxFileBytes / 1024 / 1024),
        maxPerTask: config.attachments.maxPerTask,
        extensions: ATTACHMENT_EXTENSIONS,
      },
    };
    res.json(body);
  });

  // ---- live stream ----------------------------------------------------------
  r.get('/stream', (req, res) => {
    // an EventSource cannot send headers: the language comes from ?lang= or Accept-Language. Task events are written in
    // each task's language; the plugin statuses are sent to each client in its own.
    const lang = req.lang;
    const principal = principalOf(req);
    const ownersVisible = can(principal.role, 'tasks.all');
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let closed = false;
    const send = (data: StreamMessage) => {
      if (!closed) res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    // messages go out in the order they were published, also when one needs a lookup (a task's owner for the monitor)
    let queue: Promise<void> = Promise.resolve();
    const enqueue = (produce: () => StreamMessage | Promise<StreamMessage>) => {
      queue = queue.then(async () => send(await produce())).catch(() => undefined);
    };
    send({ kind: 'hello', serverTime: new Date().toISOString() });
    send({ kind: 'plugins', plugins: mcp.statuses(lang) });
    // each user receives only what they may see: their own tasks (every task for tasks.all), global plugin statuses,
    // account changes for those who manage accounts
    const unsubscribe = bus.subscribe((msg: StreamMessage, scope: MessageScope | undefined) => {
      if (!streamVisible(principal, scope)) return;
      if (msg.kind === 'plugins') enqueue(() => ({ kind: 'plugins', plugins: mcp.statuses(lang) }));
      else if (msg.kind === 'task' && ownersVisible) enqueue(async () => ({ kind: 'task', task: { ...msg.task, owner: await auth.ownerOf(msg.task.ownerId, lang) } }));
      else enqueue(() => msg);
    });
    const end = (signedOut: boolean) => {
      if (closed) return;
      if (signedOut) send({ kind: 'signed_out' });
      closed = true;
      cleanup();
      res.end();
    };
    // the session ending (logout, password change, account disabled/deleted, role changed) closes its streams at once
    const stopRevoked = auth.onRevoked((revocation) => {
      if (principal.sessionHash && revocation.tokenHashes.includes(principal.sessionHash)) end(true);
    });
    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
      // and expiry (idle or absolute) is noticed within a heartbeat
      void auth.stillValid(principal).then((ok) => (ok ? undefined : end(true)), () => undefined);
    }, 20_000);
    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
      stopRevoked();
    };
    req.on('close', () => {
      closed = true;
      cleanup();
    });
  });

  // ---- tasks ----------------------------------------------------------------
  r.post('/tasks', requirePermission('agent.use'), async (req, res) => {
    const body = parse(
      z.object({
        prompt: z.string().trim().min(1).max(50_000),
        sessionId: z.string().trim().min(1).max(100),
        attachmentIds: z.array(z.string().regex(ATTACHMENT_ID)).max(config.attachments.maxPerTask).default([]),
        // the client's interface language: the task's own texts are written in it (default: the request's, i.e. 'id'
        // for a client that names no language)
        language: z.enum(LANGUAGES as [Lang, ...Lang[]]).optional(),
      }),
      req.body,
      req.lang,
    );
    const ids = [...new Set(body.attachmentIds)];
    const owner = principalOf(req).id;
    // validated and created under the conversation lock: a concurrent DELETE cannot remove a document in between
    const task = await attachments.withSession(body.sessionId, async () => {
      const found = await attachments.listByIds(ids);
      for (const id of ids) {
        const a = found.find((x) => x.id === id);
        // another user's upload is "unknown": its existence is not revealed
        if (!a || a.ownerId !== owner) throw new HttpError(400, t(req.lang, 'api.attachmentUnknown', { id }));
        if (a.sessionId !== body.sessionId) throw new HttpError(400, t(req.lang, 'api.attachmentOtherSession', { name: a.name }));
      }
      return tasks.create(body.prompt, body.sessionId, ids, body.language ?? req.lang, owner);
    });
    record(req, {
      action: 'task.create',
      target: { type: 'task', id: task.id, label: task.title },
      details: { language: task.language, attachments: ids.length, sessionId: task.sessionId },
    });
    res.status(201).json(task);
  });

  r.get('/tasks', async (req, res) => {
    const q = parse(
      z.object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        sessionId: z.string().optional(),
        status: z.enum(TASK_STATUSES).optional(),
        // tasks.all only: "me", "none" (tasks from before accounts) or a user id; others always list their own
        owner: z.string().max(100).optional(),
      }),
      req.query,
      req.lang,
    );
    const principal = principalOf(req);
    // a conversation (sessionId) is always the requester's own; the whole list is everyone's for tasks.all
    let ownerId: string | null | undefined = principal.id;
    if (seesAll(req)) {
      if (q.owner === 'none') ownerId = null;
      else if (q.owner && q.owner !== 'me') ownerId = q.owner;
      else if (!q.owner && !q.sessionId) ownerId = undefined;
    }
    const list = await deps.repo.listTasks({ limit: q.limit, offset: q.offset, sessionId: q.sessionId, status: q.status as TaskStatus | undefined, ownerId });
    res.json(await withOwners(req, list));
  });

  /**
   * Server-side Monitor pagination. The legacy GET /tasks array endpoint remains
   * untouched for Conversation, SSE reconnect, and older desktop clients.
   */
  r.get('/tasks/page', async (req, res) => {
    const q = parse(
      z.object({
        limit: z.coerce.number().int().refine((n) => [5, 10, 20, 50, 100].includes(n)).default(5),
        offset: z.coerce.number().int().min(0).default(0),
        status: z.union([z.enum(TASK_STATUSES), z.literal('active')]).optional(),
        owner: z.string().max(100).optional(),
        search: z.string().trim().max(200).optional(),
      }),
      req.query,
      req.lang,
    );
    // Preserve the exact same owner authorization as GET /tasks.
    const principal = principalOf(req);
    let ownerId: string | null | undefined = principal.id;
    if (seesAll(req)) {
      if (q.owner === 'none') ownerId = null;
      else if (q.owner && q.owner !== 'me') ownerId = q.owner;
      else if (!q.owner) ownerId = undefined;
    }
    const filter = { status: q.status, ownerId, search: q.search };
    const [items, total] = await Promise.all([
      deps.repo.listTasks({ ...filter, limit: q.limit, offset: q.offset }),
      deps.repo.countTasks(filter),
    ]);
    res.json({ items: await withOwners(req, items), total, limit: q.limit, offset: q.offset, hasNext: q.offset + items.length < total });
  });

  r.get('/tasks/stats', async (req, res) => {
    res.json(await deps.repo.stats(seesAll(req) ? {} : { ownerId: principalOf(req).id }));
  });

  r.get('/tasks/:id', async (req, res) => {
    await visibleTask(req, req.params.id);
    const detail = await tasks.detail(req.params.id);
    if (!detail) throw new HttpError(404, t(req.lang, 'api.taskNotFound'));
    const [task] = await withOwners(req, [detail.task]);
    res.json({ ...detail, task });
  });

  r.post('/tasks/:id/cancel', async (req, res) => {
    // another user's task answers exactly like an unknown id (409, the long-standing answer for both), so cancelling
    // reveals nothing about other users' tasks
    const task = await tasks.get(req.params.id);
    if (!task || !mayAccess(req, task.ownerId)) throw new HttpError(409, t(req.lang, 'api.taskNotActive'));
    const ok = await tasks.cancel(req.params.id);
    if (!ok) throw new HttpError(409, t(req.lang, 'api.taskNotActive'));
    record(req, { action: 'task.cancel', target: { type: 'task', id: task.id, label: task.title }, details: { status: task.status } });
    res.json({ ok: true });
  });

  r.get('/tasks/:id/artifacts.zip', async (req, res) => {
    const task = await visibleTask(req, req.params.id);
    const list = await artifacts.list(task.id);
    if (list.length === 0) throw new HttpError(404, t(req.lang, 'api.taskNoArtifacts'));
    const files: Record<string, Uint8Array> = {};
    for (const a of list) files[a.name] = new Uint8Array(await artifacts.read(a));
    files['README.txt'] = strToU8(
      t(req.lang, 'api.zipReadme', {
        app: APP_NAME,
        title: task.title,
        task: task.id,
        created: task.createdAt,
        files: list.map((a) => `- ${a.name}: ${a.title}`).join('\n'),
      }),
    );
    const zip = zipSync(files, { level: 6 });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', contentDisposition('attachment', `solar-${task.id}.zip`));
    res.end(Buffer.from(zip));
  });

  // ---- confirmations --------------------------------------------------------
  r.get('/confirmations', async (req, res) => {
    const visible = [];
    for (const c of tasks.pendingConfirmations()) {
      const task = await tasks.get(c.taskId);
      if (task && mayAccess(req, task.ownerId)) visible.push(c);
    }
    res.json(visible);
  });

  r.post('/confirmations/:id', async (req, res) => {
    const body = parse(z.object({ approved: z.boolean(), note: z.string().max(1000).optional() }), req.body, req.lang);
    // only the task's owner, or a role that acts on every task, answers an approval
    const pending = await tasks.pendingConfirmation(req.params.id);
    if (!pending || !pending.task || !mayAccess(req, pending.task.ownerId)) throw new HttpError(404, t(req.lang, 'api.confirmationNotFound'));
    const c = tasks.resolveConfirmation(req.params.id, body.approved, body.note?.trim() || null);
    if (!c) throw new HttpError(404, t(req.lang, 'api.confirmationNotFound'));
    record(req, {
      action: body.approved ? 'confirmation.approve' : 'confirmation.reject',
      target: { type: 'confirmation', id: c.id, label: c.displayName },
      details: { tool: c.tool, taskId: c.taskId, taskTitle: pending.task.title, ...(c.pluginId ? { pluginId: c.pluginId } : {}) },
    });
    res.json({ ok: true });
  });

  // ---- artifacts ------------------------------------------------------------
  r.get('/artifacts/:id', async (req, res) => {
    res.json(await visibleArtifact(req, req.params.id));
  });

  r.get('/artifacts/:id/content', async (req, res) => {
    const a = await visibleArtifact(req, req.params.id);
    const body = await artifacts.read(a);
    res.setHeader('Content-Type', a.mimeType);
    res.setHeader('Content-Disposition', contentDisposition(req.query.download ? 'attachment' : 'inline', a.name));
    // generated documents are previewed in the browser: never let them run scripts in the app origin
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src data: 'self'; style-src 'unsafe-inline'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(body);
  });

  /**
   * Word (.docx) file of a Technical Specification Document made before the tool wrote one. `:id` is any artifact of the
   * TSD's bundle. 201 {artifact, created: true, warnings} with the new artifact (saved in the same task and bundle and
   * announced to open UIs like the agent's own artifacts); 200 {artifact, created: false, warnings: []} when the bundle
   * already has a Word file; 404 unknown artifact; 400 not part of a TSD bundle, or its model is not a valid specification;
   * 500 when rendering failed or timed out (it runs in a worker thread, see tasks/techSpecDocxIsolated.ts).
   */
  r.post('/artifacts/:id/docx', requirePermission('agent.use'), async (req, res) => {
    const source = await visibleArtifact(req, req.params.id);
    try {
      // errors and warnings in the language of the request, the new artifact's description in the task's
      const result = await exportTechSpecDocx(
        artifacts,
        (taskId, input) => tasks.addArtifact(taskId, input),
        req.params.id,
        req.lang,
        async (taskId) => taskLang({ task: await tasks.get(taskId) }),
      );
      if (result.created) {
        record(req, {
          action: 'artifact.docx_export',
          target: { type: 'artifact', id: result.artifact.id, label: result.artifact.name },
          details: { sourceArtifactId: source.id, sourceName: source.name, taskId: source.taskId },
        });
      }
      res.status(result.created ? 201 : 200).json(result);
    } catch (err) {
      if (err instanceof TechSpecDocxError) throw new HttpError(err.status, err.in(req.lang));
      throw err;
    }
  });

  // ---- attachments (project documents) ----------------------------------------
  const rawUpload = express.raw({ type: () => true, limit: config.attachments.maxFileBytes });
  const uploadBody = (req: Request, res: Response, next: NextFunction) =>
    rawUpload(req, res, (err?: unknown) => {
      if ((err as { type?: string } | undefined)?.type === 'entity.too.large') {
        return next(new HttpError(413, t(langOf(req), 'api.fileTooLarge', { mb: Math.round(config.attachments.maxFileBytes / 1024 / 1024) })));
      }
      next(err);
    });

  r.post('/attachments', requirePermission('agent.use'), uploadBody, async (req, res) => {
    const q = parse(z.object({ sessionId: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(300) }), req.query, req.lang);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, t(req.lang, 'api.fileEmpty'));
    if (/\\.(png|jpe?g|webp)$/i.test(q.name) && !can(principalOf(req).role, 'image.use')) {
      throw new HttpError(403, 'Only Superadmin can attach images for editing');
    }
    // the client may give up while the document is being read (chip removed, page left): then do not keep it
    let clientGone = false;
    res.on('close', () => {
      if (!res.writableFinished) clientGone = true;
    });
    let created;
    try {
      // errors and warnings in the language of the upload (the warnings are stored with the attachment)
      created = await attachments.create(q.sessionId, q.name, req.body, req.lang, principalOf(req).id);
    } catch (err) {
      if (err instanceof DocumentError) throw new HttpError(err.status, err.message);
      throw err;
    }
    if (clientGone) {
      await attachments.remove(created.id);
      return;
    }
    res.status(201).json(created);
  });

  r.get('/attachments', async (req, res) => {
    const q = parse(z.object({ sessionId: z.string().trim().min(1).max(100), unsent: z.enum(['0', '1']).optional() }), req.query, req.lang);
    // a conversation's documents are the requester's own uploads
    const owner = principalOf(req).id;
    res.json(q.unsent === '1' ? await attachments.listUnsent(q.sessionId, owner) : await attachments.listForSession(q.sessionId, owner));
  });

  r.get('/attachments/:id', async (req, res) => {
    res.json(await visibleAttachment(req, req.params.id));
  });

  /** The Markdown the agent reads (for the preview in the UI). */
  r.get('/attachments/:id/text', async (req, res) => {
    const a = await visibleAttachment(req, req.params.id);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(await attachments.readText(a));
  });

  /** The original file, always as a download (never rendered in the app origin). */
  r.get('/attachments/:id/content', async (req, res) => {
    const a = await visibleAttachment(req, req.params.id);
    res.setHeader('Content-Type', a.mimeType);
    res.setHeader('Content-Disposition', contentDisposition('attachment', a.name));
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(await attachments.readOriginal(a));
  });

  r.delete('/attachments/:id', async (req, res) => {
    await visibleAttachment(req, req.params.id);
    const outcome = await attachments.remove(req.params.id);
    if (outcome === 'not-found') throw new HttpError(404, t(req.lang, 'api.attachmentNotFound'));
    if (outcome === 'in-use') throw new HttpError(409, t(req.lang, 'api.attachmentInUse'));
    res.status(204).end();
  });


  // ---- Draft → Submitted → Approved / Rejected → Published -----------------------------
  const proposeBody = z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('skill'), title: z.string().trim().min(1).max(80),
      description: z.string().trim().max(1000).optional(),
      content: z.string().trim().min(1).max(100_000),
    }),
    z.object({
      kind: z.literal('knowledge'), title: z.string().trim().min(1).max(120),
      path: z.string().trim().min(1).max(300),
      content: z.string().trim().min(1).max(100_000),
    }),
  ]);

  r.get('/content-proposals', (req, res) => {
    const p = principalOf(req);
    res.json(contentProposals.list(p.role, p.id));
  });
  r.post('/content-proposals', requirePermission('content.propose'), async (req, res) => {
    const input = parse(proposeBody, req.body, req.lang);
    const proposal = await contentProposals.create(input, principalOf(req).id);
    res.status(201).json(proposal);
  });
  r.put('/content-proposals/:id', requirePermission('content.propose'), async (req, res) => {
    const input = parse(proposeBody, req.body, req.lang);
    try {
      res.json(await contentProposals.update(req.params.id, principalOf(req).id, input));
    } catch (err) { throw new HttpError(409, err instanceof Error ? err.message : String(err)); }
  });
  r.post('/content-proposals/:id/submit', requirePermission('content.propose'), async (req, res) => {
    try {
      res.json(await contentProposals.submit(req.params.id, principalOf(req).id));
    } catch (err) { throw new HttpError(409, err instanceof Error ? err.message : String(err)); }
  });
  r.post('/content-proposals/:id/review', requirePermission('content.review'), async (req, res) => {
    const p = principalOf(req);
    if (p.role !== 'superadmin' && p.role !== 'head_of_it') throw new HttpError(403, 'Reviewer role required');
    const input = parse(z.object({ approved: z.boolean(), reason: z.string().trim().max(2000).default('') }), req.body, req.lang);
    try {
      res.json(await contentProposals.review(req.params.id, p.role, p.id, input.approved, input.reason));
    } catch (err) { throw new HttpError(409, err instanceof Error ? err.message : String(err)); }
  });
  r.post('/content-proposals/:id/publish', requirePermission('content.review'), async (req, res) => {
    const p = principalOf(req);
    if (p.role !== 'superadmin' && p.role !== 'head_of_it') throw new HttpError(403, 'Reviewer role required');
    try {
      res.json(await contentProposals.publish(req.params.id, p.role, p.id, async (entry: ContentProposal) => {
        // Deterministic ownership marker permits safe retry after the destination was
        // created but the staging store could not persist Published (power loss/disk error).
        // A pre-existing admin file without this marker is never adopted or overwritten.
        const body = `${entry.content.trimEnd()}\n\n<!-- solar-content-proposal:${entry.id} -->\n`;
        if (entry.kind === 'skill') {
          const id = slugify(entry.title, 'skill');
          const existing = await skills.get(id);
          if (existing) {
            if (existing.source === 'user' && existing.name === entry.title
              && existing.description === (entry.description ?? '')
              && existing.content.trim() === body.trim()) return id;
            throw new Error('A Skill with that identifier already exists');
          }
          const created = await skills.create({
            name: entry.title, description: entry.description ?? '', content: body, enabled: false,
          });
          return created.id;
        }
        if (!entry.path) throw new Error('Knowledge path is required');
        const existing = await knowledge.locate(entry.path);
        if (existing) {
          const stored = await knowledge.read(existing.path);
          if (existing.source === 'user' && stored?.content === body) return existing.path;
          throw new Error('Knowledge path already exists');
        }
        return (await knowledge.write(entry.path, body)).path;
      }));
    } catch (err) { throw new HttpError(409, err instanceof Error ? err.message : String(err)); }
  });

  // ---- skills ---------------------------------------------------------------
  const skillBody = z.object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(1000).default(''),
    content: z.string().min(1).max(200_000),
    enabled: z.boolean().optional(),
  });

  const readSkills = requirePermission('skills.read');
  const manageSkills = requirePermission('skills.manage');

  r.get('/skills', readSkills, async (_req, res) => {
    res.json(await skills.listDetailed());
  });

  r.get('/skills/:id', readSkills, async (req, res) => {
    const s = await skills.get(req.params.id);
    if (!s) throw new HttpError(404, t(req.lang, 'api.skillNotFound'));
    res.json(s);
  });

  r.post('/skills', manageSkills, async (req, res) => {
    let created;
    try {
      created = await skills.create(parse(skillBody, req.body, req.lang));
    } catch (err) {
      throw httpError(409, err, req.lang);
    }
    record(req, { action: 'skill.create', target: { type: 'skill', id: created.id, label: created.name }, details: { enabled: created.enabled } });
    res.status(201).json(created);
  });

  r.post('/skills/import', manageSkills, async (req, res) => {
    const body = parse(z.object({ markdown: z.string().min(1).max(200_000) }), req.body, req.lang);
    let imported;
    try {
      imported = await skills.importMarkdown(body.markdown);
    } catch (err) {
      throw httpError(409, err, req.lang);
    }
    record(req, { action: 'skill.create', target: { type: 'skill', id: imported.id, label: imported.name }, details: { via: 'import', enabled: imported.enabled } });
    res.status(201).json(imported);
  });

  r.put('/skills/:id', manageSkills, async (req, res) => {
    if (req.params.id === 'image-creation' && principalOf(req).role !== 'superadmin') throw new HttpError(403, 'Superadmin only');
    const body = onlySent(parse(skillBody.partial(), req.body, req.lang), req.body);
    const before = await skills.get(req.params.id);
    let updated;
    try {
      updated = await skills.update(req.params.id, body);
    } catch (err) {
      throw httpError(404, err, req.lang);
    }
    const target = { type: 'skill' as const, id: updated.id, label: updated.name };
    // a change of the text and switching on/off are separate entries (the UI's toggle sends only `enabled`)
    const fields = (['name', 'description', 'content'] as const).filter((k) => body[k] !== undefined);
    if (fields.length) record(req, { action: 'skill.update', target, details: { fields, source: updated.source } });
    if (body.enabled !== undefined && before?.enabled !== updated.enabled) record(req, { action: updated.enabled ? 'skill.enable' : 'skill.disable', target });
    res.json(updated);
  });

  r.delete('/skills/:id', manageSkills, async (req, res) => {
    if (req.params.id === 'image-creation') throw new HttpError(403, 'Built-in image skill cannot be removed');
    const before = await skills.get(req.params.id);
    let result;
    try {
      result = await skills.remove(req.params.id);
    } catch (err) {
      throw httpError(404, err, req.lang);
    }
    record(req, { action: 'skill.delete', target: { type: 'skill', id: req.params.id, label: before?.name ?? req.params.id }, details: { result } });
    res.json({ result });
  });

  // ---- MCP plugins ----------------------------------------------------------
  /** A plugin with its status; the errors SOLAR writes in the status are in `lang`. */
  const view = (id: string, lang: Lang): PluginView => {
    const p = plugins.get(id);
    if (!p) throw new HttpError(404, t(lang, 'api.pluginNotFound'));
    return { ...maskPlugin(p), status: mcp.status(id, lang) };
  };

  // MCP plugins can run commands and hold credentials: system settings, superadmin only (reading included); every
  // logged-in user still sees the plugins' connection status in the event stream
  const settings = requirePermission('settings.manage');
  /** settings.manage for a change; a refused attempt is recorded as `action` on the plugin/provider the URL names. */
  const changeSetting = (action: ActivityAction, type: 'plugin' | 'llm_provider' | 'llm_route') =>
    requirePermission('settings.manage', refused(action, (req) => ({ type, id: type === 'llm_route' ? 'routes' : paramId(req), label: null })));

  r.get('/plugins', settings, (req, res) => {
    res.json(plugins.list().map((p) => view(p.id, req.lang)));
  });

  r.post('/plugins', changeSetting('settings.plugin.create', 'plugin'), async (req, res) => {
    let created;
    try {
      created = await plugins.create(req.body);
    } catch (err) {
      throw httpError(400, err, req.lang);
    }
    void mcp.connect(created.id).catch(() => undefined);
    // field names only: a plugin's env and headers hold credentials
    record(req, {
      action: 'settings.plugin.create',
      target: { type: 'plugin', id: created.id, label: created.name },
      details: { preset: created.preset, transport: created.transport, enabled: created.enabled, confirm: created.confirm },
    });
    res.status(201).json(view(created.id, req.lang));
  });

  r.put('/plugins/:id', changeSetting('settings.plugin.update', 'plugin'), async (req, res) => {
    const patch = onlySent(parse(PluginConfigBaseSchema.omit({ id: true }).partial(), req.body, req.lang), req.body);
    let updated;
    try {
      updated = await plugins.update(req.params.id, patch);
    } catch (err) {
      throw httpError(400, err, req.lang);
    }
    void mcp.connect(req.params.id).catch(() => undefined);
    record(req, {
      action: 'settings.plugin.update',
      target: { type: 'plugin', id: updated.id, label: updated.name },
      details: { fields: Object.keys(patch), enabled: updated.enabled },
    });
    res.json(view(req.params.id, req.lang));
  });

  r.post('/plugins/:id/reconnect', changeSetting('settings.plugin.reconnect', 'plugin'), async (req, res) => {
    const plugin = plugins.get(req.params.id);
    if (!plugin) throw new HttpError(404, t(req.lang, 'api.pluginNotFound'));
    try {
      await mcp.connect(req.params.id);
    } catch {
      // the error is reported in the plugin status
    }
    const state = mcp.status(req.params.id, req.lang).state;
    record(req, {
      action: 'settings.plugin.reconnect',
      outcome: state === 'error' ? 'failure' : 'success',
      target: { type: 'plugin', id: plugin.id, label: plugin.name },
      details: { state },
    });
    res.json(view(req.params.id, req.lang));
  });

  r.delete('/plugins/:id', changeSetting('settings.plugin.delete', 'plugin'), async (req, res) => {
    const plugin = plugins.get(req.params.id);
    if (!plugin) throw new HttpError(404, t(req.lang, 'api.pluginNotFound'));
    await mcp.disconnect(req.params.id);
    await plugins.remove(req.params.id);
    record(req, { action: 'settings.plugin.delete', target: { type: 'plugin', id: plugin.id, label: plugin.name } });
    res.json({ ok: true });
  });

  // ---- LLM providers & model routes ------------------------------------------
  r.get('/llm', settings, (_req, res) => {
    res.json(llm.view());
  });

  r.post('/llm/providers', changeSetting('settings.llm.provider_create', 'llm_provider'), async (req, res) => {
    let created;
    try {
      created = await llm.create(req.body);
    } catch (err) {
      throw httpError(400, err, req.lang);
    }
    // never the API key or headers (values may be secrets): the provider's kind and models only
    record(req, {
      action: 'settings.llm.provider_create',
      target: { type: 'llm_provider', id: created.id, label: created.name },
      details: { kind: created.kind, enabled: created.enabled, models: created.models.map((m) => m.id) },
    });
    res.status(201).json(llm.view());
  });

  r.put('/llm/providers/:id', changeSetting('settings.llm.provider_update', 'llm_provider'), async (req, res) => {
    const patch = onlySent(parse(LlmProviderBaseSchema.omit({ id: true }).partial(), req.body, req.lang), req.body);
    let updated;
    try {
      updated = await llm.update(req.params.id, patch);
    } catch (err) {
      throw httpError(400, err, req.lang);
    }
    record(req, {
      action: 'settings.llm.provider_update',
      target: { type: 'llm_provider', id: updated.id, label: updated.name },
      details: { fields: Object.keys(patch), enabled: updated.enabled },
    });
    res.json(llm.view());
  });

  r.delete('/llm/providers/:id', changeSetting('settings.llm.provider_delete', 'llm_provider'), async (req, res) => {
    const provider = llm.get(req.params.id)?.config;
    try {
      await llm.remove(req.params.id);
    } catch (err) {
      throw httpError(404, err, req.lang);
    }
    record(req, { action: 'settings.llm.provider_delete', target: { type: 'llm_provider', id: req.params.id, label: provider?.name ?? req.params.id } });
    res.json(llm.view());
  });

  r.post('/llm/providers/:id/test', changeSetting('settings.llm.provider_test', 'llm_provider'), async (req, res) => {
    // Settings -> AI models "Test connection": the result in the language of the request
    const result = await models.test(req.params.id, req.lang);
    record(req, {
      action: 'settings.llm.provider_test',
      outcome: result.ok ? 'success' : 'failure',
      target: { type: 'llm_provider', id: req.params.id, label: llm.get(req.params.id)?.config.name ?? req.params.id },
      details: result.ok ? { models: result.models?.length ?? 0 } : { reason: 'error' },
    });
    res.json(result);
  });

  r.put('/llm/routes', changeSetting('settings.llm.route_change', 'llm_route'), async (req, res) => {
    const body = parse(z.object({ routes: RoutesSchema }), req.body, req.lang);
    const before = llm.view().routes;
    let routes;
    try {
      routes = await llm.setRoutes(body.routes);
    } catch (err) {
      throw httpError(400, err, req.lang);
    }
    // route names are chosen by the admin: stored as values (a key like "token-saver" would be taken for a secret)
    const asList = (r: Record<string, string[]>) => Object.entries(r).map(([name, models]) => ({ name, models }));
    record(req, {
      action: 'settings.llm.route_change',
      target: { type: 'llm_route', id: 'routes', label: Object.keys(routes).join(', ') },
      details: { from: asList(before), to: asList(routes) },
    });
    res.json(llm.view());
  });

  // ---- knowledge base ---------------------------------------------------------
  const knowledgePath = z.string().trim().min(1).max(400);
  const knowledgeError = (err: unknown, lang: Lang, status = 400) => httpError(status, err, lang);

  const readKnowledge = requirePermission('knowledge.read');
  const writeKnowledge = requirePermission('knowledge.write');

  r.get('/knowledge', readKnowledge, async (_req, res) => {
    res.json(await knowledge.listAll());
  });

  r.get('/knowledge/search', readKnowledge, async (req, res) => {
    const q = parse(
      z.object({ q: z.string().trim().min(1).max(300), type: z.enum(KNOWLEDGE_TYPES as [string, ...string[]]).optional() }),
      req.query,
      req.lang,
    );
    res.json(await knowledge.search(q.q, { type: q.type as KnowledgeType | undefined, limit: 20 }));
  });

  r.get('/knowledge/file', readKnowledge, async (req, res) => {
    const q = parse(z.object({ path: knowledgePath }), req.query, req.lang);
    let file;
    try {
      file = await knowledge.read(q.path);
    } catch (err) {
      throw knowledgeError(err, req.lang);
    }
    if (!file) throw new HttpError(404, t(req.lang, 'api.knowledgeNotFound'));
    res.json(file);
  });

  r.put('/knowledge/file', writeKnowledge, async (req, res) => {
    const body = parse(z.object({ path: knowledgePath, content: z.string().max(MAX_KNOWLEDGE_FILE_BYTES) }), req.body, req.lang);
    let entry;
    try {
      entry = await knowledge.write(body.path, body.content);
    } catch (err) {
      throw knowledgeError(err, req.lang);
    }
    record(req, { action: 'knowledge.write', target: { type: 'knowledge', id: entry.path, label: entry.path }, details: { title: entry.title, type: entry.type, size: entry.size } });
    res.json(entry);
  });

  r.delete('/knowledge/file', writeKnowledge, async (req, res) => {
    const q = parse(z.object({ path: knowledgePath }), req.query, req.lang);
    let result;
    try {
      result = await knowledge.remove(q.path);
    } catch (err) {
      throw knowledgeError(err, req.lang, 404);
    }
    // deleting the user's copy of a built-in file brings the built-in one back
    record(req, { action: result === 'reverted' ? 'knowledge.revert' : 'knowledge.delete', target: { type: 'knowledge', id: q.path, label: q.path } });
    res.json({ result });
  });

  /** Bulk import (e.g. a whole folder of .md files picked in the browser). */
  r.post('/knowledge/import', writeKnowledge, express.json({ limit: '50mb' }), async (req, res) => {
    const body = parse(
      z.object({ files: z.array(z.object({ path: knowledgePath, content: z.string().max(MAX_KNOWLEDGE_FILE_BYTES) })).min(1).max(500) }),
      req.body,
      req.lang,
    );
    const imported = [];
    const failed: Array<{ path: string; error: string }> = [];
    for (const f of body.files) {
      try {
        const entry = await knowledge.write(f.path, f.content);
        imported.push(entry);
        record(req, { action: 'knowledge.write', target: { type: 'knowledge', id: entry.path, label: entry.path }, details: { title: entry.title, type: entry.type, via: 'import' } });
      } catch (err) {
        failed.push({ path: f.path, error: errorMessage(err, req.lang) });
      }
    }
    res.status(imported.length ? 201 : 400).json({ imported, failed });
  });

  /** A Markdown artifact (e.g. the .md of a TSD) saved as a knowledge file; 409 when the path is taken (send overwrite). */
  r.post('/knowledge/import-artifact', writeKnowledge, async (req, res) => {
    const body = parse(
      z.object({
        artifactId: z.string().regex(/^art_[A-Za-z0-9]+$/),
        path: knowledgePath.optional(),
        type: z.enum(KNOWLEDGE_TYPES as [string, ...string[]]),
        id: z.string().trim().max(100).optional(),
        title: z.string().trim().max(200).optional(),
        description: z.string().trim().max(500).optional(),
        aliases: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
        tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
        status: z.string().trim().max(40).optional(),
        overwrite: z.boolean().default(false),
      }),
      req.body,
      req.lang,
    );
    // only an artifact of a task the requester may see (the same 404 as an unknown one)
    const source = await visibleArtifact(req, body.artifactId);
    try {
      const { entry, replaced } = await importArtifactToKnowledge(knowledge, artifacts, {
        artifactId: body.artifactId,
        path: body.path,
        overwrite: body.overwrite,
        meta: { ...body, type: body.type as KnowledgeType },
      });
      record(req, {
        action: 'knowledge.import_artifact',
        target: { type: 'knowledge', id: entry.path, label: entry.path },
        details: { artifactId: source.id, artifactName: source.name, title: entry.title, replaced },
      });
      res.status(201).json({ entry, replaced });
    } catch (err) {
      if (err instanceof KnowledgeConflictError) {
        const { path, title, source } = err.existing;
        throw new HttpError(409, t(req.lang, source === 'builtin' ? 'api.knowledgeExists.builtin' : 'api.knowledgeExists.user', { path, title }));
      }
      if (err instanceof KnowledgeInputError) throw new HttpError(err.status, err.in(req.lang));
      throw knowledgeError(err, req.lang);
    }
  });

  /** Spreadsheet (xlsx/csv) catalogs of systems, APIs or integrations: one Markdown file per row. */
  const readTables = async (req: Request) => {
    const lang = req.lang;
    const q = parse(
      z.object({ name: z.string().trim().min(1).max(300).regex(/\.(xlsx|xlsm|csv)$/i, t(lang, 'api.spreadsheetOnly')) }),
      req.query,
      lang,
    );
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, t(lang, 'api.fileEmpty'));
    try {
      const doc = await extractIsolated(req.body, q.name, { tableRows: MAX_IMPORT_ROWS + 10, maxChars: 40_000_000, lang });
      return { name: q.name, tables: doc.tables ?? [] };
    } catch (err) {
      if (err instanceof DocumentError) throw new HttpError(err.status, err.message);
      throw err;
    }
  };

  r.post('/knowledge/tables', writeKnowledge, uploadBody, async (req, res) => {
    const { tables } = await readTables(req);
    res.json(previewTables(tables));
  });

  r.post('/knowledge/import-table', writeKnowledge, uploadBody, async (req, res) => {
    let raw: unknown;
    try {
      raw = JSON.parse(String(req.query.options ?? ''));
    } catch {
      throw new HttpError(400, t(req.lang, 'api.optionsJson'));
    }
    const opts = parse(
      z.object({
        sheet: z.string().min(1).max(200),
        headerRow: z.number().int().min(1).max(100).default(1),
        idColumn: z.string().trim().min(1).max(200),
        titleColumn: z.string().trim().max(200).optional(),
        aliasColumns: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
        statusColumn: z.string().trim().max(200).optional(),
        folder: z.string().trim().min(1).max(200),
        type: z.enum(KNOWLEDGE_TYPES as [string, ...string[]]).optional(),
        removeStale: z.boolean().default(true),
      }),
      raw,
      req.lang,
    );
    const { name, tables } = await readTables(req);
    const table = tables.find((x) => x.name === opts.sheet);
    if (!table) throw new HttpError(400, t(req.lang, 'api.sheetMissing', { sheet: opts.sheet }));
    let result;
    try {
      result = await importTable(knowledge, table, name, {
        ...opts,
        titleColumn: opts.titleColumn || undefined,
        statusColumn: opts.statusColumn || undefined,
        type: opts.type as KnowledgeType | undefined,
        // the notices, errors and the generated index in the language of the request
        lang: req.lang,
      });
    } catch (err) {
      throw knowledgeError(err, req.lang);
    }
    record(req, {
      action: 'knowledge.table_import',
      target: { type: 'knowledge', id: opts.folder, label: opts.folder },
      details: { file: name, sheet: opts.sheet, written: result.written.length, removed: result.removed.length, skipped: result.skipped.length },
    });
    res.status(201).json(result);
  });

  /** Word, PDF, PowerPoint, Markdown or text kept as knowledge (whole, or one file per chapter). */
  r.post('/knowledge/import-document', writeKnowledge, uploadBody, async (req, res) => {
    let raw: unknown;
    try {
      raw = JSON.parse(String(req.query.options ?? '{}'));
    } catch {
      throw new HttpError(400, t(req.lang, 'api.optionsJson'));
    }
    const q = parse(z.object({ name: z.string().trim().min(1).max(300) }), req.query, req.lang);
    const opts = parse(
      z.object({
        folder: z.string().trim().min(1).max(200),
        split: z.union([z.literal('none'), z.literal(1), z.literal(2)]).default('none'),
        type: z.enum(KNOWLEDGE_TYPES as [string, ...string[]]).optional(),
        title: z.string().trim().max(150).optional(),
        removeStale: z.boolean().default(true),
      }),
      raw,
      req.lang,
    );
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, t(req.lang, 'api.fileEmpty'));
    let doc;
    try {
      doc = await extractIsolated(req.body, q.name, { lang: req.lang });
    } catch (err) {
      if (err instanceof DocumentError) throw new HttpError(err.status, err.message);
      throw err;
    }
    let result;
    try {
      result = await importDocument(knowledge, doc.markdown, q.name, { ...opts, type: opts.type as KnowledgeType | undefined, lang: req.lang });
    } catch (err) {
      throw knowledgeError(err, req.lang);
    }
    record(req, {
      action: 'knowledge.document_import',
      target: { type: 'knowledge', id: opts.folder, label: opts.folder },
      details: { file: q.name, split: opts.split, written: result.written.length, removed: result.removed.length },
    });
    res.status(201).json({ ...result, warnings: [...doc.warnings, ...result.warnings] });
  });

  return r;
}
