import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatCompletionChunk, ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { KnowledgeEntry, KnowledgeFile, KnowledgeSearchHit, PublicConfig, Task, TaskDetail } from '@solar/shared';
import { loadConfig } from '../src/config.js';
import { describeKnowledge, KnowledgeStore, normalizeKnowledgePath } from '../src/knowledge/knowledgeStore.js';
import type { ChatCompletionsApi } from '../src/llm/chatClient.js';
import { startServer, type RunningServer } from '../src/server.js';

const AD1GATE = `---
id: AD1GATE
title: AD1GATE API Gateway
aliases: [AD1 Gateway]
tags: [gateway]
---

# AD1GATE

Gateway untuk semua API channel digital.

## Batasan
Maksimum 2000 TPS per consumer.
`;

const OGG = `# Oracle GoldenGate

CDC dari core banking ke data lake. Dipakai untuk replikasi near real-time.
`;

describe('KnowledgeStore', () => {
  const root = mkdtempSync(join(tmpdir(), 'solar-kb-'));
  const builtin = join(root, 'builtin');
  const user = join(root, 'user');
  mkdirSync(join(builtin, '_templates'), { recursive: true });
  writeFileSync(join(builtin, 'README.md'), '# Panduan');
  writeFileSync(join(builtin, '_templates', 'system.md'), '---\ntype: system\n---\n# Template');
  writeFileSync(join(builtin, 'ARCHIMATE.md'), '# Aturan ArchiMate\n\nGunakan viewpoint Layered.');
  const store = new KnowledgeStore(builtin, user);

  beforeAll(async () => {
    await store.init();
    await store.write('systems/AD1GATE.md', AD1GATE);
    await store.write('integrations/OGG.md', OGG);
    await store.write('standards/api-specification.md', '# API\n\nSemua endpoint memakai prefix /api/v1 dan error code 4 digit.');
  });

  it('derives type, id, title and description from front matter, folders and names', async () => {
    const all = await store.listAll();
    expect(all.map((e) => e.path).sort()).toEqual(['ARCHIMATE.md', 'README.md', '_templates/system.md', 'integrations/OGG.md', 'standards/api-specification.md', 'systems/AD1GATE.md']);
    const agent = await store.list();
    expect(agent.map((e) => e.path).sort()).toEqual(['ARCHIMATE.md', 'integrations/OGG.md', 'standards/api-specification.md', 'systems/AD1GATE.md']);
    const byPath = Object.fromEntries(agent.map((e) => [e.path, e]));
    expect(byPath['systems/AD1GATE.md']).toMatchObject({ id: 'AD1GATE', type: 'system', title: 'AD1GATE API Gateway', aliases: ['AD1 Gateway'], source: 'user' });
    expect(byPath['integrations/OGG.md']).toMatchObject({ id: 'OGG', type: 'integration', title: 'Oracle GoldenGate', description: 'CDC dari core banking ke data lake. Dipakai untuk replikasi near real-time.' });
    expect(byPath['ARCHIMATE.md']).toMatchObject({ type: 'standard', source: 'builtin' });
    expect(describeKnowledge('LANDSCAPE.md', '# Landscape', 'user', 1, '').type).toBe('landscape');
    expect(describeKnowledge('notes.md', '---\ntype: decision\n---\n# x', 'user', 1, '').type).toBe('decision');
  });

  it('searches metadata and content with line snippets', async () => {
    const hits = await store.search('gateway tps');
    expect(hits[0]!.entry.path).toBe('systems/AD1GATE.md');
    expect(hits[0]!.snippets.some((s) => s.text.includes('2000 TPS'))).toBe(true);
    expect((await store.search('gateway', { type: 'integration' })).length).toBe(0);
  });

  it('matches system names and aliases mentioned in a request', async () => {
    const entries = await store.list();
    const found = store.matchMentions(entries, 'Integrasi baru lewat AD1 Gateway lalu replikasi via OGG ke data lake');
    expect(found.map((e) => e.path).sort()).toEqual(['integrations/OGG.md', 'systems/AD1GATE.md']);
    expect(store.matchMentions(entries, 'LOGGING saja')).toEqual([]);
    // standards are not matched by name (their titles are common words)
    expect(store.matchMentions(entries, 'Aturan ArchiMate')).toEqual([]);
  });

  it('validates paths, overrides built-in files and reverts on delete', async () => {
    expect(() => normalizeKnowledgePath('../etc/passwd.md')).toThrow();
    expect(() => normalizeKnowledgePath('systems/.hidden.md')).toThrow();
    expect(() => normalizeKnowledgePath('systems/x.txt')).toThrow();
    expect(normalizeKnowledgePath('\\systems\\ESB.md')).toBe('systems/ESB.md');

    await store.write('ARCHIMATE.md', '# Aturan ArchiMate (versi saya)');
    expect((await store.read('ARCHIMATE.md'))!).toMatchObject({ content: '# Aturan ArchiMate (versi saya)', entry: { source: 'user' } });
    expect(await store.remove('ARCHIMATE.md')).toBe('reverted');
    expect((await store.read('ARCHIMATE.md'))!.entry.source).toBe('builtin');
    await expect(store.remove('ARCHIMATE.md')).rejects.toThrow(/not a user file/);
  });
});

/** A Chat Completions fake: records requests, answers with one text turn. */
function recordingChat(seen: ChatCompletionCreateParamsStreaming[]): ChatCompletionsApi {
  return {
    async create(params) {
      seen.push(params);
      async function* gen(): AsyncIterable<ChatCompletionChunk> {
        yield { id: 'c', object: 'chat.completion.chunk', created: 0, model: params.model, choices: [{ index: 0, delta: { content: 'Siap.' }, finish_reason: 'stop', logprobs: null }] };
      }
      return gen();
    },
  };
}

describe('Knowledge base API and agent context', () => {
  let solar: RunningServer;
  const seen: ChatCompletionCreateParamsStreaming[] = [];

  const api = async <T>(method: string, path: string, body?: unknown) => {
    const res = await fetch(`${solar.url}${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: (await res.json()) as T };
  };

  beforeAll(async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'solar-kb-api-'));
    const config = loadConfig({
      ...process.env,
      SOLAR_ROOT: fileURLToPath(new URL('../../..', import.meta.url)),
      DATA_DIR: dataDir,
      PLUGINS_DEFAULT_FILE: join(dataDir, 'no-plugins.json'),
    });
    config.databaseUrl = undefined;
    config.s3 = null;
    config.accessToken = undefined;
    config.github.token = undefined;
    config.plane.apiKey = undefined;
    solar = await startServer({ config, port: 0, chatApis: { local: recordingChat(seen) } });
    await api('POST', '/api/llm/providers', { id: 'local', name: 'Ollama', kind: 'openai-chat', baseUrl: 'http://127.0.0.1:1/v1' });
    await api('PUT', '/api/llm/routes', { routes: { default: ['local/qwen3'] } });
  });

  afterAll(async () => {
    await solar?.close();
  });

  it('imports, reads, searches and deletes knowledge files', async () => {
    const imported = await api<{ imported: KnowledgeEntry[]; failed: Array<{ path: string }> }>('POST', '/api/knowledge/import', {
      files: [
        { path: 'systems/AD1GATE.md', content: AD1GATE },
        { path: 'integrations/OGG.md', content: OGG },
        { path: '../escape.md', content: 'x' },
      ],
    });
    expect(imported.status).toBe(201);
    expect(imported.data.imported.map((e) => e.path)).toEqual(['systems/AD1GATE.md', 'integrations/OGG.md']);
    expect(imported.data.failed.map((f) => f.path)).toEqual(['../escape.md']);

    const file = await api<KnowledgeFile>('GET', '/api/knowledge/file?path=systems/AD1GATE.md');
    expect(file.data.entry.title).toBe('AD1GATE API Gateway');
    const put = await api<KnowledgeEntry>('PUT', '/api/knowledge/file', { path: 'systems/ESB.md', content: '# ESB\n\nEnterprise Service Bus.' });
    expect(put.data).toMatchObject({ id: 'ESB', type: 'system' });
    const hits = await api<KnowledgeSearchHit[]>('GET', '/api/knowledge/search?q=service%20bus');
    expect(hits.data[0]!.entry.path).toBe('systems/ESB.md');
    const list = await api<KnowledgeEntry[]>('GET', '/api/knowledge');
    expect(list.data.some((e) => e.path === 'README.md')).toBe(true);
    expect((await api<PublicConfig>('GET', '/api/config')).data.knowledgeFiles).toBe(3);
    expect((await api('DELETE', '/api/knowledge/file?path=systems/ESB.md')).status).toBe(200);
    expect((await api('GET', '/api/knowledge/file?path=systems/ESB.md')).status).toBe(404);
  });

  const upload = async <T>(path: string, name: string, body: Buffer | string, options?: unknown) => {
    const qs = `name=${encodeURIComponent(name)}${options ? `&options=${encodeURIComponent(JSON.stringify(options))}` : ''}`;
    const res = await fetch(`${solar.url}${path}?${qs}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body });
    return { status: res.status, data: (await res.json()) as T };
  };

  it('converts an Excel catalog into one knowledge file per row plus an index', async () => {
    const xlsx = readFileSync(fileURLToPath(new URL('./fixtures/documents/integration-inventory.xlsx', import.meta.url)));
    const preview = await upload<Array<{ name: string; headers: string[]; rows: number }>>('/api/knowledge/tables', 'integration-inventory.xlsx', xlsx);
    expect(preview.status).toBe(200);
    expect(preview.data[0]).toMatchObject({ name: 'Integrations', headers: expect.arrayContaining(['ID', 'Sistem', 'Protokol']) });
    const total = preview.data[0]!.rows;

    const opts = { sheet: 'Integrations', idColumn: 'ID', titleColumn: 'Sistem', aliasColumns: ['Sistem'], folder: 'integrations/inventory', type: 'integration' };
    const result = await upload<{ written: KnowledgeEntry[]; index: string; skipped: unknown[] }>('/api/knowledge/import-table', 'integration-inventory.xlsx', xlsx, opts);
    expect(result.status, JSON.stringify(result.data)).toBe(201);
    expect(result.data.written.length).toBe(total);
    expect(result.data.index).toBe('integrations/inventory/INDEX.md');
    const item = (await api<KnowledgeFile>('GET', '/api/knowledge/file?path=integrations/inventory/INT-02.md')).data;
    expect(item.entry).toMatchObject({ id: 'INT-02', title: 'Core Banking', type: 'integration', aliases: ['Core Banking'] });
    expect(item.content).toContain('- **Protokol**: ISO 8583');
    const index = (await api<KnowledgeFile>('GET', '/api/knowledge/file?path=integrations/inventory/INDEX.md')).data;
    expect(index.content).toContain('| [INT-02](INT-02.md) | Core Banking | ISO 8583 |');

    // re-import of a smaller CSV with the same file/sheet name removes rows that disappeared
    const csv = 'ID,Sistem,Protokol\nINT-02,Core Banking,ISO 8583\n';
    const csvResult = await upload<{ written: KnowledgeEntry[]; removed: string[] }>('/api/knowledge/import-table', 'inv.csv', csv, { ...opts, sheet: 'inv' });
    expect(csvResult.status, JSON.stringify(csvResult.data)).toBe(201);
    expect(csvResult.data.removed).toEqual([]); // different source file: nothing removed
    const again = await upload<{ removed: string[] }>('/api/knowledge/import-table', 'integration-inventory.xlsx', xlsx, opts);
    expect(again.data.removed).toEqual([]);

    expect((await upload('/api/knowledge/import-table', 'integration-inventory.xlsx', xlsx, { ...opts, idColumn: 'Tidak Ada' })).status).toBe(400);
    expect((await upload('/api/knowledge/import-table', 'integration-inventory.xlsx', xlsx, { ...opts, folder: '_hidden' })).status).toBe(400);
  });

  it('stores a document as knowledge, whole or split per chapter', async () => {
    const md = '# Aturan API\n\nPengantar.\n\n## Penamaan\n\nGunakan kebab-case.\n\n```\n# bukan heading\n```\n\n## Error\n\nKode 4 digit.\n';
    const whole = await upload<{ written: KnowledgeEntry[] }>('/api/knowledge/import-document', 'api-guideline.md', md, { folder: 'standards', type: 'standard' });
    expect(whole.status).toBe(201);
    expect(whole.data.written.map((e) => e.path)).toEqual(['standards/api-guideline.md']);

    const split = await upload<{ written: KnowledgeEntry[]; removed: string[] }>('/api/knowledge/import-document', 'api-guideline.md', md, {
      folder: 'standards',
      type: 'standard',
      split: 2,
    });
    expect(split.status).toBe(201);
    expect(split.data.written.map((e) => e.path)).toEqual([
      'standards/api-guideline/01-Aturan-API.md',
      'standards/api-guideline/02-Penamaan.md',
      'standards/api-guideline/03-Error.md',
      'standards/api-guideline/INDEX.md',
    ]);
    // the earlier whole-file import of the same document is replaced
    expect(split.data.removed).toEqual(['standards/api-guideline.md']);
    const naming = (await api<KnowledgeFile>('GET', '/api/knowledge/file?path=standards/api-guideline/02-Penamaan.md')).data;
    expect(naming.content).toContain('Gunakan kebab-case.');
    expect(naming.entry.title).toBe('api-guideline: Penamaan');
    const error = (await api<KnowledgeFile>('GET', '/api/knowledge/file?path=standards/api-guideline/03-Error.md')).data;
    expect(error.content).not.toContain('kebab');
    const pre = (await api<KnowledgeFile>('GET', '/api/knowledge/file?path=standards/api-guideline/02-Penamaan.md')).data.content;
    expect(pre).toContain('# bukan heading');

    // "per bab" on a document with one title heading splits at its chapters instead
    const byChapter = await upload<{ written: KnowledgeEntry[]; warnings: string[] }>('/api/knowledge/import-document', 'api-guideline.md', md, { folder: 'standards', split: 1 });
    expect(byChapter.data.written).toHaveLength(4);
    expect(byChapter.data.warnings).toEqual([]);
    const flat = await upload<{ written: KnowledgeEntry[]; warnings: string[] }>('/api/knowledge/import-document', 'flat.txt', 'tanpa heading sama sekali', { folder: 'standards', split: 1 });
    expect(flat.data.written.map((e) => e.path)).toEqual(['standards/flat.md']);
    expect(flat.data.warnings[0]).toContain('tidak punya heading');
  });

  it('puts the knowledge index in the system prompt and matched files in the request', async () => {
    const registry = 'ID,Nama,Status,Catatan\nLEGACY-ESB,Legacy ESB,Retired,diganti ESB baru\nNEW-ESB,ESB baru,active,\n';
    const reg = await upload<{ written: KnowledgeEntry[] }>('/api/knowledge/import-table', 'registry.csv', registry, {
      sheet: 'registry',
      idColumn: 'ID',
      titleColumn: 'Nama',
      statusColumn: 'Status',
      folder: 'systems/registry',
      type: 'system',
    });
    expect(reg.status, JSON.stringify(reg.data)).toBe(201);
    expect(reg.data.written.map((e) => e.status)).toEqual(['retired', 'active']);

    const created = await api<Task>('POST', '/api/tasks', { prompt: 'Rancang integrasi baru melalui AD1 Gateway ke core banking', sessionId: 'kb' });
    let detail: TaskDetail | null = null;
    for (let i = 0; i < 200; i++) {
      detail = (await api<TaskDetail>('GET', `/api/tasks/${created.data.id}`)).data;
      if (['completed', 'failed'].includes(detail.task.status)) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(detail!.task.status, detail!.task.error ?? '').toBe('completed');
    expect(detail!.task.model).toBe('local/qwen3');
    const params = seen.at(-1)!;
    const system = String(params.messages[0]!.content);
    expect(system).toContain('# Knowledge base (the user');
    expect(system).toContain('- systems/AD1GATE.md [system] AD1GATE API Gateway (aliases: AD1 Gateway)');
    expect(system).not.toContain('_templates');
    expect(system).toContain('- systems/registry/LEGACY-ESB.md [system, RETIRED: retired] Legacy ESB');
    expect(system).toContain('- systems/registry/NEW-ESB.md [system, active] ESB baru');
    expect(system).toContain('never as part of a new solution');
    const user = String(params.messages[1]!.content);
    expect(user).toContain('<knowledge_matches>');
    expect(user).toContain('- systems/AD1GATE.md (system: AD1GATE API Gateway)');
    expect(user).not.toContain('integrations/OGG.md');
    // INT-02 (Core Banking) from the Excel import is matched by its alias
    expect(user).toContain('integrations/inventory/INT-02.md');
    expect(params.max_tokens).toBe(16384);
  });
});
