import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createAgentRunner, type MessagesStreamer } from './agent/agent.js';
import { createBuiltinTools } from './agent/builtinTools.js';
import type { AgentTool } from './agent/types.js';
import { APP_NAME, APP_VERSION, loadConfig, type AppConfig } from './config.js';
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
import { EventBus } from './tasks/eventBus.js';
import { TaskManager } from './tasks/taskManager.js';

const log = createLogger('server');

export interface StartOptions {
  config?: AppConfig;
  /** Override the configured port (0 = random free port, used by the desktop app). */
  port?: number;
  /** Inject a model client (tests). Defaults to the Anthropic SDK. */
  messages?: MessagesStreamer;
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
  const tasks = new TaskManager(repo, artifacts, bus, {
    concurrency: config.taskConcurrency,
    model: config.anthropic.model,
    confirmationTimeoutMs: config.confirmationTimeoutMs,
  });
  await tasks.recoverInterrupted();

  const skills = new SkillStore(config.builtinSkillsDir, config.userSkillsDir, config.dataDir);
  await skills.init();
  const plugins = new PluginStore(config.dataDir, config.defaultPluginsFile);
  await plugins.init();
  const mcp = new McpManager(plugins, bus);

  const messages = options.messages ?? new Anthropic({ maxRetries: 4 }).beta.messages;
  tasks.setRunner(
    createAgentRunner({
      config,
      messages,
      skills,
      plugins,
      mcp,
      builtinTools: [...createBuiltinTools({ config, skills, artifacts }), ...(options.extraTools ?? [])],
    }),
  );

  const app = express();
  app.disable('x-powered-by');
  app.use('/api', createApiRouter({ config, repo, objectsKind: objects.kind, tasks, artifacts, bus, skills, plugins, mcp }));

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
  log.info(`${APP_NAME} ${APP_VERSION} listening on ${url}`);
  log.info(`Storage: ${repo.kind} database, ${objects.kind} artifacts (data dir: ${config.dataDir})`);
  log.info(`Model: ${config.anthropic.model} (effort ${config.anthropic.effort})${config.anthropic.configured ? '' : ' - WARNING: ANTHROPIC_API_KEY is not set'}`);

  return {
    url,
    port: actualPort,
    config,
    async close() {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await mcp.shutdown();
      await repo.close();
    },
  };
}
