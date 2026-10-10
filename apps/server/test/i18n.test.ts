import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Artifact, Attachment, Confirmation, Language, Task, TaskDetail, TaskEvent } from '@solar/shared';
import type { ResponsesStreamer, ResponseStreamLike, StreamDeltaEvent, StreamParams } from '../src/agent/agent.js';
import { createBuiltinTools } from '../src/agent/builtinTools.js';
import { createMcpTools } from '../src/agent/mcpTools.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { both, errorMessage, langOfAcceptLanguage, localize, LocalizedError, messageEntry, messageKeys, requestLanguage, t } from '../src/i18n.js';
import type { McpManager } from '../src/plugins/mcpManager.js';
import { startServer, type RunningServer } from '../src/server.js';
import type { ArtifactService, NewArtifact } from '../src/tasks/artifactService.js';
import type { TaskRunContext } from '../src/tasks/taskManager.js';
import { sampleTechSpec } from './fixtures.js';

// ---- the message catalog ------------------------------------------------------------------------------------------

describe('server messages', () => {
  it('have the same placeholders in both languages', () => {
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of messageKeys()) {
      const { id, en } = messageEntry(key);
      if (typeof id === 'string' && typeof en === 'string') expect(placeholders(en), key).toEqual(placeholders(id));
      expect(typeof id === 'string' ? id.trim() : 'fn', key).not.toBe('');
      expect(typeof en === 'string' ? en.trim() : 'fn', key).not.toBe('');
    }
  });

  it('fill placeholders and English plurals', () => {
    expect(t('id', 'task.step.awaitingApproval', { tool: 'Simpan knowledge' })).toBe('Menunggu persetujuan: Simpan knowledge');
    expect(t('en', 'task.step.awaitingApproval', { tool: 'Saving knowledge' })).toBe('Waiting for approval: Saving knowledge');
    expect(t('en', 'confirm.github', { n: 1, target: 'acme/docs/arch' })).toBe('Commit 1 file to acme/docs/arch');
    expect(t('en', 'confirm.github', { n: 3, target: 'acme/docs/arch' })).toBe('Commit 3 files to acme/docs/arch');
    expect(t('id', 'confirm.github', { n: 3, target: 'acme/docs/arch' })).toBe('Commit 3 file ke acme/docs/arch');
    // an unknown language falls back to Indonesian
    expect(t('fr' as Language, 'task.step.completed')).toBe('Selesai');
  });

  it('pick the language of a request: X-Solar-Language, then ?lang=, then Accept-Language, else Indonesian', () => {
    expect(requestLanguage({})).toBe('id');
    expect(requestLanguage({ 'x-solar-language': 'en' })).toBe('en');
    expect(requestLanguage({ 'x-solar-language': 'en', 'accept-language': 'id-ID' })).toBe('en');
    expect(requestLanguage({ 'x-solar-language': 'xx', 'accept-language': 'en-GB,en;q=0.9' })).toBe('en');
    expect(requestLanguage({ 'accept-language': 'id' }, { lang: 'en' })).toBe('en');
    expect(requestLanguage({ 'accept-language': 'ms-MY' })).toBe('id');
    expect(requestLanguage({ 'accept-language': '*' })).toBe('id');
    expect(langOfAcceptLanguage('de-DE,de;q=0.9,en;q=0.5')).toBe('en');
    expect(langOfAcceptLanguage('en;q=0.4, id;q=0.8')).toBe('id');
    expect(langOfAcceptLanguage('de-DE, fr')).toBeNull();
  });
});

// ---- user-visible text of the tools -------------------------------------------------------------------------------

describe('tools in the language of the task', () => {
  const config = loadConfig({
    ...process.env,
    DATA_DIR: mkdtempSync(join(tmpdir(), 'solar-i18n-tools-')),
    DATABASE_URL: '',
    S3_BUCKET: '',
    GITHUB_TOKEN: 'ghp_test',
    GITHUB_DEFAULT_REPO: 'acme/architecture',
    PLANE_API_KEY: 'plane_test',
    PLANE_WORKSPACE_SLUG: 'acme',
    PLANE_PROJECT_ID: 'proj-1',
    GITHUB_PUBLISH_CONFIRM: 'always',
    PLANE_CONFIRM: 'always',
  });
  const tools = createBuiltinTools({ config, skills: {} as never, artifacts: {} as never, attachments: {} as never });
  const tool = (name: string) => tools.find((x) => x.name === name)!;

  it('name themselves in both languages', () => {
    expect(localize(tool('create_archimate_model').displayName, 'id')).toBe('Membuat model ArchiMate');
    expect(localize(tool('create_archimate_model').displayName, 'en')).toBe('Creating ArchiMate model');
    expect(localize(tool('publish_artifacts_to_github').displayName, 'en')).toBe('Publishing to GitHub');
    for (const x of tools) expect(typeof x.displayName === 'object' && x.displayName.en && x.displayName.id, x.name).toBeTruthy();
  });

  it('ask for approval in the language of the task (GitHub, Plane, MCP plugins)', async () => {
    const github = tool('publish_artifacts_to_github');
    const commit = github.parse({ path: 'docs/order', artifact_ids: ['art_a', 'art_b'], commit_message: 'Add docs' });
    if (!commit.ok) throw new Error(commit.error);
    expect(await github.confirmation(commit.value, 'en')).toBe('Commit 2 files to acme/architecture/docs/order');
    expect(await github.confirmation(commit.value, 'id')).toBe('Commit 2 file ke acme/architecture/docs/order');
    // without a language (older callers) the reason is Indonesian
    expect(await github.confirmation(commit.value)).toBe('Commit 2 file ke acme/architecture/docs/order');

    const plane = tool('plane_create_backlog_items');
    const items = plane.parse({ items: [{ ref: 'FR-01', name: 'Create order' }] });
    if (!items.ok) throw new Error(items.error);
    expect(await plane.confirmation(items.value, 'en')).toBe('Create 1 work item in the Plane project proj-1');
    expect(await plane.confirmation(items.value, 'id')).toBe('Membuat 1 work item di project Plane proj-1');

    const mcp = {
      bindings: () => [
        {
          qualifiedName: 'mcp__vp__create_diagram',
          plugin: { id: 'vp', name: 'Visual Paradigm', confirm: 'writes' },
          tool: { name: 'create_diagram', inputSchema: { type: 'object' } },
        },
      ],
    } as unknown as McpManager;
    const [mcpTool] = createMcpTools(mcp);
    // an MCP tool keeps the name its plugin gives it, in both languages
    expect(mcpTool!.displayName).toBe('Visual Paradigm: create_diagram');
    expect(await mcpTool!.confirmation({}, 'en')).toBe('create_diagram can change data in Visual Paradigm');
    expect(await mcpTool!.confirmation({}, 'id')).toBe('create_diagram dapat mengubah data di Visual Paradigm');
  });

  it('write the TSD in the language the agent sets, else in the task language', async () => {
    const stored: Array<Omit<NewArtifact, 'taskId'>> = [];
    const ctx = (language: Language) =>
      ({
        task: { id: 'task_1', language, progress: 0 },
        listArtifacts: async () => [],
        createArtifact: async (input: Omit<NewArtifact, 'taskId'>) => {
          stored.push(input);
          return { ...input, id: `art_${stored.length}`, taskId: 'task_1', size: 1, storageKey: 'k', description: input.description ?? null, createdAt: '' } as Artifact;
        },
      }) as unknown as TaskRunContext;
    const tsd = createBuiltinTools({ config: { github: {}, plane: {} } as AppConfig, skills: {} as never, artifacts: {} as ArtifactService, attachments: {} as never }).find(
      (x) => x.name === 'create_technical_specification',
    )!;
    const spec = { ...sampleTechSpec('unused'), language: 'id', architecture: { overview: 'Service based.', diagrams: [] } };
    const languageOf = () => (JSON.parse(String(stored.find((a) => a.kind === 'tsd-model')!.content)) as { language: string }).language;

    const explicit = tsd.parse(spec);
    if (!explicit.ok) throw new Error(explicit.error);
    expect((await tsd.execute(explicit.value, ctx('en'))).isError).toBeFalsy();
    expect(languageOf()).toBe('id');
    // the file descriptions follow the task, the document follows its own language
    expect(stored.find((a) => a.kind === 'tsd-markdown')!.description).toBe('1 functional / 1 non-functional requirements');

    stored.length = 0;
    const { language: _omitted, ...withoutLanguage } = spec;
    const implicit = tsd.parse(withoutLanguage);
    if (!implicit.ok) throw new Error(implicit.error);
    expect((await tsd.execute(implicit.value, ctx('en'))).isError).toBeFalsy();
    expect(languageOf()).toBe('en');
    expect(String(stored.find((a) => a.kind === 'tsd-markdown')!.content)).toContain('Executive Summary');
  }, 60_000);

  it('show errors that carry both languages in the language asked', () => {
    const err = new LocalizedError(both('api.taskNotFound'));
    expect(err.message).toBe('Task tidak ditemukan');
    expect(errorMessage(err, 'en')).toBe('Task not found');
    expect(errorMessage(new Error('plain'), 'en')).toBe('plain');
  });
});

// ---- end to end: tasks, approvals and API answers -------------------------------------------------------------------

type Item = Record<string, unknown>;

/** A scripted "model" that answers each turn from what the conversation already holds (tasks run one after another). */
class ScriptedModel implements ResponsesStreamer {
  /** The first user message of each task (its <task_context>). */
  readonly intros: string[] = [];

  stream(params: StreamParams): ResponseStreamLike {
    const input = params.input as unknown as Item[];
    const text = JSON.stringify(input);
    const done = new Set(input.filter((i) => i.type === 'function_call_output').map((i) => String(i.call_id)));
    const tag = /Task id: (task_[A-Za-z0-9]+)/.exec(text)?.[1] ?? 'task';
    let output: Item[];
    if (done.size === 0) {
      this.intros.push(text);
      output = [
        call(`k_${tag}`, 'save_knowledge', { type: 'standard', path: `standards/naming-${tag}.md`, title: 'Naming rules', content: '# Naming\n\nComponents are nouns.' }),
      ];
    } else if (!done.has(`tsd_${tag}`)) {
      const { language: _language, ...spec } = sampleTechSpec('unused');
      output = [call(`tsd_${tag}`, 'create_technical_specification', { ...spec, architecture: { overview: 'Service based.', diagrams: [] } })];
    } else {
      output = [{ type: 'message', id: `msg_${tag}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'OK', annotations: [] }] }];
    }
    const listeners: Record<string, Array<(e: StreamDeltaEvent) => void>> = {};
    return {
      on(event, listener) {
        (listeners[event] ??= []).push(listener);
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
          usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens: 5, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 15 },
        } as never;
      },
    };
  }
}

const call = (id: string, name: string, args: unknown): Item => ({ type: 'function_call', id: `fc_${id}`, call_id: id, name, arguments: JSON.stringify(args), status: 'completed' });

let server: RunningServer;
const model = new ScriptedModel();

async function api<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${server.url}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

/** Creates a task, checks its approval while it waits, approves it and returns the finished task. */
async function runTask(language: Language | undefined) {
  const created = await api<Task>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ prompt: 'Write the TSD', sessionId: `s-${language ?? 'none'}`, ...(language ? { language } : {}) }),
  });
  expect(created.status).toBe(201);
  let waiting: { confirmation: Confirmation; step: string | null } | null = null;
  let detail: TaskDetail | null = null;
  for (let i = 0; i < 400; i++) {
    const pending = (await api<Confirmation[]>('/api/confirmations')).body.filter((c) => c.taskId === created.body.id);
    if (pending.length && !waiting) {
      const task = (await api<TaskDetail>(`/api/tasks/${created.body.id}`)).body.task;
      waiting = { confirmation: pending[0]!, step: task.currentStep };
      await api(`/api/confirmations/${pending[0]!.id}`, { method: 'POST', body: JSON.stringify({ approved: true }) });
    }
    detail = (await api<TaskDetail>(`/api/tasks/${created.body.id}`)).body;
    if (['completed', 'failed', 'cancelled'].includes(detail.task.status)) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  expect(detail!.task.status, detail!.task.error ?? '').toBe('completed');
  expect(waiting).not.toBeNull();
  const tsdModel = detail!.artifacts.find((a) => a.kind === 'tsd-model')!;
  const tsdLanguage = (JSON.parse(await (await fetch(`${server.url}/api/artifacts/${tsdModel.id}/content`)).text()) as { language: string }).language;
  return { created: created.body, detail: detail!, waiting: waiting!, tsdLanguage, intro: model.intros.find((x) => x.includes(created.body.id)) ?? '' };
}

const statusMessages = (events: TaskEvent[]) => events.flatMap((e) => (e.type === 'status' && e.message ? [e.message] : []));
const toolCalls = (events: TaskEvent[]) => events.flatMap((e) => (e.type === 'tool_call' ? [e.displayName] : []));
const toolSummaries = (events: TaskEvent[]) => events.flatMap((e) => (e.type === 'tool_result' ? [e.summary] : []));

beforeAll(async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'solar-i18n-'));
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
    KNOWLEDGE_DIR: '',
  });
  config.databaseUrl = undefined;
  config.s3 = null;
  config.accessToken = undefined;
  config.github.token = undefined;
  config.plane.apiKey = undefined;
  server = await startServer({ config, port: 0, responses: model });
});

afterAll(async () => {
  await server?.close();
});

describe('a task in English', () => {
  it('writes its steps, status messages, approval and tool names in English, and the TSD too', async () => {
    const { created, detail, waiting, tsdLanguage, intro } = await runTask('en');
    expect(created.language).toBe('en');
    expect(created.currentStep).toBe('Waiting in the queue');
    expect(intro).toContain('Interface language: English');

    expect(waiting.step).toBe('Waiting for approval: Saving knowledge');
    expect(waiting.confirmation.displayName).toBe('Saving knowledge');
    expect(waiting.confirmation.reason).toMatch(/^Save standard "Naming rules" to the knowledge base: standards\/naming-task_\w+\.md\. From the next task on/);

    expect(detail.task.language).toBe('en');
    expect(detail.task.currentStep).toBe('Done');
    expect(statusMessages(detail.events)).toEqual(expect.arrayContaining(['Task created', 'The agent started working', waiting.confirmation.reason]));
    expect(toolCalls(detail.events)).toEqual(['Saving knowledge', 'Writing the Technical Specification']);
    expect(toolSummaries(detail.events)[0]).toMatch(/^saved: standards\/naming-/);
    expect(tsdLanguage).toBe('en');
    expect(detail.artifacts.find((a) => a.kind === 'tsd-markdown')!.description).toBe('1 functional / 1 non-functional requirements');
  }, 60_000);

  it('stays Indonesian for a task created without a language (older clients)', async () => {
    const { created, detail, waiting, tsdLanguage, intro } = await runTask(undefined);
    expect(created.language).toBe('id');
    expect(created.currentStep).toBe('Menunggu antrean');
    expect(intro).toContain('Interface language: Bahasa Indonesia');
    expect(waiting.step).toBe('Menunggu persetujuan: Simpan knowledge');
    expect(waiting.confirmation.reason).toMatch(/^Menyimpan standard "Naming rules" ke knowledge base: /);
    expect(detail.task.currentStep).toBe('Selesai');
    expect(statusMessages(detail.events)).toEqual(expect.arrayContaining(['Task dibuat', 'Agent mulai bekerja']));
    expect(toolCalls(detail.events)).toEqual(['Simpan knowledge', 'Menyusun Technical Specification']);
    expect(tsdLanguage).toBe('id');
  }, 60_000);

  it('rejects a language it does not know', async () => {
    const res = await api<{ error: string }>('/api/tasks', { method: 'POST', body: JSON.stringify({ prompt: 'x', sessionId: 's', language: 'fr' }) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^language: /);
  });
});

describe('API answers in the language of the request', () => {
  it('route errors: X-Solar-Language, Accept-Language, Indonesian by default', async () => {
    expect((await api<{ error: string }>('/api/tasks/task_nope', { headers: { 'X-Solar-Language': 'en' } })).body.error).toBe('Task not found');
    expect((await api<{ error: string }>('/api/tasks/task_nope', { headers: { 'Accept-Language': 'en-US,en;q=0.9' } })).body.error).toBe('Task not found');
    expect((await api<{ error: string }>('/api/tasks/task_nope')).body.error).toBe('Task tidak ditemukan');
    const cancel = await api<{ error: string }>('/api/tasks/task_nope/cancel', { method: 'POST', headers: { 'X-Solar-Language': 'en' } });
    expect(cancel).toEqual({ status: 409, body: { error: 'Task is not queued or running' } });
  });

  it('validation errors keep the field path and translate the message', async () => {
    const en = await api<{ error: string }>('/api/tasks', { method: 'POST', body: JSON.stringify({ sessionId: 's' }), headers: { 'X-Solar-Language': 'en' } });
    expect(en.status).toBe(400);
    expect(en.body.error).toMatch(/^prompt: Invalid input/);
    const id = await api<{ error: string }>('/api/tasks', { method: 'POST', body: JSON.stringify({ sessionId: 's' }) });
    expect(id.body.error).toBe('prompt: wajib diisi');
    const empty = await api<{ error: string }>('/api/tasks', { method: 'POST', body: JSON.stringify({ prompt: ' ', sessionId: 's' }) });
    expect(empty.body.error).toBe('prompt: tidak boleh kosong');
    const broken = await api<{ error: string }>('/api/tasks', { method: 'POST', body: '{"prompt":', headers: { 'X-Solar-Language': 'en' } });
    expect(broken).toEqual({ status: 400, body: { error: 'The request body is not valid JSON' } });
  });

  it('upload errors and document warnings, which the attachment keeps in the upload language', async () => {
    const upload = (name: string, body: string, language: Language) =>
      fetch(`${server.url}/api/attachments?sessionId=s-up&name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Solar-Language': language },
        body,
      });
    const legacy = await upload('old.doc', 'x', 'en');
    expect(legacy.status).toBe(415);
    expect(((await legacy.json()) as { error: string }).error).toMatch(/^The Word 97-2003 \(\.doc\) format is not supported yet\. Save it again as \.docx/);
    const legacyId = await upload('old.doc', 'x', 'id');
    expect(((await legacyId.json()) as { error: string }).error).toMatch(/^Format Word 97-2003 \(\.doc\) belum didukung\. Simpan ulang sebagai \.docx/);

    const wide = `${Array.from({ length: 70 }, (_, i) => `c${i}`).join(',')}\n${Array.from({ length: 70 }, (_, i) => i).join(',')}\n`;
    const en = (await (await upload('wide.csv', wide, 'en')).json()) as Attachment;
    expect(en.warnings).toContain('The CSV has 70 columns; only the first 60 columns were read.');
    const id = (await (await upload('wide.csv', wide, 'id')).json()) as Attachment;
    expect(id.warnings).toContain('CSV berisi 70 kolom; hanya 60 kolom pertama yang dibaca.');
    // read back in another language: the stored warnings stay as they were written
    const again = await api<Attachment>(`/api/attachments/${en.id}`, { headers: { 'X-Solar-Language': 'id' } });
    expect(again.body.warnings).toEqual(en.warnings);
  });

  it('knowledge import notices and provider tests', async () => {
    const res = await fetch(`${server.url}/api/knowledge/import-document?name=notes.md&options=${encodeURIComponent(JSON.stringify({ folder: 'documents/notes', split: 1 }))}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Solar-Language': 'en' },
      body: 'Plain notes without any heading.',
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { warnings: string[] }).warnings).toContain('The document has no headings to split at; it was saved as one file.');

    const test = await api<{ ok: boolean; error: string }>('/api/llm/providers/nope/test', { method: 'POST', headers: { 'X-Solar-Language': 'en' } });
    expect(test.body).toMatchObject({ ok: false, error: 'Provider "nope" not found' });
    const testId = await api<{ ok: boolean; error: string }>('/api/llm/providers/nope/test', { method: 'POST' });
    expect(testId.body.error).toBe('Provider "nope" tidak ditemukan');

    // a store's error carries both languages
    const removed = await api<{ error: string }>('/api/skills/nope', { method: 'DELETE', headers: { 'X-Solar-Language': 'en' } });
    expect(removed).toEqual({ status: 404, body: { error: 'User skill "nope" not found (built-in skills can only be disabled)' } });
    const removedId = await api<{ error: string }>('/api/skills/nope', { method: 'DELETE' });
    expect(removedId.body.error).toBe('Skill pengguna "nope" tidak ditemukan (skill bawaan hanya bisa dinonaktifkan)');
  });
});
