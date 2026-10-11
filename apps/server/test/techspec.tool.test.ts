import { describe, expect, it, vi } from 'vitest';
import type { Artifact } from '@solar/shared';
import { createBuiltinTools } from '../src/agent/builtinTools.js';
import type { AppConfig } from '../src/config.js';
import { buildArchimate } from '../src/generators/archimate/index.js';
import type { ArtifactService, NewArtifact } from '../src/tasks/artifactService.js';
import type { TaskRunContext } from '../src/tasks/taskManager.js';
import { sampleArchimate, sampleTechSpec } from './fixtures.js';

// the Word renderer fails: the TSD itself must still be saved
vi.mock('../src/generators/techspec/docx.js', () => ({
  renderTechSpecDocx: vi.fn(async () => {
    throw new Error('simulated renderer crash');
  }),
}));

describe('create_technical_specification when the Word file fails', () => {
  it('saves the Markdown, HTML and JSON and returns a warning instead of failing', async () => {
    const built = buildArchimate(sampleArchimate);
    if (!built.ok) throw new Error('fixture');
    const svg = built.output.views[0]!.svg;
    const stored: Artifact[] = [
      { id: 'art_view1', taskId: 'task_1', name: 'layered.svg', title: 'Layered', kind: 'archimate-svg', mimeType: 'image/svg+xml', size: svg.length, storageKey: 'k', bundle: 'b_arch', description: null, createdAt: '2026-10-06T00:00:00.000Z' },
    ];
    const artifacts = { readText: async () => svg } as unknown as ArtifactService;
    const tool = createBuiltinTools({ config: { github: {}, plane: {} } as AppConfig, skills: {} as never, artifacts, attachments: {} as never }).find(
      (t) => t.name === 'create_technical_specification',
    )!;
    const ctx = {
      listArtifacts: async () => stored,
      createArtifact: async (input: Omit<NewArtifact, 'taskId'>) => {
        const a: Artifact = { ...input, id: `art_${stored.length}`, taskId: 'task_1', size: 1, storageKey: 'k', description: input.description ?? null, createdAt: '' } as Artifact;
        stored.push(a);
        return a;
      },
    } as unknown as TaskRunContext;
    const parsed = tool.parse(sampleTechSpec('art_view1'));
    if (!parsed.ok) throw new Error(parsed.error);
    const out = await tool.execute(parsed.value, ctx);
    expect(out.isError).toBeFalsy();
    const body = JSON.parse(out.content as string) as { status: string; docx: unknown; warnings: string[] };
    expect(body.status).toBe('saved');
    expect(body.docx).toBeNull();
    expect(body.warnings.join('\n')).toMatch(/\[docx\] The Word file could not be created \(simulated renderer crash\)/);
    expect(stored.map((a) => a.kind)).toEqual(['archimate-svg', 'tsd-markdown', 'tsd-html', 'tsd-model']);
  });
});
