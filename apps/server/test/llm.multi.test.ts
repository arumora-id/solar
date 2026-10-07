import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LlmSettingsView, LlmTestResult, PublicConfig, Task, TaskDetail } from '@solar/shared';
import { SECRET_MASK } from '@solar/shared';
import { ThinkTagSplitter, toChatMessages } from '../src/llm/chatClient.js';
import { loadConfig } from '../src/config.js';
import { startServer, type RunningServer } from '../src/server.js';

/**
 * Multi-provider routing through the real OpenAI SDK against a local fake of the Chat Completions API:
 * an OpenAI-compatible gateway (e.g. OmniRoute / Ollama), a provider that rejects the key (fallback),
 * provider management over the REST API.
 */

type Json = Record<string, unknown>;

const requests: Array<{ path: string; auth: string | undefined; body: Json }> = [];

function chunk(model: string, delta: Json, finish: string | null = null, usage?: Json): string {
  return `data: ${JSON.stringify({ id: 'chatcmpl_1', object: 'chat.completion.chunk', created: 1_760_000_000, model, choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`;
}

function handle(req: IncomingMessage, res: ServerResponse, raw: string): void {
  const url = req.url ?? '';
  if (req.method === 'GET' && url === '/good/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'qwen-local', object: 'model', created: 0, owned_by: 'me' }, { id: 'claude-x', object: 'model', created: 0, owned_by: 'me' }] }));
    return;
  }
  if (req.method !== 'POST' || !url.endsWith('/v1/chat/completions')) {
    res.writeHead(404).end();
    return;
  }
  const body = JSON.parse(raw) as Json;
  requests.push({ path: url, auth: req.headers.authorization, body });
  if (url.startsWith('/bad/')) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'invalid key', type: 'invalid_request_error', code: 'invalid_api_key' } }));
    return;
  }
  const model = String(body.model);
  const messages = body.messages as Json[];
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const answered = messages.some((m) => m.role === 'tool');
  if (!answered) {
    res.write(chunk(model, { role: 'assistant', content: '<thi' }));
    res.write(chunk(model, { content: 'nk>Perlu cek knowledge.</think>' }));
    res.write(chunk(model, { tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'update_progress', arguments: '{"percent":' } }] }));
    res.write(chunk(model, { tool_calls: [{ index: 0, function: { arguments: '30,"step":"Analisis"}' } }] }));
    res.write(chunk(model, { tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'list_knowledge', arguments: '{}' } }] }));
    res.write(chunk(model, {}, 'tool_calls'));
  } else {
    res.write(chunk(model, { content: 'Halo dari ' }));
    res.write(chunk(model, { content: 'gateway.' }));
    res.write(chunk(model, {}, 'stop'));
  }
  res.write(`data: ${JSON.stringify({ id: 'chatcmpl_1', object: 'chat.completion.chunk', created: 0, model, choices: [], usage: { prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050, prompt_tokens_details: { cached_tokens: 400 } } })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

let fake: Server;
let base: string;
let solar: RunningServer;

async function api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${solar.url}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as T };
}

async function runTask(prompt: string): Promise<TaskDetail> {
  const { data } = await api<Task>('POST', '/api/tasks', { prompt, sessionId: 'llm-test' });
  for (let i = 0; i < 200; i++) {
    const detail = (await api<TaskDetail>('GET', `/api/tasks/${data.id}`)).data;
    if (['completed', 'failed', 'cancelled'].includes(detail.task.status)) return detail;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('task did not finish');
}

beforeAll(async () => {
  fake = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString('utf8')));
    req.on('end', () => handle(req, res, raw));
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;

  const dataDir = mkdtempSync(join(tmpdir(), 'solar-llm-'));
  const config = loadConfig({
    ...process.env,
    SOLAR_ROOT: fileURLToPath(new URL('../../..', import.meta.url)),
    DATA_DIR: dataDir,
    PLUGINS_DEFAULT_FILE: join(dataDir, 'no-plugins.json'),
    OPENAI_API_KEY: '',
    OPENAI_BASE_URL: '',
    SOLAR_MODEL: 'gpt-6.1-sol',
    GATEWAY_KEY: 'sk-gateway-from-env',
  });
  config.openai.apiKey = undefined;
  config.openai.configured = false;
  config.databaseUrl = undefined;
  config.s3 = null;
  config.accessToken = undefined;
  config.github.token = undefined;
  config.plane.apiKey = undefined;
  process.env.GATEWAY_KEY = 'sk-gateway-from-env';
  solar = await startServer({ config, port: 0 });
});

afterAll(async () => {
  await solar?.close();
  await new Promise<void>((resolve) => fake.close(() => resolve()));
});

describe('Multi-provider LLM routing', () => {
  it('starts with the .env provider as the default route', async () => {
    const { data } = await api<LlmSettingsView>('GET', '/api/llm');
    expect(data.routes.default).toEqual(['openai/gpt-6.1-sol']);
    expect(data.providers[0]).toMatchObject({ id: 'openai', source: 'env', ready: false });
    const cfg = (await api<PublicConfig>('GET', '/api/config')).data;
    expect(cfg.llmConfigured).toBe(false);
    expect(cfg.modelRoute).toEqual(['openai/gpt-6.1-sol']);
  });

  it('manages providers: masks literal keys, keeps ${VAR} references, rejects the reserved id', async () => {
    const created = await api<LlmSettingsView>('POST', '/api/llm/providers', {
      id: 'gateway',
      name: 'OmniRoute',
      kind: 'openai-chat',
      baseUrl: `${base}/good/v1`,
      apiKey: '${GATEWAY_KEY}',
      models: [{ id: 'qwen-local', maxOutputTokens: 4096, price: { input: 0, cachedInput: 0, output: 0 } }],
    });
    expect(created.status).toBe(201);
    const gw = created.data.providers.find((p) => p.id === 'gateway')!;
    expect(gw).toMatchObject({ apiKey: '${GATEWAY_KEY}', ready: true, missingVars: [] });

    const backup = await api<LlmSettingsView>('POST', '/api/llm/providers', { id: 'broken', name: 'Broken', kind: 'openai-chat', baseUrl: `${base}/bad/v1`, apiKey: 'sk-literal-secret' });
    expect(backup.data.providers.find((p) => p.id === 'broken')!.apiKey).toBe(SECRET_MASK);

    // sending the mask back keeps the stored key
    await api('PUT', '/api/llm/providers/broken', { apiKey: SECRET_MASK, name: 'Broken gateway' });
    const view = (await api<LlmSettingsView>('GET', '/api/llm')).data;
    expect(view.providers.find((p) => p.id === 'broken')).toMatchObject({ name: 'Broken gateway', apiKey: SECRET_MASK, ready: true });

    expect((await api('POST', '/api/llm/providers', { id: 'openai', name: 'x', kind: 'openai-chat' })).status).toBe(400);
    expect((await api('PUT', '/api/llm/routes', { routes: { default: ['nope/model'] } })).status).toBe(400);
  });

  it('lists the models of a provider', async () => {
    const { data } = await api<LlmTestResult>('POST', '/api/llm/providers/gateway/test');
    expect(data).toEqual({ ok: true, models: ['claude-x', 'qwen-local'] });
    const broken = (await api<LlmTestResult>('POST', '/api/llm/providers/openai/test')).data;
    expect(broken.ok).toBe(false);
  });

  it('runs a task on a Chat Completions gateway and falls back when the primary model fails', async () => {
    const routes = await api<LlmSettingsView>('PUT', '/api/llm/routes', { routes: { default: ['broken/gpt-x', 'gateway/qwen-local'] } });
    expect(routes.status).toBe(200);
    expect((await api<PublicConfig>('GET', '/api/config')).data).toMatchObject({ llmConfigured: true, provider: 'Broken gateway', model: 'gpt-x' });

    requests.length = 0;
    const detail = await runTask('Tes gateway');
    expect(detail.task.status, detail.task.error ?? '').toBe('completed');
    expect(detail.task.result).toBe('Halo dari gateway.');
    expect(detail.task.model).toBe('broken/gpt-x');

    // the broken provider was tried first (auth errors are not retried), then the gateway did the work
    expect(requests[0]!.path).toBe('/bad/v1/chat/completions');
    expect(requests[0]!.auth).toBe('Bearer sk-literal-secret');
    const gw = requests.filter((r) => r.path.startsWith('/good/'));
    expect(gw).toHaveLength(2);
    expect(gw[0]!.auth).toBe('Bearer sk-gateway-from-env');
    expect(gw[0]!.body).toMatchObject({ model: 'qwen-local', stream: true, max_tokens: 4096, stream_options: { include_usage: true } });
    expect(gw[0]!.body.max_completion_tokens).toBeUndefined();
    expect(gw[0]!.body.reasoning_effort).toBeUndefined();
    const sent = gw[0]!.body.messages as Json[];
    expect(sent[0]!.role).toBe('system');
    expect(String(sent[0]!.content)).toContain('# Knowledge base');
    expect((gw[0]!.body.tools as Json[]).some((t) => (t.function as Json).name === 'read_knowledge')).toBe(true);

    // second turn: assistant tool_calls followed by one tool message per call
    const second = gw[1]!.body.messages as Json[];
    const assistant = second.find((m) => m.role === 'assistant')!;
    expect((assistant.tool_calls as Json[]).map((c) => (c.function as Json).name)).toEqual(['update_progress', 'list_knowledge']);
    expect((assistant.tool_calls as Json[])[0]).toMatchObject({ id: 'call_a', function: { arguments: '{"percent":30,"step":"Analisis"}' } });
    const tools = second.filter((m) => m.role === 'tool');
    expect(tools.map((m) => m.tool_call_id)).toEqual(['call_a', 'call_b']);
    expect(String(tools[1]!.content)).toContain('"count"');

    const logs = detail.events.filter((e) => e.type === 'log').map((e) => JSON.stringify(e));
    expect(logs.some((l) => l.includes('Beralih ke model cadangan gateway/qwen-local'))).toBe(true);
    const thinking = detail.events.filter((e) => e.type === 'thinking').map((e) => (e as { text: string }).text);
    expect(thinking).toContain('Perlu cek knowledge.');
    // local model priced at 0
    expect(detail.task.usage.costUsd).toBe(0);
    expect(detail.task.usage.cacheReadTokens).toBe(800);
  });

  it('fails with the provider error when every model of the route fails', async () => {
    await api('PUT', '/api/llm/routes', { routes: { default: ['broken/gpt-x'] } });
    const detail = await runTask('Tes gagal');
    expect(detail.task.status).toBe('failed');
    expect(detail.task.error).toContain('Autentikasi Broken gateway gagal');
    await api('PUT', '/api/llm/routes', { routes: {} });
    expect((await api<LlmSettingsView>('GET', '/api/llm')).data.routes.default).toEqual(['openai/gpt-6.1-sol']);
  });
});

describe('Chat Completions helpers', () => {
  it('splits <think> blocks across chunk boundaries', () => {
    let text = '';
    let think = '';
    const s = new ThinkTagSplitter(
      (t) => (text += t),
      (t) => (think += t),
    );
    for (const c of ['Hal', 'o <th', 'ink>ra', 'hasia</thi', 'nk> dunia <', 'b>']) s.push(c);
    s.end();
    expect(text).toBe('Halo  dunia <b>');
    expect(think).toBe('rahasia');
  });

  it('moves tool images into a user message (or drops them for text-only models)', () => {
    const history = [
      { role: 'user' as const, text: 'hi' },
      { role: 'assistant' as const, text: '', calls: [{ id: 'c1', name: 'shot', arguments: '{}' }] },
      { role: 'tool' as const, callId: 'c1', name: 'shot', ok: true, content: [{ type: 'text' as const, text: 'see' }, { type: 'image' as const, mimeType: 'image/png', data: 'AAA' }] },
    ];
    const withVision = toChatMessages('sys', history, true);
    expect(withVision.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'user']);
    expect(JSON.stringify(withVision[4])).toContain('data:image/png;base64,AAA');
    const textOnly = toChatMessages('sys', history, false);
    expect(textOnly.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(String(textOnly[3]!.content)).toContain('1 image(s) omitted');
  });
});
