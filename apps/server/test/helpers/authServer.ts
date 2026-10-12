import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AuthMe, Role, StreamMessage, User } from '@solar/shared';
import type { ResponsesStreamer, ResponseStreamLike, StreamParams } from '../../src/agent/agent.js';
import type { AgentTool } from '../../src/agent/types.js';
import type { AuthServiceOptions } from '../../src/auth/authService.js';
import { loadConfig, type AppConfig } from '../../src/config.js';
import { startServer, type RunningServer } from '../../src/server.js';
import { TEST_ACCESS_TOKEN } from './auth.js';

export { TEST_ACCESS_TOKEN };

/** Fast scrypt for servers whose tests are not about hashing (N=2^10 instead of 2^15). */
export const FAST_SCRYPT = { N: 2 ** 10, r: 8, p: 1 };
/** Rate limits out of the way for tests that are not about them (every test request comes from 127.0.0.1). */
export const LOOSE_LIMITS = { loginFailures: 10_000, registrations: 10_000, setupAttempts: 10_000, passwordFailures: 10_000 };

export const STRONG_PASSWORD = 'correct horse battery';

export function authTestConfig(overrides: Record<string, string> = {}, dataDir = mkdtempSync(join(tmpdir(), 'solar-auth-'))): AppConfig {
  const config = loadConfig({
    ...process.env,
    SOLAR_ROOT: fileURLToPath(new URL('../../../..', import.meta.url)),
    DATA_DIR: dataDir,
    PLUGINS_DEFAULT_FILE: join(dataDir, 'no-plugins.json'),
    DATABASE_URL: '',
    S3_BUCKET: '',
    GITHUB_TOKEN: '',
    PLANE_API_KEY: '',
    SOLAR_ACCESS_TOKEN: '',
    SOLAR_ADMIN_USERNAME: '',
    SOLAR_ADMIN_EMAIL: '',
    SOLAR_ADMIN_PASSWORD: '',
    SOLAR_ADMIN_NAME: '',
    SESSION_TTL_HOURS: '',
    SESSION_MAX_DAYS: '',
    TRUST_PROXY: '',
    HOST: '127.0.0.1',
    KNOWLEDGE_DIR: '',
    ...overrides,
  });
  config.databaseUrl = undefined;
  config.s3 = null;
  config.github.token = undefined;
  config.plane.apiKey = undefined;
  return config;
}

type Item = Record<string, unknown>;

export const fnCall = (id: string, name: string, args: unknown): Item => ({
  type: 'function_call',
  id: `fc_${id}`,
  call_id: id,
  name,
  arguments: JSON.stringify(args),
  status: 'completed',
});
export const message = (text: string): Item => ({
  type: 'message',
  id: `msg_${Math.random()}`,
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text, annotations: [] }],
});

/**
 * A model that decides each turn from the conversation so far: `next(input)` returns the output items. Records every
 * call's input (as JSON) for assertions.
 */
export class StatelessModel implements ResponsesStreamer {
  readonly inputs: string[] = [];

  constructor(private readonly next: (input: Item[], text: string) => Item[]) {}

  stream(params: StreamParams): ResponseStreamLike {
    const input = params.input as unknown as Item[];
    const text = JSON.stringify(input);
    this.inputs.push(text);
    const output = this.next(input, text);
    return {
      on() {
        return this;
      },
      async finalResponse() {
        return {
          id: `resp_${Math.random()}`,
          object: 'response',
          model: 'gpt-6.1-sol-2026-09-01',
          status: 'completed',
          output,
          error: null,
          incomplete_details: null,
          usage: {
            input_tokens: 10,
            input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
            output_tokens: 5,
            output_tokens_details: { reasoning_tokens: 0 },
            total_tokens: 15,
          },
        } as never;
      },
    };
  }
}

/** A tool that needs the user's approval for every call (keeps its task waiting until answered). */
export const approvalTool: AgentTool = {
  name: 'test_external_write',
  displayName: 'Test external write',
  description: 'Pretends to write to an external system',
  inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
  source: 'mcp',
  pluginId: 'test',
  pluginName: 'Test',
  parse: (input) => ({ ok: true, value: input }),
  confirmation: () => 'Test plugin requires approval',
  execute: async (input) => ({ content: `wrote ${(input as { value: string }).value}`, summary: 'written' }),
};

export async function startAuthServer(
  options: { config?: AppConfig; auth?: AuthServiceOptions; responses?: ResponsesStreamer; extraTools?: AgentTool[] } = {},
): Promise<RunningServer> {
  return startServer({
    config: options.config ?? authTestConfig(),
    port: 0,
    auth: options.auth ?? { scrypt: FAST_SCRYPT, limits: LOOSE_LIMITS },
    responses: options.responses,
    extraTools: options.extraTools,
  });
}

export interface ApiResult<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
  setCookies: string[];
}

/** A client that keeps the solar_session cookie like a browser (Origin is sent only when given). */
export class Client {
  session: string | null = null;

  constructor(
    readonly base: string,
    readonly defaults: Record<string, string> = {},
  ) {}

  async raw(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    const h = new Headers({ ...this.defaults, ...headers });
    if (body !== undefined && !h.has('content-type')) h.set('Content-Type', 'application/json');
    if (this.session && !h.has('cookie')) h.set('Cookie', `solar_session=${this.session}`);
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? (body as string) : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const m = /^solar_session=([^;]*)/.exec(c);
      if (m) this.session = m[1] || null;
    }
    return res;
  }

  async call<T = Record<string, unknown>>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResult<T>> {
    const res = await this.raw(method, path, body, headers);
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // not JSON (downloads)
    }
    return { status: res.status, body: parsed as T, headers: res.headers, setCookies: res.headers.getSetCookie() };
  }

  get<T = Record<string, unknown>>(path: string, headers?: Record<string, string>) {
    return this.call<T>('GET', path, undefined, headers);
  }

  post<T = Record<string, unknown>>(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.call<T>('POST', path, body ?? {}, headers);
  }

  patch<T = Record<string, unknown>>(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.call<T>('PATCH', path, body ?? {}, headers);
  }

  put<T = Record<string, unknown>>(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.call<T>('PUT', path, body ?? {}, headers);
  }

  delete<T = Record<string, unknown>>(path: string, headers?: Record<string, string>) {
    return this.call<T>('DELETE', path, undefined, headers);
  }

  /** POST /api/auth/login: the AuthMe on success, `{ error, code }` otherwise. */
  async login(identifier: string, password = STRONG_PASSWORD): Promise<ApiResult<AuthMe & { error?: string; code?: string }>> {
    return this.post<AuthMe & { error?: string; code?: string }>('/api/auth/login', { identifier, password });
  }
}

/** A client authenticated with SOLAR_ACCESS_TOKEN (acts as a superadmin). */
export function tokenClient(base: string): Client {
  return new Client(base, { Authorization: `Bearer ${TEST_ACCESS_TOKEN}` });
}

/** Creates an active account through the API (as `admin`) and returns a client logged in to it. */
export async function userClient(base: string, admin: Client, username: string, role: Role, name = username): Promise<{ client: Client; user: User }> {
  const created = await admin.post<User>('/api/users', { username, email: `${username}@solar.test`, name, password: STRONG_PASSWORD, role });
  if (created.status !== 201) throw new Error(`create ${username}: ${created.status} ${JSON.stringify(created.body)}`);
  const client = new Client(base);
  const login = await client.login(username);
  if (login.status !== 200) throw new Error(`login ${username}: ${login.status} ${JSON.stringify(login.body)}`);
  return { client, user: created.body };
}

/** Reads an event stream into a list until aborted. */
export function openStream(base: string, headers: Record<string, string>): { messages: StreamMessage[]; ended: Promise<void>; close(): void } {
  const controller = new AbortController();
  const messages: StreamMessage[] = [];
  const ended = (async () => {
    const res = await fetch(`${base}/api/stream`, { headers, signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`stream: ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const data = chunk
          .split('\n')
          .filter((l) => l.startsWith('data: '))
          .map((l) => l.slice(6))
          .join('');
        if (data) messages.push(JSON.parse(data) as StreamMessage);
      }
    }
  })().catch((err: unknown) => {
    if ((err as { name?: string }).name !== 'AbortError') throw err;
  });
  return { messages, ended, close: () => controller.abort() };
}

/** Polls until `check` returns a value (not undefined/false) or the timeout passes. */
export async function waitFor<T>(check: () => T | Promise<T>, timeoutMs = 10_000, what = 'condition'): Promise<NonNullable<T>> {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value !== undefined && value !== null && value !== false) return value as NonNullable<T>;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
