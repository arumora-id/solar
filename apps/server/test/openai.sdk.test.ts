import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Task, TaskDetail } from '@solar/shared';
import { toFunctionOutput } from '../src/agent/agent.js';
import { capabilitiesOf, estimateCostUsd } from '../src/agent/models.js';
import { loadConfig } from '../src/config.js';
import { startServer, type RunningServer } from '../src/server.js';

/**
 * Runs SOLAR with the real OpenAI SDK against a local fake of the Responses API (SSE streaming),
 * so the request format, event handling and error mapping are exercised without an API key.
 */

type Json = Record<string, unknown>;

interface Recorded {
  auth: string | undefined;
  body: Json;
}

const requests: Recorded[] = [];
let mode: 'ok' | 'unauthorized' | 'quota' = 'ok';

function baseResponse(id: string, status: string, output: Json[]): Json {
  return {
    id,
    object: 'response',
    created_at: 1_760_000_000,
    model: 'gpt-6.1-sol-2026-09-01',
    status,
    output,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: {},
    parallel_tool_calls: true,
    temperature: null,
    tool_choice: 'auto',
    tools: [],
    top_p: null,
    usage: {
      input_tokens: 2000,
      input_tokens_details: { cached_tokens: 1000, cache_write_tokens: 0 },
      output_tokens: 300,
      output_tokens_details: { reasoning_tokens: 100 },
      total_tokens: 2300,
    },
  };
}

/** Emits the item lifecycle events the SDK accumulates, then `response.completed`. */
function sse(res: ServerResponse, id: string, items: Json[]): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  let seq = 0;
  const send = (event: Json) => res.write(`event: ${String(event.type)}\ndata: ${JSON.stringify({ ...event, sequence_number: seq++ })}\n\n`);
  send({ type: 'response.created', response: baseResponse(id, 'in_progress', []) });
  items.forEach((item, index) => {
    if (item.type === 'reasoning') {
      send({ type: 'response.output_item.added', output_index: index, item: { ...item, summary: [] } });
      (item.summary as Json[]).forEach((part, s) => {
        send({ type: 'response.reasoning_summary_part.added', item_id: item.id, output_index: index, summary_index: s, part: { type: 'summary_text', text: '' } });
        send({ type: 'response.reasoning_summary_text.delta', item_id: item.id, output_index: index, summary_index: s, delta: part.text });
        send({ type: 'response.reasoning_summary_text.done', item_id: item.id, output_index: index, summary_index: s, text: part.text });
        send({ type: 'response.reasoning_summary_part.done', item_id: item.id, output_index: index, summary_index: s, part });
      });
    } else if (item.type === 'message') {
      const text = String((item.content as Json[])[0]!.text);
      send({ type: 'response.output_item.added', output_index: index, item: { ...item, content: [], status: 'in_progress' } });
      send({ type: 'response.content_part.added', item_id: item.id, output_index: index, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
      for (const chunk of [text.slice(0, 5), text.slice(5)]) {
        send({ type: 'response.output_text.delta', item_id: item.id, output_index: index, content_index: 0, delta: chunk, logprobs: [] });
      }
      send({ type: 'response.output_text.done', item_id: item.id, output_index: index, content_index: 0, text, logprobs: [] });
      send({ type: 'response.content_part.done', item_id: item.id, output_index: index, content_index: 0, part: { type: 'output_text', text, annotations: [] } });
    } else {
      send({ type: 'response.output_item.added', output_index: index, item: { ...item, arguments: '', status: 'in_progress' } });
      send({ type: 'response.function_call_arguments.delta', item_id: item.id, output_index: index, delta: item.arguments });
      send({ type: 'response.function_call_arguments.done', item_id: item.id, output_index: index, arguments: item.arguments });
    }
    send({ type: 'response.output_item.done', output_index: index, item });
  });
  send({ type: 'response.completed', response: baseResponse(id, 'completed', items) });
  res.end();
}

function handle(req: IncomingMessage, res: ServerResponse, raw: string): void {
  if (req.method !== 'POST' || req.url !== '/v1/responses') {
    res.writeHead(404).end();
    return;
  }
  const body = JSON.parse(raw) as Json;
  requests.push({ auth: req.headers.authorization, body });
  if (mode === 'unauthorized') {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Incorrect API key provided', type: 'invalid_request_error', code: 'invalid_api_key' } }));
    return;
  }
  if (mode === 'quota') {
    res.writeHead(429, { 'Content-Type': 'application/json', 'x-should-retry': 'false' });
    res.end(JSON.stringify({ error: { message: 'You exceeded your current quota', type: 'insufficient_quota', code: 'insufficient_quota' } }));
    return;
  }
  const input = body.input as Json[];
  const answered = input.some((i) => i.type === 'function_call_output');
  if (!answered) {
    sse(res, 'resp_1', [
      { type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: 'Need progress first.' }], encrypted_content: 'gAAAA-encrypted' },
      { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'update_progress', arguments: JSON.stringify({ percent: 40, step: 'Analisis' }), status: 'completed' },
    ]);
  } else {
    sse(res, 'resp_2', [
      { type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Halo dari OpenAI.', annotations: [] }] },
    ]);
  }
}

let fake: Server;
let solar: RunningServer;

async function waitForTask(id: string): Promise<TaskDetail> {
  for (let i = 0; i < 200; i++) {
    const detail = (await (await fetch(`${solar.url}/api/tasks/${id}`)).json()) as TaskDetail;
    if (['completed', 'failed', 'cancelled'].includes(detail.task.status)) return detail;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('task did not finish');
}

async function runTask(prompt: string): Promise<TaskDetail> {
  const res = await fetch(`${solar.url}/api/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, sessionId: 'sdk-test' }) });
  if (!res.ok) throw new Error(`POST /api/tasks: ${res.status} ${await res.text()}`);
  return waitForTask(((await res.json()) as Task).id);
}

beforeAll(async () => {
  fake = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString('utf8')));
    req.on('end', () => handle(req, res, raw));
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  const port = (fake.address() as AddressInfo).port;

  const dataDir = mkdtempSync(join(tmpdir(), 'solar-openai-'));
  const config = loadConfig({
    ...process.env,
    SOLAR_ROOT: fileURLToPath(new URL('../../..', import.meta.url)),
    DATA_DIR: dataDir,
    PLUGINS_DEFAULT_FILE: join(dataDir, 'no-plugins.json'),
    OPENAI_API_KEY: 'sk-test-solar',
    OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
    SOLAR_MODEL: 'gpt-6.1-sol',
    SOLAR_EFFORT: 'medium',
  });
  config.databaseUrl = undefined;
  config.s3 = null;
  config.accessToken = undefined;
  config.github.token = undefined;
  config.plane.apiKey = undefined;
  solar = await startServer({ config, port: 0 });
});

afterAll(async () => {
  await solar?.close();
  await new Promise<void>((resolve) => fake.close(() => resolve()));
});

describe('OpenAI Responses API through the real SDK (local fake server)', () => {
  it('streams, runs tool calls and carries encrypted reasoning forward', async () => {
    mode = 'ok';
    requests.length = 0;
    const detail = await runTask('Tes koneksi OpenAI');
    expect(detail.task.status, detail.task.error ?? '').toBe('completed');
    expect(detail.task.result).toBe('Halo dari OpenAI.');
    expect(detail.task.usage.apiCalls).toBe(2);
    expect(detail.task.usage.cacheReadTokens).toBe(2000);
    expect(detail.task.usage.inputTokens).toBe(2000);
    expect(detail.task.usage.costUsd).toBeGreaterThan(0);
    expect(detail.events.some((e) => e.type === 'thinking' && e.text === 'Need progress first.')).toBe(true);
    expect(detail.events.some((e) => e.type === 'tool_result' && e.tool === 'update_progress' && e.ok)).toBe(true);

    expect(requests).toHaveLength(2);
    const [first, second] = requests as [Recorded, Recorded];
    expect(first.auth).toBe('Bearer sk-test-solar');
    expect(first.body).toMatchObject({
      model: 'gpt-6.1-sol',
      stream: true,
      store: false,
      include: ['reasoning.encrypted_content'],
      reasoning: { effort: 'medium', summary: 'auto' },
      parallel_tool_calls: true,
      tool_choice: 'auto',
      prompt_cache_key: 'solar-agent',
    });
    expect(typeof first.body.instructions).toBe('string');
    expect(second.body.instructions).toBe(first.body.instructions);
    expect(second.body.tools).toEqual(first.body.tools);

    const input = second.body.input as Json[];
    expect(input[0]).toMatchObject({ type: 'message', role: 'user' });
    expect(input.find((i) => i.type === 'reasoning')).toMatchObject({ id: 'rs_1', encrypted_content: 'gAAAA-encrypted' });
    expect(input.find((i) => i.type === 'function_call')).toMatchObject({ call_id: 'call_1', name: 'update_progress' });
    const output = input.find((i) => i.type === 'function_call_output');
    expect(output).toMatchObject({ call_id: 'call_1' });
    expect(String(output!.output)).not.toMatch(/^ERROR:/);
  });

  it('explains an invalid API key in Indonesian', async () => {
    mode = 'unauthorized';
    const detail = await runTask('Tes key salah');
    expect(detail.task.status).toBe('failed');
    expect(detail.task.error).toContain('OPENAI_API_KEY');
  });

  it('explains insufficient_quota (no API credit on the account)', async () => {
    mode = 'quota';
    const detail = await runTask('Tes kuota');
    expect(detail.task.status).toBe('failed');
    expect(detail.task.error).toContain('insufficient_quota');
    expect(detail.task.error).toContain('ChatGPT Plus');
  });
});

describe('model helpers', () => {
  it('knows which models reason and how much they may output', () => {
    expect(capabilitiesOf('gpt-6.1-sol')).toEqual({ reasoning: true, maxOutputTokens: 128_000 });
    expect(capabilitiesOf('o4-mini')).toEqual({ reasoning: true, maxOutputTokens: 100_000 });
    expect(capabilitiesOf('gpt-4.1')).toEqual({ reasoning: false, maxOutputTokens: 32_768 });
    expect(capabilitiesOf('gpt-5.3-chat-latest').reasoning).toBe(false);
  });

  it('estimates cost with cached input and the long-context surcharge', () => {
    const usage = { inputTokens: 100_000, outputTokens: 100_000, cacheReadTokens: 100_000, cacheWriteTokens: 0 };
    expect(estimateCostUsd('gpt-6.1-sol', usage)).toBeCloseTo(0.2 + 1 + 0.01);
    expect(estimateCostUsd('gpt-6.1-sol-2026-09-01', usage)).toBeCloseTo(1.21);
    // above 272K input tokens: 2x input, 1.5x output for the whole request
    expect(estimateCostUsd('gpt-6.1-sol', { inputTokens: 300_000, outputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeCloseTo(1.2 + 1.5);
    expect(estimateCostUsd('anything', usage, { input: 1, cachedInput: 0, output: 1 })).toBeCloseTo(0.2);
  });

  it('converts tool results to function_call_output content', () => {
    expect(toFunctionOutput('', true)).toBe('(empty result)');
    expect(toFunctionOutput('boom', false)).toBe('ERROR: boom');
    expect(toFunctionOutput([{ type: 'text', text: 'a' }, { type: 'image', mimeType: 'image/png', data: 'AAAA' }], true)).toEqual([
      { type: 'input_text', text: 'a' },
      { type: 'input_image', image_url: 'data:image/png;base64,AAAA', detail: 'auto' },
    ]);
  });
});
