import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Artifact, Confirmation, Task, TaskDetail } from '@solar/shared';
import type { MessagesStreamer, MessageStreamLike } from '../src/agent/agent.js';
import type { AgentTool } from '../src/agent/types.js';
import { loadConfig } from '../src/config.js';
import { startServer, type RunningServer } from '../src/server.js';
import { sampleArchimate, sampleSequence, sampleTechSpec } from './fixtures.js';

type Block = Record<string, unknown>;

/** A scripted "model": each turn inspects the conversation so far and returns the next message. */
class ScriptedModel implements MessagesStreamer {
  readonly calls: Array<{ system: string; tools: string; messages: string }> = [];

  constructor(private readonly script: Array<(messages: Array<{ role: string; content: unknown }>) => { content: Block[]; stop: string }>) {}

  stream(params: Parameters<MessagesStreamer['stream']>[0]): MessageStreamLike {
    this.calls.push({
      system: JSON.stringify(params.system),
      tools: JSON.stringify(params.tools),
      messages: JSON.stringify(params.messages),
    });
    const step = this.script[this.calls.length - 1];
    if (!step) throw new Error('script exhausted');
    const { content, stop } = step(params.messages as Array<{ role: string; content: unknown }>);
    const listeners: Record<string, Array<(d: string) => void>> = {};
    return {
      on(event, listener) {
        (listeners[event] ??= []).push(listener);
        return this;
      },
      async finalMessage() {
        for (const b of content) if (b.type === 'text') listeners.text?.forEach((l) => l(String(b.text)));
        return {
          id: `msg_${Math.random()}`,
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content,
          stop_reason: stop,
          stop_sequence: null,
          stop_details: null,
          usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500, cache_creation_input_tokens: 100 },
        } as never;
      },
    };
  }
}

function lastToolResults(messages: Array<{ role: string; content: unknown }>): Array<{ tool_use_id: string; content: unknown; is_error?: boolean }> {
  const last = messages[messages.length - 1]!;
  return (last.content as Array<{ type: string; tool_use_id: string; content: unknown; is_error?: boolean }>).filter((b) => b.type === 'tool_result');
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
  model = new ScriptedModel([
    () => ({
      stop: 'tool_use',
      content: [
        { type: 'thinking', thinking: 'Plan: model, sequence, spec.', signature: 'sig' },
        { type: 'tool_use', id: 'tu_1', name: 'update_progress', input: { percent: 5, step: 'Plan ready' } },
        { type: 'tool_use', id: 'tu_2', name: 'create_archimate_model', input: sampleArchimate },
      ],
    }),
    (messages) => {
      const results = lastToolResults(messages);
      const archimate = results.find((r) => r.tool_use_id === 'tu_2')!;
      expect(archimate.is_error).toBeFalsy();
      svgArtifactId = (JSON.parse(String(archimate.content)) as { views: Array<{ svgArtifactId: string }> }).views[0]!.svgArtifactId;
      return {
        stop: 'tool_use',
        content: [
          { type: 'tool_use', id: 'tu_3', name: 'create_sequence_diagram', input: sampleSequence },
          { type: 'tool_use', id: 'tu_4', name: 'test_external_write', input: { value: 'diagram' } },
          { type: 'tool_use', id: 'tu_5', name: 'create_sequence_diagram', input: { title: 'broken', participants: [], steps: [] } },
        ],
      };
    },
    (messages) => {
      const results = lastToolResults(messages);
      expect(results.find((r) => r.tool_use_id === 'tu_3')!.is_error).toBeFalsy();
      expect(String(results.find((r) => r.tool_use_id === 'tu_4')!.content)).toBe('wrote diagram');
      expect(results.find((r) => r.tool_use_id === 'tu_5')!.is_error).toBe(true);
      return {
        stop: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu_6', name: 'create_technical_specification', input: sampleTechSpec(svgArtifactId) }],
      };
    },
    (messages) => {
      const results = lastToolResults(messages);
      expect(results[0]!.is_error).toBeFalsy();
      return { stop: 'end_turn', content: [{ type: 'text', text: 'Selesai: ArchiMate, sequence, dan TSD sudah dibuat.' }] };
    },
  ]);

  server = await startServer({ config, port: 0, messages: model, extraTools: [approvalTool] });
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
    expect(detail!.task.usage.apiCalls).toBe(4);
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

    const zip = await fetch(`${server.url}/api/tasks/${task.id}/artifacts.zip`);
    expect(zip.headers.get('content-type')).toBe('application/zip');
    expect((await zip.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });

  it('keeps the conversation append-only with a frozen system prompt and tool list', () => {
    expect(model.calls).toHaveLength(4);
    for (let i = 1; i < model.calls.length; i++) {
      expect(model.calls[i]!.system).toBe(model.calls[0]!.system);
      expect(model.calls[i]!.tools).toBe(model.calls[0]!.tools);
      const prev = JSON.parse(model.calls[i - 1]!.messages) as unknown[];
      const next = JSON.parse(model.calls[i]!.messages) as unknown[];
      expect(next.slice(0, prev.length)).toEqual(prev);
    }
  });

  it('exposes stats and supports cancelling unknown tasks with 409', async () => {
    const stats = await api<{ total: number; byStatus: Record<string, number> }>('/api/tasks/stats');
    expect(stats.total).toBe(1);
    expect(stats.byStatus.completed).toBe(1);
    const res = await fetch(`${server.url}/api/tasks/task_nope/cancel`, { method: 'POST' });
    expect(res.status).toBe(409);
  });
});
