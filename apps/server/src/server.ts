import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createAgentRunner, type ResponsesStreamer } from './agent/agent.js';
import { createBuiltinTools } from './agent/builtinTools.js';
import { createKnowledgeTools } from './agent/knowledgeTools.js';
import type { AgentTool } from './agent/types.js';
import { APP_NAME, APP_VERSION, loadConfig, type AppConfig } from './config.js';
import { KnowledgeStore } from './knowledge/knowledgeStore.js';
import type { ChatCompletionsApi } from './llm/chatClient.js';
import { LlmProviderStore } from './llm/providerStore.js';
import { ModelRouter } from './llm/router.js';
import { createLogger } from './logger.js';
import { McpManager } from './plugins/mcpManager.js';
import { PluginStore } from './plugins/pluginStore.js';
import { createApiRouter, HttpError } from './routes/api.js';
import { SkillStore } from './skills/skillStore.js';
import { FileRepository } from './storage/fileRepository.js';
import { LocalObjectStore, S3ObjectStore, type ObjectStore } from './storage/objectStore.js';
import { PostgresRepository } from './storage/postgresRepository.js';
import type { Repository } from './storage/repository.js';
import { ArtifactService } from './tasks/artifactService.js';
import { AttachmentService } from './tasks/attachmentService.js';
import { EventBus } from './tasks/eventBus.js';
import { TaskManager } from './tasks/taskManager.js';

const log = createLogger('server');

export interface StartOptions {
  config?: AppConfig;
  /** Override the configured port (0 = random free port, used by the desktop app). */
  port?: number;
  /** Inject the Responses API transport of the .env provider (tests). Defaults to the OpenAI SDK. */
  responses?: ResponsesStreamer;
  /** Inject Chat Completions transports per provider id (tests). */
  chatApis?: Record<string, ChatCompletionsApi>;
  /** Additional tools (tests / extensions). */
  extraTools?: AgentTool[];
}

export interface RunningServer {
  url: string;
  port: number;
  config: AppConfig;
  close(): Promise<void>;
}

export async function startServer(options: StartOptions = {}): Promise<RunningServer> {
  const config = options.config ?? loadConfig();
  // The Plane preset references ${PLANE_API_HOST_URL}; default it to plane.mesthi.com.
  process.env.PLANE_API_HOST_URL ||= config.plane.hostUrl;
  await mkdir(config.dataDir, { recursive: true });

  const repo: Repository = config.databaseUrl ? new PostgresRepository(config.databaseUrl) : new FileRepository(config.dataDir);
  await repo.init();
  const objects: ObjectStore = config.s3 ? new S3ObjectStore(config.s3) : new LocalObjectStore(config.dataDir);

  const bus = new EventBus();
  const artifacts = new ArtifactService(repo, objects);
  const attachments = new AttachmentService(repo, objects, { maxFileBytes: config.attachments.maxFileBytes });
  const llm = new LlmProviderStore(config);
  await llm.init();
  const models = new ModelRouter({ config, store: llm, envStreamer: options.responses, chatApis: options.chatApis });
  const tasks = new TaskManager(repo, artifacts, bus, {
    concurrency: config.taskConcurrency,
    model: () => models.primaryLabel(),
    confirmationTimeoutMs: config.confirmationTimeoutMs,
  });
  await tasks.recoverInterrupted();

  const skills = new SkillStore(config.builtinSkillsDir, config.userSkillsDir, config.dataDir);
  await skills.init();
  const knowledge = new KnowledgeStore(config.builtinKnowledgeDir, config.userKnowledgeDir);
  await knowledge.init();
  const plugins = new PluginStore(config.dataDir, config.defaultPluginsFile);
  await plugins.init();
  const mcp = new McpManager(plugins, bus);

  tasks.setRunner(
    createAgentRunner({
      config,
      models,
      skills,
      knowledge,
      plugins,
      mcp,
      attachments,
      builtinTools: [...createBuiltinTools({ config, skills, artifacts, attachments }), ...createKnowledgeTools(knowledge), ...(options.extraTools ?? [])],
    }),
  );

  const app = express();
  app.disable('x-powered-by');
  app.use('/api', createApiRouter({ config, repo, objectsKind: objects.kind, tasks, artifacts, attachments, bus, skills, plugins, mcp, knowledge, llm, models }));

  if (existsSync(join(config.webDistDir, 'index.html'))) {
    app.use(express.static(config.webDistDir, { index: false, maxAge: '1h' }));
    // single page app: every non-API route serves index.html (/, /monitor, /monitor/<task>)
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(join(config.webDistDir, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .type('text/plain')
        .send(`${APP_NAME} API is running. Build the web UI with "npm run build" (or use "npm run dev" and open http://localhost:5173).`);
    });
  }

  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    const status = err instanceof HttpError ? err.status : (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : String(err);
    if (status >= 500) log.error('Request failed', err);
    res.status(status).json({ error: message });
  });

  const port = options.port ?? config.port;
  const server = await new Promise<import('node:http').Server>((resolve, reject) => {
    const s = app.listen(port, config.host, () => resolve(s));
    s.on('error', reject);
  });
  const actualPort = (server.address() as AddressInfo).port;
  const host = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
  const url = `http://${host}:${actualPort}`;

  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(config.host);
  if (!loopback && !config.accessToken) {
    log.warn(`HOST=${config.host} exposes SOLAR on the network without SOLAR_ACCESS_TOKEN - set a token in .env.`);
  }

  mcp.startAll();
  // documents uploaded but never sent with a request are removed after a day
  const ATTACHMENT_GC_AGE = 24 * 3_600_000;
  const gc = () => void attachments.collectGarbage(ATTACHMENT_GC_AGE).catch((err) => log.warn(`Attachment cleanup failed: ${String(err)}`));
  gc();
  const gcTimer = setInterval(gc, 6 * 3_600_000);
  gcTimer.unref();
  log.info(`${APP_NAME} ${APP_VERSION} listening on ${url}`);
  log.info(`Storage: ${repo.kind} database, ${objects.kind} artifacts (data dir: ${config.dataDir})`);
  log.info(`Model route: ${llm.route().join(' -> ')}${models.primaryReady() ? '' : ' - WARNING: the primary model has no API key (OPENAI_API_KEY or Pengaturan → Model AI)'}`);
  log.info(`Knowledge base: ${(await knowledge.list()).length} file(s) in ${config.userKnowledgeDir}`);

  return {
    url,
    port: actualPort,
    config,
    async close() {
      clearInterval(gcTimer);
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await mcp.shutdown();
      await repo.close();
    },
  };
}
