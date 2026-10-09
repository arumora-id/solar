import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_USAGE, type Artifact, type Task } from '@solar/shared';
import { createBuiltinTools } from '../src/agent/builtinTools.js';
import type { AppConfig } from '../src/config.js';
import { buildArchimate } from '../src/generators/archimate/index.js';
import { FileRepository } from '../src/storage/fileRepository.js';
import { LocalObjectStore } from '../src/storage/objectStore.js';
import { ArtifactService } from '../src/tasks/artifactService.js';
import { exportTechSpecDocx } from '../src/tasks/techSpecDocx.js';
import type { TaskRunContext } from '../src/tasks/taskManager.js';
import { sampleArchimate, sampleTechSpec } from './fixtures.js';

/** The Word renderer waits for `gate` (opened by each test), so a test can act while the tool is rendering. */
const render = vi.hoisted(() => {
  const state = { started: 0, open: () => {}, gate: Promise.resolve() };
  return {
    state,
    close() {
      state.gate = new Promise<void>((resolve) => (state.open = resolve));
    },
  };
});
vi.mock('../src/generators/techspec/docx.js', () => ({
  renderTechSpecDocx: vi.fn(async () => {
    render.state.started += 1;
    await render.state.gate;
    return { buffer: Buffer.from('PK fake docx'), warnings: [] };
  }),
}));

const TASK = 'task_tool_docx';
let artifacts: ArtifactService;
let svgId = '';

beforeEach(async () => {
  render.state.started = 0;
  render.state.gate = Promise.resolve();
  const dataDir = mkdtempSync(join(tmpdir(), 'solar-tool-docx-'));
  const repo = new FileRepository(dataDir);
  await repo.init();
  artifacts = new ArtifactService(repo, new LocalObjectStore(dataDir));
  const task: Task = {
    id: TASK,
    sessionId: 's1',
    title: 'TSD',
    prompt: 'Buat TSD',
    status: 'running',
    progress: 10,
    currentStep: '',
    model: 'test',
    createdAt: '2026-10-08T08:00:00.000Z',
    startedAt: '2026-10-08T08:00:00.000Z',
    finishedAt: null,
    result: null,
    error: null,
    usage: { ...EMPTY_USAGE },
    attachmentIds: [],
  };
  await repo.upsertTask(task);
  const built = buildArchimate(sampleArchimate);
  if (!built.ok) throw new Error('fixture');
  svgId = (
    await artifacts.create({ taskId: TASK, name: 'layered.svg', title: 'Layered', kind: 'archimate-svg', mimeType: 'image/svg+xml', bundle: 'bundle_arch', content: built.output.views[0]!.svg })
  ).id;
});

function runTool(fileName: string) {
  const tool = createBuiltinTools({ config: { github: {}, plane: {} } as AppConfig, skills: {} as never, artifacts, attachments: {} as never }).find(
    (t) => t.name === 'create_technical_specification',
  )!;
  const ctx = {
    listArtifacts: () => artifacts.list(TASK),
    createArtifact: (input: Parameters<TaskRunContext['createArtifact']>[0]) => artifacts.create({ ...input, taskId: TASK }),
  } as unknown as TaskRunContext;
  const parsed = tool.parse({ ...sampleTechSpec(svgId), fileName });
  if (!parsed.ok) throw new Error(parsed.error);
  return tool.execute(parsed.value, ctx);
}

const bundleOf = async (bundle: string) => (await artifacts.list(TASK)).filter((a) => a.bundle === bundle);

describe('create_technical_specification and its Word file', () => {
  it('saves the .md, .html and .docx before the .tsd.json, all named after the .md (also when that name was taken)', async () => {
    // an older TSD in the same task, without a Word file
    for (const [name, kind] of [['order.md', 'tsd-markdown'], ['order.html', 'tsd-html'], ['order.tsd.json', 'tsd-model']] as const) {
      await artifacts.create({ taskId: TASK, name, title: name, kind, mimeType: 'text/plain', bundle: 'bundle_old', content: '{}' });
    }
    const out = await runTool('order');
    const body = JSON.parse(out.content as string) as { bundle: string; docx: { file: string } };
    const files = await bundleOf(body.bundle);
    expect(files.map((a) => [a.kind, a.name])).toEqual([
      ['tsd-markdown', 'order-2.md'],
      ['tsd-html', 'order-2.html'],
      ['tsd-docx', 'order-2.docx'],
      ['tsd-model', 'order-2.tsd.json'],
    ]);
    expect(body.docx.file).toBe('order-2.docx');
  });

  it('an export of the bundle that arrives while the tool renders waits and returns the tool\'s Word file', async () => {
    render.close();
    const running = runTool('order');
    // wait until the tool is rendering: its .md and .html are saved, the .tsd.json not yet
    for (let i = 0; i < 200 && render.state.started === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(render.state.started).toBe(1);
    const md = (await artifacts.list(TASK)).find((a) => a.kind === 'tsd-markdown')!;
    expect((await bundleOf(md.bundle)).map((a) => a.kind)).toEqual(['tsd-markdown', 'tsd-html']);

    const save = vi.fn((taskId: string, input: Parameters<TaskRunContext['createArtifact']>[0]) => artifacts.create({ ...input, taskId }));
    const exporting = exportTechSpecDocx(artifacts, save, md.id);
    await new Promise((r) => setTimeout(r, 50));
    render.state.open();
    const [, exported] = await Promise.all([running, exporting]);

    const words = (await bundleOf(md.bundle)).filter((a): a is Artifact => a.kind === 'tsd-docx');
    expect(words.map((a) => a.name)).toEqual(['order.docx']);
    expect(exported).toMatchObject({ created: false, artifact: { id: words[0]!.id } });
    expect(save).not.toHaveBeenCalled();
    expect(render.state.started).toBe(1);
  });
});
