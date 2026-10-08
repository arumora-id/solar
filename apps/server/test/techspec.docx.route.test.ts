import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMPTY_USAGE, type Artifact, type Task, type TaskDetail } from '@solar/shared';
import { loadConfig } from '../src/config.js';
import { buildArchimate } from '../src/generators/archimate/index.js';
import { buildSequence } from '../src/generators/sequence/index.js';
import { buildTechSpec, type ResolvedDiagram } from '../src/generators/techspec/index.js';
import { startServer, type RunningServer } from '../src/server.js';
import { FileRepository } from '../src/storage/fileRepository.js';
import { LocalObjectStore } from '../src/storage/objectStore.js';
import { ArtifactService } from '../src/tasks/artifactService.js';
import { richTechSpec, sampleArchimate, sampleSequence } from './fixtures.js';

/**
 * POST /api/artifacts/:id/docx on TSDs made before the tool wrote Word files: the data directory is seeded with a finished
 * task holding diagrams and a TSD bundle (.md, .html, .tsd.json) but no .docx, then the server is started on it.
 */

let server: RunningServer;
const ids = { md: '', html: '', model: '', badModel: '', svg: '', taskId: 'task_seeded01' };

async function post(id: string): Promise<{ status: number; body: { artifact?: Artifact; created?: boolean; warnings?: string[]; error?: string } }> {
  const res = await fetch(`${server.url}/api/artifacts/${id}/docx`, { method: 'POST' });
  return { status: res.status, body: (await res.json()) as never };
}

beforeAll(async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'solar-docx-'));
  const repo = new FileRepository(dataDir);
  await repo.init();
  const artifacts = new ArtifactService(repo, new LocalObjectStore(dataDir));
  const task: Task = {
    id: ids.taskId,
    sessionId: 's1',
    title: 'Older TSD',
    prompt: 'Buat TSD',
    status: 'completed',
    progress: 100,
    currentStep: 'Selesai',
    model: 'test',
    createdAt: '2026-09-01T08:00:00.000Z',
    startedAt: '2026-09-01T08:00:00.000Z',
    finishedAt: '2026-09-01T08:05:00.000Z',
    result: 'ok',
    error: null,
    usage: { ...EMPTY_USAGE },
    attachmentIds: [],
  };
  await repo.upsertTask(task);

  const a = buildArchimate(sampleArchimate);
  const s = buildSequence(sampleSequence);
  if (!a.ok || !s.ok) throw new Error('fixture diagrams failed');
  const add = (name: string, kind: Artifact['kind'], bundle: string, content: string, mimeType = 'application/json') =>
    artifacts.create({ taskId: task.id, name, title: name, kind, mimeType, bundle, content });
  const view = await add('order-layered.svg', 'archimate-svg', 'bundle_arch', a.output.views[0]!.svg, 'image/svg+xml');
  const seq = await add('place-order.sequence.svg', 'sequence-svg', 'bundle_seq', s.output.svg, 'image/svg+xml');
  await add('place-order.mmd', 'sequence-mermaid', 'bundle_seq', s.output.mermaid, 'text/plain');
  ids.svg = view.id;

  const diagrams = new Map<string, ResolvedDiagram>([
    [view.id, { artifactId: view.id, fileName: view.name, svg: a.output.views[0]!.svg }],
    [seq.id, { artifactId: seq.id, fileName: seq.name, svg: s.output.svg, mermaid: s.output.mermaid }],
  ]);
  const spec = richTechSpec({ view: view.id, sequence: seq.id }, 'en');
  const built = buildTechSpec(spec, diagrams, '2026-09-01');
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  ids.md = (await add('order-platform.md', 'tsd-markdown', 'bundle_tsd', built.output.markdown, 'text/markdown')).id;
  ids.html = (await add('order-platform.html', 'tsd-html', 'bundle_tsd', built.output.html, 'text/html')).id;
  const model = await add('order-platform.tsd.json', 'tsd-model', 'bundle_tsd', JSON.stringify(built.output.spec));
  ids.model = model.id;
  // made a while ago: the Word file must carry that date, as the .md and .html do
  await repo.saveArtifact({ ...model, createdAt: '2026-09-01T08:04:00.000Z' });
  // a second TSD bundle whose model was damaged
  ids.badModel = (await add('broken.tsd.json', 'tsd-model', 'bundle_bad', '{"title": "x"}')).id;
  await repo.close();

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
  config.databaseUrl = undefined;
  config.s3 = null;
  config.accessToken = undefined;
  config.github.token = undefined;
  server = await startServer({ config, port: 0 });
});

afterAll(async () => {
  await server?.close();
});

describe('POST /api/artifacts/:id/docx', () => {
  it('creates the Word file of an older TSD once, in the same task and bundle, and tells open UIs', async () => {
    // listen to the live stream the web UI uses
    const controller = new AbortController();
    const stream = await fetch(`${server.url}/api/stream`, { signal: controller.signal });
    const reader = stream.body!.getReader();
    let streamed = '';
    const reading = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        streamed += Buffer.from(value).toString('utf8');
      }
    })().catch(() => undefined);

    // two clicks at once still make one file
    const [first, second] = await Promise.all([post(ids.html), post(ids.md)]);
    const created = [first, second].find((r) => r.status === 201)!;
    const existing = [first, second].find((r) => r.status === 200)!;
    expect(created.body.created).toBe(true);
    expect(existing.body.created).toBe(false);
    const docx = created.body.artifact!;
    expect(existing.body.artifact!.id).toBe(docx.id);
    expect(docx).toMatchObject({
      taskId: ids.taskId,
      bundle: 'bundle_tsd',
      kind: 'tsd-docx',
      name: 'order-platform.docx',
      title: 'Order Platform - Technical Specification (Word)',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    expect(created.body.warnings).toEqual([]);

    // idempotent afterwards too, from the model itself
    const third = await post(ids.model);
    expect(third.status).toBe(200);
    expect(third.body.artifact!.id).toBe(docx.id);

    const detail = (await (await fetch(`${server.url}/api/tasks/${ids.taskId}`)).json()) as TaskDetail;
    expect(detail.artifacts.filter((a) => a.kind === 'tsd-docx').map((a) => a.id)).toEqual([docx.id]);
    expect(detail.events.filter((e) => e.type === 'artifact').map((e) => (e.type === 'artifact' ? e.artifact.id : ''))).toEqual([docx.id]);
    expect(detail.task.status).toBe('completed');

    for (let i = 0; i < 50 && !streamed.includes(docx.id); i++) await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    await reading;
    const event = streamed
      .split('\n\n')
      .map((chunk) => chunk.replace(/^data: /, ''))
      .filter((chunk) => chunk.startsWith('{'))
      .map((chunk) => JSON.parse(chunk) as { kind: string; event?: { type: string; taskId: string; artifact?: Artifact } })
      .find((m) => m.kind === 'event' && m.event?.type === 'artifact');
    expect(event?.event).toMatchObject({ taskId: ids.taskId, artifact: { id: docx.id, kind: 'tsd-docx' } });

    // the file: English labels, the diagrams it references, and the TSD's own date (not the export day)
    const res = await fetch(`${server.url}/api/artifacts/${docx.id}/content?download=1`);
    expect(res.headers.get('content-disposition')).toContain('order-platform.docx');
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const doc = strFromU8(files['word/document.xml']!);
    expect(doc).toContain('Technical Specification Document');
    expect(doc).toContain('1 September 2026');
    expect(Object.keys(files).filter((n) => /^word\/media\/.+\.(svg|png)$/.test(n)).length).toBe(4); // 2 diagrams x (svg + png)
  });

  it('answers 404 for an unknown artifact and 400 outside a TSD bundle or for an invalid model', async () => {
    expect((await post('art_doesnotexist')).status).toBe(404);
    const svg = await post(ids.svg);
    expect(svg.status).toBe(400);
    expect(svg.body.error).toMatch(/order-layered\.svg is not part of a Technical Specification Document/);
    const bad = await post(ids.badModel);
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/broken\.tsd\.json is not a valid specification/);
  });
});
