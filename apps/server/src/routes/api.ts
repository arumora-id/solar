import { timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { zipSync, strToU8 } from 'fflate';
import { z } from 'zod';
import { ATTACHMENT_EXTENSIONS, type KnowledgeType, type PluginView, type PublicConfig, type TaskStatus } from '@solar/shared';
import { APP_NAME, APP_VERSION, type AppConfig } from '../config.js';
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
import type { EventBus } from '../tasks/eventBus.js';
import type { TaskManager } from '../tasks/taskManager.js';

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
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const ATTACHMENT_ID = /^att_[A-Za-z0-9]+$/;

const TASK_STATUSES = ['queued', 'running', 'awaiting_confirmation', 'completed', 'failed', 'cancelled'] as const;

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function hostnameOf(hostHeader: string): string {
  // "127.0.0.1:8790" -> "127.0.0.1", "[::1]:8790" -> "[::1]"
  const h = hostHeader.trim().toLowerCase();
  return h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0]!;
}

/**
 * Without an access token the API trusts the local machine only. A DNS-rebinding page (evil.example -> 127.0.0.1)
 * would otherwise be "same origin" with the API and could e.g. register a stdio MCP plugin (= run a command).
 * So the Host header must name this machine and a browser Origin, when present, must be local too.
 */
export function localOnlyMiddleware(token: string | undefined, configuredHost: string) {
  const allowed = new Set(LOOPBACK_HOSTS);
  if (!['0.0.0.0', '::'].includes(configuredHost)) allowed.add(configuredHost.toLowerCase());
  return (req: Request, _res: Response, next: NextFunction) => {
    if (token) return next();
    const host = req.headers.host ? hostnameOf(req.headers.host) : '';
    if (!allowed.has(host)) {
      return next(new HttpError(403, `Forbidden host "${host}". Without SOLAR_ACCESS_TOKEN the API only answers requests for this computer (127.0.0.1 / localhost).`));
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
        return next(new HttpError(403, `Forbidden origin "${origin}".`));
      }
    }
    next();
  };
}

export function authMiddleware(token: string | undefined) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!token) return next();
    const header = req.headers.authorization;
    const provided = header?.startsWith('Bearer ') ? header.slice(7) : typeof req.query.token === 'string' ? req.query.token : '';
    if (provided && safeEqual(provided, token)) return next();
    next(new HttpError(401, 'Unauthorized: missing or invalid SOLAR access token'));
  };
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
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

export function createApiRouter(deps: ApiDeps): Router {
  const { config, tasks, artifacts, attachments, skills, plugins, mcp, bus, knowledge, llm, models } = deps;
  const r = express.Router();
  const jsonBody = express.json({ limit: '4mb' });
  // the knowledge import parses its own (larger) body
  r.use((req, res, next) => (req.path === '/knowledge/import' ? next() : jsonBody(req, res, next)));

  r.get('/health', (_req, res) => {
    res.json({ ok: true, name: APP_NAME, version: APP_VERSION });
  });

  r.use(localOnlyMiddleware(config.accessToken, config.host));
  r.use(authMiddleware(config.accessToken));

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
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    send({ kind: 'hello', serverTime: new Date().toISOString() });
    send({ kind: 'plugins', plugins: mcp.statuses() });
    const unsubscribe = bus.subscribe(send);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  // ---- tasks ----------------------------------------------------------------
  r.post('/tasks', async (req, res) => {
    const body = parse(
      z.object({
        prompt: z.string().trim().min(1).max(50_000),
        sessionId: z.string().trim().min(1).max(100),
        attachmentIds: z.array(z.string().regex(ATTACHMENT_ID)).max(config.attachments.maxPerTask).default([]),
      }),
      req.body,
    );
    const ids = [...new Set(body.attachmentIds)];
    // validated and created under the conversation lock: a concurrent DELETE cannot remove a document in between
    const task = await attachments.withSession(body.sessionId, async () => {
      const found = await attachments.listByIds(ids);
      for (const id of ids) {
        const a = found.find((x) => x.id === id);
        if (!a) throw new HttpError(400, `Lampiran ${id} tidak ditemukan`);
        if (a.sessionId !== body.sessionId) throw new HttpError(400, `Lampiran "${a.name}" milik percakapan lain`);
      }
      return tasks.create(body.prompt, body.sessionId, ids);
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
      }),
      req.query,
    );
    res.json(await deps.repo.listTasks({ limit: q.limit, offset: q.offset, sessionId: q.sessionId, status: q.status as TaskStatus | undefined }));
  });

  r.get('/tasks/stats', async (_req, res) => {
    res.json(await deps.repo.stats());
  });

  r.get('/tasks/:id', async (req, res) => {
    const detail = await tasks.detail(req.params.id);
    if (!detail) throw new HttpError(404, 'Task not found');
    res.json(detail);
  });

  r.post('/tasks/:id/cancel', async (req, res) => {
    const ok = await tasks.cancel(req.params.id);
    if (!ok) throw new HttpError(409, 'Task is not queued or running');
    res.json({ ok: true });
  });

  r.get('/tasks/:id/artifacts.zip', async (req, res) => {
    const task = await tasks.get(req.params.id);
    if (!task) throw new HttpError(404, 'Task not found');
    const list = await artifacts.list(task.id);
    if (list.length === 0) throw new HttpError(404, 'This task has no artifacts');
    const files: Record<string, Uint8Array> = {};
    for (const a of list) files[a.name] = new Uint8Array(await artifacts.read(a));
    files['README.txt'] = strToU8(
      `${APP_NAME} deliverables\nTask: ${task.title}\nTask id: ${task.id}\nCreated: ${task.createdAt}\n\n${list.map((a) => `- ${a.name}: ${a.title}`).join('\n')}\n`,
    );
    const zip = zipSync(files, { level: 6 });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', contentDisposition('attachment', `solar-${task.id}.zip`));
    res.end(Buffer.from(zip));
  });

  // ---- confirmations --------------------------------------------------------
  r.get('/confirmations', (_req, res) => {
    res.json(tasks.pendingConfirmations());
  });

  r.post('/confirmations/:id', (req, res) => {
    const body = parse(z.object({ approved: z.boolean(), note: z.string().max(1000).optional() }), req.body);
    const c = tasks.resolveConfirmation(req.params.id, body.approved, body.note?.trim() || null);
    if (!c) throw new HttpError(404, 'Confirmation not found or already resolved');
    res.json({ ok: true });
  });

  // ---- artifacts ------------------------------------------------------------
  r.get('/artifacts/:id', async (req, res) => {
    const a = await artifacts.get(req.params.id);
    if (!a) throw new HttpError(404, 'Artifact not found');
    res.json(a);
  });

  r.get('/artifacts/:id/content', async (req, res) => {
    const a = await artifacts.get(req.params.id);
    if (!a) throw new HttpError(404, 'Artifact not found');
    const body = await artifacts.read(a);
    res.setHeader('Content-Type', a.mimeType);
    res.setHeader('Content-Disposition', contentDisposition(req.query.download ? 'attachment' : 'inline', a.name));
    // generated documents are previewed in the browser: never let them run scripts in the app origin
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src data: 'self'; style-src 'unsafe-inline'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(body);
  });

  // ---- attachments (project documents) ----------------------------------------
  const rawUpload = express.raw({ type: () => true, limit: config.attachments.maxFileBytes });
  const uploadBody = (req: Request, res: Response, next: NextFunction) =>
    rawUpload(req, res, (err?: unknown) => {
      if ((err as { type?: string } | undefined)?.type === 'entity.too.large') {
        return next(new HttpError(413, `File terlalu besar (maks ${Math.round(config.attachments.maxFileBytes / 1024 / 1024)} MB).`));
      }
      next(err);
    });

  r.post('/attachments', uploadBody, async (req, res) => {
    const q = parse(z.object({ sessionId: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(300) }), req.query);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, 'Isi file kosong');
    // the client may give up while the document is being read (chip removed, page left): then do not keep it
    let clientGone = false;
    res.on('close', () => {
      if (!res.writableFinished) clientGone = true;
    });
    let created;
    try {
      created = await attachments.create(q.sessionId, q.name, req.body);
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
    const q = parse(z.object({ sessionId: z.string().trim().min(1).max(100), unsent: z.enum(['0', '1']).optional() }), req.query);
    res.json(q.unsent === '1' ? await attachments.listUnsent(q.sessionId) : await attachments.listForSession(q.sessionId));
  });

  r.get('/attachments/:id', async (req, res) => {
    const a = await attachments.get(req.params.id);
    if (!a) throw new HttpError(404, 'Lampiran tidak ditemukan');
    res.json(a);
  });

  /** The Markdown the agent reads (for the preview in the UI). */
  r.get('/attachments/:id/text', async (req, res) => {
    const a = await attachments.get(req.params.id);
    if (!a) throw new HttpError(404, 'Lampiran tidak ditemukan');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(await attachments.readText(a));
  });

  /** The original file, always as a download (never rendered in the app origin). */
  r.get('/attachments/:id/content', async (req, res) => {
    const a = await attachments.get(req.params.id);
    if (!a) throw new HttpError(404, 'Lampiran tidak ditemukan');
    res.setHeader('Content-Type', a.mimeType);
    res.setHeader('Content-Disposition', contentDisposition('attachment', a.name));
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(await attachments.readOriginal(a));
  });

  r.delete('/attachments/:id', async (req, res) => {
    const outcome = await attachments.remove(req.params.id);
    if (outcome === 'not-found') throw new HttpError(404, 'Lampiran tidak ditemukan');
    if (outcome === 'in-use') throw new HttpError(409, 'Lampiran sudah dipakai oleh sebuah task dan disimpan sebagai riwayatnya');
    res.status(204).end();
  });

  // ---- skills ---------------------------------------------------------------
  const skillBody = z.object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(1000).default(''),
    content: z.string().min(1).max(200_000),
    enabled: z.boolean().optional(),
  });

  r.get('/skills', async (_req, res) => {
    res.json(await skills.listDetailed());
  });

  r.get('/skills/:id', async (req, res) => {
    const s = await skills.get(req.params.id);
    if (!s) throw new HttpError(404, 'Skill not found');
    res.json(s);
  });

  r.post('/skills', async (req, res) => {
    try {
      res.status(201).json(await skills.create(parse(skillBody, req.body)));
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(409, err instanceof Error ? err.message : String(err));
    }
  });

  r.post('/skills/import', async (req, res) => {
    const body = parse(z.object({ markdown: z.string().min(1).max(200_000) }), req.body);
    try {
      res.status(201).json(await skills.importMarkdown(body.markdown));
    } catch (err) {
      throw new HttpError(409, err instanceof Error ? err.message : String(err));
    }
  });

  r.put('/skills/:id', async (req, res) => {
    const body = onlySent(parse(skillBody.partial(), req.body), req.body);
    try {
      res.json(await skills.update(req.params.id, body));
    } catch (err) {
      throw new HttpError(404, err instanceof Error ? err.message : String(err));
    }
  });

  r.delete('/skills/:id', async (req, res) => {
    try {
      res.json({ result: await skills.remove(req.params.id) });
    } catch (err) {
      throw new HttpError(404, err instanceof Error ? err.message : String(err));
    }
  });

  // ---- MCP plugins ----------------------------------------------------------
  const view = (id: string): PluginView => {
    const p = plugins.get(id);
    if (!p) throw new HttpError(404, 'Plugin not found');
    return { ...maskPlugin(p), status: mcp.status(id) };
  };

  r.get('/plugins', (_req, res) => {
    res.json(plugins.list().map((p) => view(p.id)));
  });

  r.post('/plugins', async (req, res) => {
    let created;
    try {
      created = await plugins.create(req.body);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }
    void mcp.connect(created.id).catch(() => undefined);
    res.status(201).json(view(created.id));
  });

  r.put('/plugins/:id', async (req, res) => {
    const patch = onlySent(parse(PluginConfigBaseSchema.omit({ id: true }).partial(), req.body), req.body);
    try {
      await plugins.update(req.params.id, patch);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }
    void mcp.connect(req.params.id).catch(() => undefined);
    res.json(view(req.params.id));
  });

  r.post('/plugins/:id/reconnect', async (req, res) => {
    if (!plugins.get(req.params.id)) throw new HttpError(404, 'Plugin not found');
    try {
      await mcp.connect(req.params.id);
    } catch {
      // the error is reported in the plugin status
    }
    res.json(view(req.params.id));
  });

  r.delete('/plugins/:id', async (req, res) => {
    if (!plugins.get(req.params.id)) throw new HttpError(404, 'Plugin not found');
    await mcp.disconnect(req.params.id);
    await plugins.remove(req.params.id);
    res.json({ ok: true });
  });

  // ---- LLM providers & model routes ------------------------------------------
  r.get('/llm', (_req, res) => {
    res.json(llm.view());
  });

  r.post('/llm/providers', async (req, res) => {
    try {
      await llm.create(req.body);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }
    res.status(201).json(llm.view());
  });

  r.put('/llm/providers/:id', async (req, res) => {
    const patch = onlySent(parse(LlmProviderBaseSchema.omit({ id: true }).partial(), req.body), req.body);
    try {
      await llm.update(req.params.id, patch);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }
    res.json(llm.view());
  });

  r.delete('/llm/providers/:id', async (req, res) => {
    try {
      await llm.remove(req.params.id);
    } catch (err) {
      throw new HttpError(404, err instanceof Error ? err.message : String(err));
    }
    res.json(llm.view());
  });

  r.post('/llm/providers/:id/test', async (req, res) => {
    res.json(await models.test(req.params.id));
  });

  r.put('/llm/routes', async (req, res) => {
    const body = parse(z.object({ routes: RoutesSchema }), req.body);
    try {
      await llm.setRoutes(body.routes);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }
    res.json(llm.view());
  });

  // ---- knowledge base ---------------------------------------------------------
  const knowledgePath = z.string().trim().min(1).max(400);
  const knowledgeError = (err: unknown, status = 400) => new HttpError(status, err instanceof Error ? err.message : String(err));

  r.get('/knowledge', async (_req, res) => {
    res.json(await knowledge.listAll());
  });

  r.get('/knowledge/search', async (req, res) => {
    const q = parse(
      z.object({ q: z.string().trim().min(1).max(300), type: z.enum(KNOWLEDGE_TYPES as [string, ...string[]]).optional() }),
      req.query,
    );
    res.json(await knowledge.search(q.q, { type: q.type as KnowledgeType | undefined, limit: 20 }));
  });

  r.get('/knowledge/file', async (req, res) => {
    const q = parse(z.object({ path: knowledgePath }), req.query);
    let file;
    try {
      file = await knowledge.read(q.path);
    } catch (err) {
      throw knowledgeError(err);
    }
    if (!file) throw new HttpError(404, 'Knowledge file not found');
    res.json(file);
  });

  r.put('/knowledge/file', async (req, res) => {
    const body = parse(z.object({ path: knowledgePath, content: z.string().max(MAX_KNOWLEDGE_FILE_BYTES) }), req.body);
    try {
      res.json(await knowledge.write(body.path, body.content));
    } catch (err) {
      throw knowledgeError(err);
    }
  });

  r.delete('/knowledge/file', async (req, res) => {
    const q = parse(z.object({ path: knowledgePath }), req.query);
    try {
      res.json({ result: await knowledge.remove(q.path) });
    } catch (err) {
      throw knowledgeError(err, 404);
    }
  });

  /** Bulk import (e.g. a whole folder of .md files picked in the browser). */
  r.post('/knowledge/import', express.json({ limit: '50mb' }), async (req, res) => {
    const body = parse(
      z.object({ files: z.array(z.object({ path: knowledgePath, content: z.string().max(MAX_KNOWLEDGE_FILE_BYTES) })).min(1).max(500) }),
      req.body,
    );
    const imported = [];
    const failed: Array<{ path: string; error: string }> = [];
    for (const f of body.files) {
      try {
        imported.push(await knowledge.write(f.path, f.content));
      } catch (err) {
        failed.push({ path: f.path, error: err instanceof Error ? err.message : String(err) });
      }
    }
    res.status(imported.length ? 201 : 400).json({ imported, failed });
  });

  /** A Markdown artifact (e.g. the .md of a TSD) saved as a knowledge file; 409 when the path is taken (send overwrite). */
  r.post('/knowledge/import-artifact', async (req, res) => {
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
    );
    try {
      const { entry, replaced } = await importArtifactToKnowledge(knowledge, artifacts, {
        artifactId: body.artifactId,
        path: body.path,
        overwrite: body.overwrite,
        meta: { ...body, type: body.type as KnowledgeType },
      });
      res.status(201).json({ entry, replaced });
    } catch (err) {
      if (err instanceof KnowledgeConflictError) throw new HttpError(409, err.message);
      if (err instanceof KnowledgeInputError) throw new HttpError(err.status, err.message);
      throw knowledgeError(err);
    }
  });

  /** Spreadsheet (xlsx/csv) catalogs of systems, APIs or integrations: one Markdown file per row. */
  const readTables = async (req: Request) => {
    const q = parse(z.object({ name: z.string().trim().min(1).max(300).regex(/\.(xlsx|xlsm|csv)$/i, 'pilih file .xlsx, .xlsm atau .csv') }), req.query);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, 'Isi file kosong');
    try {
      const doc = await extractIsolated(req.body, q.name, { tableRows: MAX_IMPORT_ROWS + 10, maxChars: 40_000_000 });
      return { name: q.name, tables: doc.tables ?? [] };
    } catch (err) {
      if (err instanceof DocumentError) throw new HttpError(err.status, err.message);
      throw err;
    }
  };

  r.post('/knowledge/tables', uploadBody, async (req, res) => {
    const { tables } = await readTables(req);
    res.json(previewTables(tables));
  });

  r.post('/knowledge/import-table', uploadBody, async (req, res) => {
    let raw: unknown;
    try {
      raw = JSON.parse(String(req.query.options ?? ''));
    } catch {
      throw new HttpError(400, 'options: expected JSON');
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
    );
    const { name, tables } = await readTables(req);
    const table = tables.find((t) => t.name === opts.sheet);
    if (!table) throw new HttpError(400, `Sheet "${opts.sheet}" tidak ada di file`);
    try {
      res.status(201).json(await importTable(knowledge, table, name, { ...opts, titleColumn: opts.titleColumn || undefined, statusColumn: opts.statusColumn || undefined, type: opts.type as KnowledgeType | undefined }));
    } catch (err) {
      throw knowledgeError(err);
    }
  });

  /** Word, PDF, PowerPoint, Markdown or text kept as knowledge (whole, or one file per chapter). */
  r.post('/knowledge/import-document', uploadBody, async (req, res) => {
    let raw: unknown;
    try {
      raw = JSON.parse(String(req.query.options ?? '{}'));
    } catch {
      throw new HttpError(400, 'options: expected JSON');
    }
    const q = parse(z.object({ name: z.string().trim().min(1).max(300) }), req.query);
    const opts = parse(
      z.object({
        folder: z.string().trim().min(1).max(200),
        split: z.union([z.literal('none'), z.literal(1), z.literal(2)]).default('none'),
        type: z.enum(KNOWLEDGE_TYPES as [string, ...string[]]).optional(),
        title: z.string().trim().max(150).optional(),
        removeStale: z.boolean().default(true),
      }),
      raw,
    );
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, 'Isi file kosong');
    let doc;
    try {
      doc = await extractIsolated(req.body, q.name);
    } catch (err) {
      if (err instanceof DocumentError) throw new HttpError(err.status, err.message);
      throw err;
    }
    try {
      const result = await importDocument(knowledge, doc.markdown, q.name, { ...opts, type: opts.type as KnowledgeType | undefined });
      res.status(201).json({ ...result, warnings: [...doc.warnings, ...result.warnings] });
    } catch (err) {
      throw knowledgeError(err);
    }
  });

  return r;
}
