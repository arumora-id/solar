import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { PluginConfig, PluginStatus } from '@solar/shared';
import type { ToolResultBlock } from '../agent/types.js';
import { APP_SLUG, APP_VERSION } from '../config.js';
import { both, DEFAULT_LANG, localize, type Lang, type LocalizedText } from '../i18n.js';
import { createLogger } from '../logger.js';
import type { EventBus } from '../tasks/eventBus.js';
import { nowIso } from '../util/ids.js';
import { type PluginStore, resolvePlugin } from './pluginStore.js';

const log = createLogger('mcp');

const MAX_RESULT_CHARS = 150_000;
const WRITE_VERB =
  /(^|_|-)(create|update|delete|remove|write|push|merge|add|set|assign|unassign|close|reopen|edit|move|upload|post|put|patch|fork|transfer|archive|publish|commit|comment|approve|dismiss|lock|unlock|run|trigger|cancel|rerun|import|export|rename|insert|modify|submit|send|enable|disable)/i;

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string };
}

export interface McpToolBinding {
  qualifiedName: string;
  plugin: PluginConfig;
  tool: McpToolDescriptor;
}

export type McpResultBlock = ToolResultBlock;

export interface McpCallResult {
  blocks: McpResultBlock[];
  isError: boolean;
}

interface Connection {
  client: Client | null;
  transport: Transport | null;
  /** The status without its error, which is kept in `error` (in both languages when SOLAR wrote it). */
  status: PluginStatus;
  error: LocalizedText | null;
  tools: McpToolDescriptor[];
  connecting: Promise<void> | null;
  /** Bumped by every connect/disconnect: an attempt that sees a newer generation gives up. */
  gen: number;
  /** Client of the attempt in flight (closed when a newer request supersedes it). */
  pending: Client | null;
}

class Superseded extends Error {}

/** OpenAI function names must match ^[a-zA-Z0-9_-]{1,64}$. */
export function qualifyToolName(pluginId: string, toolName: string): string {
  const plugin = pluginId.replace(/[^a-zA-Z0-9]/g, '_');
  const tool = toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const full = `mcp__${plugin}__${tool}`;
  if (full.length <= 64) return full;
  const hash = createHash('sha1').update(full).digest('hex').slice(0, 6);
  return `${full.slice(0, 57)}_${hash}`;
}

/** True when a tool probably changes state (used by the `writes` confirmation policy). */
export function isWriteTool(tool: McpToolDescriptor): boolean {
  if (tool.annotations?.readOnlyHint === true) return false;
  if (tool.annotations?.destructiveHint === true) return true;
  if (/^(get|list|search|read|fetch|find|query|describe|view|show|download)[_-]/i.test(tool.name)) return false;
  return WRITE_VERB.test(tool.name);
}

/**
 * Environment for stdio plugins: the SDK's safe defaults plus proxy, certificate, npm and Windows
 * system variables (so `npx` works behind corporate proxies) - but never other secrets of SOLAR.
 */
const PASS_THROUGH_ENV = /^(https?_proxy|no_proxy|all_proxy|node_extra_ca_certs|ssl_cert_file|ssl_cert_dir|npm_config_[a-z0-9_]+|pathext|comspec|temp|tmp|tmpdir|programdata|programfiles|programfiles\(x86\)|systemroot|windir|appdata|localappdata|userprofile|homedrive|homepath|xdg_[a-z_]+)$/i;

export function stdioEnvironment(extra: Record<string, string>, source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = { ...getDefaultEnvironment() };
  for (const [k, v] of Object.entries(source)) {
    if (v !== undefined && PASS_THROUGH_ENV.test(k)) env[k] = v;
  }
  return { ...env, ...extra };
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms);
    }),
  ]);
}

export class McpManager {
  private readonly connections = new Map<string, Connection>();

  constructor(
    private readonly store: PluginStore,
    private readonly bus: EventBus,
  ) {}

  private conn(id: string): Connection {
    let c = this.connections.get(id);
    if (!c) {
      c = {
        client: null,
        transport: null,
        tools: [],
        connecting: null,
        gen: 0,
        pending: null,
        status: { id, state: 'disabled', error: null, tools: [], connectedAt: null },
        error: null,
      };
      this.connections.set(id, c);
    }
    return c;
  }

  /** Every plugin's status; the errors SOLAR writes itself are in `lang` (errors of a server are as it sent them). */
  statuses(lang: Lang = DEFAULT_LANG): PluginStatus[] {
    return this.store.list().map((p) => this.status(p.id, lang));
  }

  status(id: string, lang: Lang = DEFAULT_LANG): PluginStatus {
    const c = this.conn(id);
    return { ...c.status, error: c.error === null ? null : localize(c.error, lang) };
  }

  /**
   * Updates a status and announces every status on the event stream (in Indonesian; the stream route sends each
   * client the statuses in its own language).
   */
  private setStatus(id: string, patch: Omit<Partial<PluginStatus>, 'error'> & { error?: LocalizedText | null }): void {
    const c = this.conn(id);
    const { error, ...rest } = patch;
    if (error !== undefined) c.error = error;
    c.status = { ...c.status, ...rest };
    this.bus.publish({ kind: 'plugins', plugins: this.statuses() });
  }

  /** Connects every enabled plugin in the background (errors are reported in the status). */
  startAll(): void {
    for (const p of this.store.list()) void this.connect(p.id).catch(() => undefined);
  }

  /**
   * (Re)connects with the plugin's current config. A newer connect/disconnect supersedes an attempt in flight,
   * so an edit, disable or delete during a slow start never leaves the old config connected.
   */
  async connect(id: string): Promise<void> {
    const c = this.conn(id);
    const gen = ++c.gen;
    await this.closePending(c);
    const previous = c.connecting;
    const tracked: Promise<void> = (async () => {
      if (previous) await previous.catch(() => undefined);
      if (c.gen !== gen) return;
      await this.doConnect(id, gen);
    })().finally(() => {
      if (c.connecting === tracked) c.connecting = null;
    });
    c.connecting = tracked;
    return tracked;
  }

  private async closePending(c: Connection): Promise<void> {
    const pending = c.pending;
    c.pending = null;
    if (pending) await pending.close().catch(() => undefined);
  }

  private async closeCurrent(c: Connection): Promise<void> {
    const client = c.client;
    c.client = null;
    c.transport = null;
    c.tools = [];
    if (client) await client.close().catch(() => undefined);
  }

  private async doConnect(id: string, gen: number): Promise<void> {
    const c = this.conn(id);
    const superseded = () => c.gen !== gen;
    await this.closeCurrent(c);
    // from here until `c.pending = client` there is no await, so a newer request cannot slip in unnoticed
    if (superseded()) return;
    const config = this.store.get(id);
    if (!config) throw new Error(`Plugin "${id}" not found`);
    if (!config.enabled) {
      this.setStatus(id, { state: 'disabled', error: null, tools: [], connectedAt: null });
      return;
    }
    const resolved = resolvePlugin(config);
    if (resolved.missingVars.length > 0) {
      this.setStatus(id, {
        state: 'unconfigured',
        error: both('mcp.missingVars', { vars: resolved.missingVars.join(', ') }),
        tools: [],
        connectedAt: null,
      });
      return;
    }

    this.setStatus(id, { state: 'connecting', error: null });
    let transport: Transport;
    let endpoint: URL | null = null;
    if (config.transport !== 'stdio') {
      try {
        endpoint = new URL(resolved.url ?? '');
        if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') throw new Error('unsupported protocol');
      } catch {
        const message = both('mcp.invalidUrl', { url: resolved.url ?? '' });
        this.setStatus(id, { state: 'error', error: message, tools: [], connectedAt: null });
        throw new Error(message[DEFAULT_LANG]);
      }
    }
    if (config.transport === 'stdio') {
      const stdio = new StdioClientTransport({
        command: resolved.command!,
        args: resolved.args,
        env: stdioEnvironment(resolved.env),
        stderr: 'pipe',
      });
      stdio.stderr?.on('data', (chunk: Buffer) => log.debug(`[${id}] ${chunk.toString().trim()}`));
      transport = stdio;
    } else if (config.transport === 'http') {
      transport = new StreamableHTTPClientTransport(endpoint!, {
        requestInit: { headers: resolved.headers },
      });
    } else {
      const headers = resolved.headers;
      transport = new SSEClientTransport(endpoint!, {
        requestInit: { headers },
        eventSourceInit: {
          fetch: (url, init) => fetch(url, { ...init, headers: { ...(init?.headers as Record<string, string>), ...headers } }),
        },
      });
    }

    const client = new Client({ name: APP_SLUG, version: APP_VERSION }, { capabilities: {} });
    c.pending = client;
    try {
      const timeoutMs = config.transport === 'stdio' ? 180_000 : 45_000;
      // first start of an `npx` server downloads the package: allow the same time for the MCP handshake
      await withTimeout(client.connect(transport, { timeout: timeoutMs }), timeoutMs, `Connecting to ${config.name}`);
      if (superseded()) throw new Superseded();
      const tools: McpToolDescriptor[] = [];
      let cursor: string | undefined;
      do {
        const page = await withTimeout(client.listTools(cursor ? { cursor } : undefined), 45_000, 'Listing tools');
        for (const t of page.tools) {
          tools.push({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema as Record<string, unknown>,
            annotations: t.annotations as McpToolDescriptor['annotations'],
          });
        }
        cursor = page.nextCursor;
        if (superseded()) throw new Superseded();
      } while (cursor);

      c.pending = null;
      c.client = client;
      c.transport = transport;
      c.tools = tools;
      client.onclose = () => {
        if (c.client === client) {
          c.client = null;
          this.setStatus(id, { state: 'error', error: both('mcp.disconnected'), connectedAt: null });
        }
      };
      this.setStatus(id, {
        state: 'connected',
        error: null,
        tools: tools.map((t) => ({ name: t.name, description: (t.description ?? '').slice(0, 300) })),
        connectedAt: nowIso(),
      });
      log.info(`Connected to ${config.name} (${tools.length} tools)`);
    } catch (err) {
      if (c.pending === client) c.pending = null;
      await client.close().catch(() => undefined);
      // a newer connect/disconnect owns the status now
      if (err instanceof Superseded || superseded()) return;
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`Could not connect to ${config.name}: ${message}`);
      this.setStatus(id, { state: 'error', error: message, tools: [], connectedAt: null });
      throw err;
    }
  }

  async disconnect(id: string, publish = true): Promise<void> {
    const c = this.conn(id);
    c.gen += 1;
    await this.closePending(c);
    await this.closeCurrent(c);
    if (publish) this.setStatus(id, { state: 'disabled', error: null, tools: [], connectedAt: null });
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.connections.keys()].map((id) => this.disconnect(id, false)));
  }

  /** Tools of every connected plugin after allow/deny filtering, sorted for prompt-cache stability. */
  bindings(): McpToolBinding[] {
    const out: McpToolBinding[] = [];
    for (const plugin of this.store.list()) {
      const c = this.connections.get(plugin.id);
      if (!plugin.enabled || !c?.client) continue;
      const allow = plugin.toolAllowlist?.length ? new Set(plugin.toolAllowlist) : null;
      const deny = new Set(plugin.toolDenylist ?? []);
      for (const tool of c.tools) {
        if (allow && !allow.has(tool.name)) continue;
        if (deny.has(tool.name)) continue;
        out.push({ qualifiedName: qualifyToolName(plugin.id, tool.name), plugin, tool });
      }
    }
    return out.sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
  }

  async callTool(pluginId: string, toolName: string, args: Record<string, unknown>, signal: AbortSignal): Promise<McpCallResult> {
    let c = this.connections.get(pluginId);
    if (!c?.client) {
      await this.connect(pluginId);
      c = this.connections.get(pluginId);
    }
    if (!c?.client) throw new Error(`Plugin "${pluginId}" is not connected`);
    const result = await c.client.callTool({ name: toolName, arguments: args }, undefined, {
      signal,
      timeout: 300_000,
      resetTimeoutOnProgress: true,
    });
    return convertResult(result as { content?: unknown[]; structuredContent?: unknown; isError?: boolean });
  }
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function convertResult(result: { content?: unknown[]; structuredContent?: unknown; isError?: boolean }): McpCallResult {
  const blocks: McpResultBlock[] = [];
  let textBudget = MAX_RESULT_CHARS;
  const pushText = (text: string) => {
    if (textBudget <= 0) return;
    if (text.length > textBudget) {
      blocks.push({
        type: 'text',
        text: `${text.slice(0, textBudget)}\n\n[SOLAR: tool output truncated at ${MAX_RESULT_CHARS} characters; request a narrower query if you need the rest]`,
      });
      textBudget = 0;
      return;
    }
    blocks.push({ type: 'text', text });
    textBudget -= text.length;
  };

  for (const item of result.content ?? []) {
    const block = item as Record<string, unknown>;
    switch (block.type) {
      case 'text':
        pushText(String(block.text ?? ''));
        break;
      case 'image': {
        const mime = String(block.mimeType ?? '');
        if (IMAGE_TYPES.has(mime) && typeof block.data === 'string') {
          blocks.push({ type: 'image', mimeType: mime, data: block.data });
        } else {
          pushText(`[image omitted: unsupported type ${mime || 'unknown'}]`);
        }
        break;
      }
      case 'resource': {
        const resource = (block.resource ?? {}) as Record<string, unknown>;
        if (typeof resource.text === 'string') pushText(`Resource ${String(resource.uri ?? '')}:\n${resource.text}`);
        else pushText(`[binary resource ${String(resource.uri ?? '')} (${String(resource.mimeType ?? 'unknown type')})]`);
        break;
      }
      case 'resource_link':
        pushText(`Resource link: ${String(block.uri ?? '')} ${String(block.name ?? '')}`.trim());
        break;
      default:
        pushText(JSON.stringify(block));
    }
  }
  if (blocks.length === 0 && result.structuredContent !== undefined) {
    pushText(JSON.stringify(result.structuredContent, null, 2));
  }
  if (blocks.length === 0) pushText('(the tool returned no content)');
  return { blocks, isError: result.isError === true };
}
