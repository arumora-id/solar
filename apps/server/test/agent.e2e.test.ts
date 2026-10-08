import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Artifact, Confirmation, Task, TaskDetail } from '@solar/shared';
import type { ResponsesStreamer, ResponseStreamLike, StreamDeltaEvent, StreamParams } from '../src/agent/agent.js';
import type { AgentTool } from '../src/agent/types.js';
import { loadConfig } from '../src/config.js';
import { startServer, type RunningServer } from '../src/server.js';
import { sampleArchimate, sampleSequence, sampleTechSpec } from './fixtures.js';

type Item = Record<string, unknown>;
type Step = (input: Item[]) => { output: Item[]; status?: 'completed' | 'incomplete' };

/** A scripted "model": each turn inspects the input so far and returns the next Responses API output. */
class ScriptedModel implements ResponsesStreamer {
  readonly calls: Array<{ instructions: string; tools: string; input: string; params: StreamParams }> = [];

  constructor(private readonly script: Step[]) {}

  stream(params: StreamParams): ResponseStreamLike {
    this.calls.push({
      instructions: JSON.stringify(params.instructions),
      tools: JSON.stringify(params.tools),
      input: JSON.stringify(params.input),
      params,
    });
    const step = this.script[this.calls.length - 1];
    if (!step) throw new Error('script exhausted');
    const { output, status = 'completed' } = step(params.input as unknown as Item[]);
    const listeners: Record<string, Array<(e: StreamDeltaEvent) => void>> = {};
    return {
      on(event, listener) {
        (listeners[event] ??= []).push(listener);
        return this;
      },
      async finalResponse() {
        for (const item of output) {
          if (item.type === 'message') {
            for (const part of item.content as Item[]) listeners['response.output_text.delta']?.forEach((l) => l({ delta: String(part.text) }));
          }
          if (item.type === 'reasoning') {
            (item.summary as Item[]).forEach((part, i) =>
              listeners['response.reasoning_summary_text.delta']?.forEach((l) => l({ delta: String(part.text), item_id: String(item.id), summary_index: i })),
            );
          }
        }
        return {
          id: `resp_${Math.random()}`,
          object: 'response',
          model: 'gpt-6.1-sol-2026-09-01',
          status,
          output,
          error: null,
          incomplete_details: status === 'incomplete' ? { reason: 'max_output_tokens' } : null,
          usage: {
            input_tokens: 1500,
            input_tokens_details: { cached_tokens: 500, cache_write_tokens: 0 },
            output_tokens: 200,
            output_tokens_details: { reasoning_tokens: 120 },
            total_tokens: 1700,
          },
        } as never;
      },
    };
  }
}

const call = (id: string, name: string, args: unknown): Item => ({ type: 'function_call', id: `fc_${id}`, call_id: id, name, arguments: JSON.stringify(args), status: 'completed' });
const message = (text: string): Item => ({ type: 'message', id: `msg_${Math.random()}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] });

function outputsOf(input: Item[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const item of input) if (item.type === 'function_call_output') out.set(String(item.call_id), typeof item.output === 'string' ? item.output : JSON.stringify(item.output));
  return out;
}

const approvalTool: AgentTool = {
  name: 'test_external_write',
  displayName: 'Test external write',
  description: 'Pretends to write to an external system',
  inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
  source: 'mcp',
  pluginId: 'visual-paradigm',
  pluginName: 'Visual Paradigm',
  parse: (input) => ({ ok: true, value: input }),
  confirmation: () => 'Visual Paradigm requires your approval for every call',
  execute: async (input) => ({ content: `wrote ${(input as { value: string }).value}`, summary: 'written' }),
};

let server: RunningServer;
let model: ScriptedModel;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${server.url}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

beforeAll(async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'solar-e2e-'));
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  const config = loadConfig({
    ...process.env,
    SOLAR_ROOT: root,
    DATA_DIR: dataDir,
    PLUGINS_DEFAULT_FILE: join(dataDir, 'no-plugins.json'),
    DATABASE_URL: '',
    S3_BUCKET: '',
    GITHUB_TOKEN: '',
    PLANE_API_KEY: '',
    SOLAR_ACCESS_TOKEN: '',
  });
  // Optional: run the same scenario against Postgres/Neon (SOLAR_TEST_DATABASE_URL=postgresql://...).
  const testDb = process.env.SOLAR_TEST_DATABASE_URL;
  if (testDb) {
    const pool = new pg.Pool({ connectionString: testDb });
    await pool.query('DROP TABLE IF EXISTS solar_confirmations, solar_artifacts, solar_task_events, solar_tasks CASCADE');
    await pool.end();
  }
  config.databaseUrl = testDb || undefined;
  config.s3 = null;
  config.accessToken = undefined;
  config.github.token = undefined;
  config.plane.apiKey = undefined;

  let svgArtifactId = '';
  let truncatedOnce = false;
  model = new ScriptedModel([
    () => ({
      output: [
        { type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: 'Plan: model, sequence, spec.' }], encrypted_content: 'enc-1' },
        call('tu_1', 'update_progress', { percent: 5, step: 'Plan ready' }),
        call('tu_2', 'create_archimate_model', sampleArchimate),
      ],
    }),
    (input) => {
      const outputs = outputsOf(input);
      const archimate = outputs.get('tu_2')!;
      expect(archimate.startsWith('ERROR:')).toBe(false);
      svgArtifactId = (JSON.parse(archimate) as { views: Array<{ svgArtifactId: string }> }).views[0]!.svgArtifactId;
      // the reasoning item is carried forward verbatim (stateless, store: false)
      expect(input.some((i) => i.type === 'reasoning' && i.encrypted_content === 'enc-1')).toBe(true);
      return {
        output: [
          call('tu_3', 'create_sequence_diagram', sampleSequence),
          call('tu_4', 'test_external_write', { value: 'diagram' }),
          call('tu_5', 'create_sequence_diagram', { title: 'broken', participants: [], steps: [] }),
          { type: 'function_call', id: 'fc_tu_7', call_id: 'tu_7', name: 'list_artifacts', arguments: '{"broken', status: 'completed' },
        ],
      };
    },
    (input) => {
      const outputs = outputsOf(input);
      expect(outputs.get('tu_3')!.startsWith('ERROR:')).toBe(false);
      expect(outputs.get('tu_4')).toBe('wrote diagram');
      expect(outputs.get('tu_5')!.startsWith('ERROR:')).toBe(true);
      expect(outputs.get('tu_7')).toContain('not valid JSON');
      // first attempt is cut off by max_output_tokens: the half-written call must not run
      truncatedOnce = true;
      return { status: 'incomplete', output: [{ type: 'function_call', id: 'fc_cut', call_id: 'tu_cut', name: 'list_artifacts', arguments: '{', status: 'incomplete' }] };
    },
    (input) => {
      expect(truncatedOnce).toBe(true);
      expect(outputsOf(input).has('tu_cut')).toBe(false);
      return { output: [call('tu_6', 'create_technical_specification', sampleTechSpec(svgArtifactId))] };
    },
    (input) => {
      expect(outputsOf(input).get('tu_6')!.startsWith('ERROR:')).toBe(false);
      return { output: [message('Selesai: ArchiMate, sequence, dan TSD sudah dibuat.')] };
    },
  ]);

  server = await startServer({ config, port: 0, responses: model, extraTools: [approvalTool] });
});

afterAll(async () => {
  await server?.close();
});

describe('agent end-to-end (scripted model)', () => {
  it('runs a task in one pass, asks for approval and stores every artifact', async () => {
    const task = await api<Task>('/api/tasks', { method: 'POST', body: JSON.stringify({ prompt: 'Buat paket arsitektur Order Platform', sessionId: 's1' }) });

    // approve the confirmation as soon as it shows up
    let approved = false;
    let detail: TaskDetail | null = null;
    for (let i = 0; i < 200; i++) {
      const pending = await api<Confirmation[]>('/api/confirmations');
      if (pending.length && !approved) {
        expect(pending[0]!.pluginName).toBe('Visual Paradigm');
        const t = await api<Task>(`/api/tasks/${task.id}`).then((d) => (d as unknown as TaskDetail).task);
        expect(t.status).toBe('awaiting_confirmation');
        await api(`/api/confirmations/${pending[0]!.id}`, { method: 'POST', body: JSON.stringify({ approved: true }) });
        approved = true;
      }
      detail = await api<TaskDetail>(`/api/tasks/${task.id}`);
      if (['completed', 'failed', 'cancelled'].includes(detail.task.status)) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(approved).toBe(true);
    expect(detail!.task.status, detail!.task.error ?? '').toBe('completed');
    expect(detail!.task.progress).toBe(100);
    expect(detail!.task.result).toContain('Selesai');
    expect(detail!.task.usage.apiCalls).toBe(5);
    expect(detail!.task.usage.cacheReadTokens).toBe(2500);
    expect(detail!.task.usage.inputTokens).toBe(5000);
    expect(detail!.task.usage.costUsd).toBeGreaterThan(0);

    const kinds = detail!.artifacts.map((a: Artifact) => a.kind).sort();
    expect(kinds).toEqual(
      [
        'archimate-exchange',
        'archimate-model',
        'archimate-svg',
        'archimate-svg',
        'sequence-mermaid',
        'sequence-model',
        'sequence-plantuml',
        'sequence-svg',
        'tsd-docx',
        'tsd-html',
        'tsd-markdown',
        'tsd-model',
      ].sort(),
    );
    const names = detail!.artifacts.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
    expect(detail!.confirmations[0]!.status).toBe('approved');
    expect(detail!.events.some((e) => e.type === 'thinking')).toBe(true);

    // artifact content is served with a sandbox CSP
    const md = detail!.artifacts.find((a) => a.kind === 'tsd-markdown')!;
    const res = await fetch(`${server.url}/api/artifacts/${md.id}/content`);
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(await res.text()).toContain('TSD-ORD-001');

    // the Word delivery document: same bundle as the other TSD files, served as a .docx download
    const docx = detail!.artifacts.find((a) => a.kind === 'tsd-docx')!;
    expect(docx.name).toBe(md.name.replace(/\.md$/, '.docx'));
    expect(docx.bundle).toBe(md.bundle);
    expect(docx.title).toBe('Order Platform - Technical Specification (Word)');
    const word = await fetch(`${server.url}/api/artifacts/${docx.id}/content?download=1`);
    expect(word.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(word.headers.get('content-disposition')).toMatch(/^attachment; filename=".*\.docx"/);
    const bytes = Buffer.from(await word.arrayBuffer());
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
    expect(bytes.length).toBe(docx.size);
    // the tool reports the Word file and the UI was told about it like the other artifacts
    const toolOutput = JSON.parse(outputsOf(JSON.parse(model.calls[4]!.input) as Item[]).get('tu_6')!) as { docx: { artifactId: string; file: string } };
    expect(toolOutput.docx).toEqual({ artifactId: docx.id, file: docx.name });
    expect(detail!.events.some((e) => e.type === 'artifact' && e.artifact.id === docx.id)).toBe(true);

    // exporting the Word file again returns the one the tool made (any artifact of the bundle names it)
    const again = await fetch(`${server.url}/api/artifacts/${md.id}/docx`, { method: 'POST' });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { artifact: Artifact; created: boolean })).toMatchObject({ created: false, artifact: { id: docx.id } });
    expect((await fetch(`${server.url}/api/artifacts/art_nope/docx`, { method: 'POST' })).status).toBe(404);
    const svg = detail!.artifacts.find((a) => a.kind === 'archimate-svg')!;
    const notTsd = await fetch(`${server.url}/api/artifacts/${svg.id}/docx`, { method: 'POST' });
    expect(notTsd.status).toBe(400);
    expect(((await notTsd.json()) as { error: string }).error).toMatch(/not part of a Technical Specification Document/);
    expect((await api<TaskDetail>(`/api/tasks/${task.id}`)).artifacts.filter((a) => a.kind === 'tsd-docx')).toHaveLength(1);

    const zip = await fetch(`${server.url}/api/tasks/${task.id}/artifacts.zip`);
    expect(zip.headers.get('content-type')).toBe('application/zip');
    expect((await zip.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });

  it('keeps the input append-only with frozen instructions and tool list', () => {
    expect(model.calls).toHaveLength(5);
    for (let i = 1; i < model.calls.length; i++) {
      expect(model.calls[i]!.instructions).toBe(model.calls[0]!.instructions);
      expect(model.calls[i]!.tools).toBe(model.calls[0]!.tools);
      const prev = JSON.parse(model.calls[i - 1]!.input) as unknown[];
      const next = JSON.parse(model.calls[i]!.input) as unknown[];
      // the truncated turn (call 3) is retried, not appended
      if (i === 3) expect(next).toEqual(prev);
      else expect(next.slice(0, prev.length)).toEqual(prev);
    }
  });

  it('sends stateless reasoning requests with a larger budget after truncation', () => {
    const first = model.calls[0]!.params;
    expect(first.model).toBe('gpt-6.1-sol');
    expect(first.store).toBe(false);
    expect(first.include).toEqual(['reasoning.encrypted_content']);
    expect(first.reasoning).toEqual({ effort: 'high', summary: 'auto' });
    expect(first.parallel_tool_calls).toBe(true);
    expect(first.max_output_tokens).toBe(64000);
    expect(model.calls[3]!.params.max_output_tokens).toBe(128000);
    const tools = first.tools as Array<{ type: string; name: string; strict: boolean; parameters: { type: string } }>;
    expect(tools.every((t) => t.type === 'function' && t.strict === false && t.parameters.type === 'object')).toBe(true);
    expect(tools.map((t) => t.name)).toContain('create_archimate_model');
  });

  it('exposes stats and supports cancelling unknown tasks with 409', async () => {
    const stats = await api<{ total: number; byStatus: Record<string, number> }>('/api/tasks/stats');
    expect(stats.total).toBe(1);
    expect(stats.byStatus.completed).toBe(1);
    const res = await fetch(`${server.url}/api/tasks/task_nope/cancel`, { method: 'POST' });
    expect(res.status).toBe(409);
  });
});
