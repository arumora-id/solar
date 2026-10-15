import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../src/config.js';
import type { AttachmentService } from '../src/tasks/attachmentService.js';
import type { ArtifactService } from '../src/tasks/artifactService.js';
import type { TaskRunContext } from '../src/tasks/taskManager.js';
import { createImageTools } from '../src/agent/imageTools.js';

const images = vi.hoisted(() => ({
  generate: vi.fn(),
  edit: vi.fn(),
  toFile: vi.fn(),
}));
vi.mock('openai', () => ({
  default: class FakeOpenAI {
    images = { generate: images.generate, edit: images.edit };
  },
  toFile: images.toFile,
}));

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 73, 72, 68, 82]);
const jpeg = Buffer.from([255, 216, 255, 224, 0, 0, 74, 70, 73, 70]);
const config = { openai: { apiKey: 'test-key', baseUrl: undefined } } as AppConfig;
const sampleAttachment = { id: 'att-image-1', kind: 'image', mimeType: 'image/jpeg', name: 'input.jpg' };

function env(role: 'superadmin' | 'head_of_it' | 'staff' = 'superadmin') {
  const createArtifact = vi.fn(async (input: { content: Buffer; name: string; mimeType: string }) => ({
    id: 'art-created-image', name: input.name, mimeType: input.mimeType, size: input.content.length,
  }));
  const ctx = {
    requester: { id: 'superadmin-a', role },
    task: { id: 'task-images-1' },
    attachments: [],
    canReadArtifact: vi.fn(async () => true),
    createArtifact,
    signal: new AbortController().signal,
  } as unknown as TaskRunContext;
  const artifacts = {
    get: vi.fn(async () => ({ id: 'art-original', mimeType: 'image/png', name: 'original.png' })),
    read: vi.fn(async () => png),
  } as unknown as ArtifactService;
  const attachments = { readOriginal: vi.fn(async () => jpeg) } as unknown as AttachmentService;
  const tool = createImageTools(config, artifacts, attachments)[0]!;
  return { tool, ctx, artifacts, attachments, createArtifact };
}

beforeEach(() => {
  vi.clearAllMocks();
  images.generate.mockResolvedValue({ data: [{ b64_json: png.toString('base64') }] });
  images.edit.mockResolvedValue({ data: [{ b64_json: png.toString('base64') }] });
  images.toFile.mockResolvedValue({ fake: 'input-file' });
});

describe('superadmin Image Skill tool, mocked provider (no API credential/network required)', () => {
  it('denies other roles at the tool boundary before an image API call', async () => {
    for (const role of ['staff', 'head_of_it'] as const) {
      const { tool, ctx } = env(role);
      const result = await tool.authorize!({ prompt: 'image', title: 'Test' }, ctx);
      expect(result?.isError).toBe(true);
      expect(images.generate).not.toHaveBeenCalled();
    }
  });

  it('generates a raster PNG artifact with the user-requested size', async () => {
    const { tool, ctx, createArtifact } = env();
    const input = tool.parse({ prompt: 'Mountains in morning mist', title: 'Mountain cover', size: '1536x864' });
    expect(input.ok).toBe(true);
    if (!input.ok) return;
    expect(await tool.authorize!(input.value, ctx)).toBeNull();
    const result = await tool.execute(input.value, ctx);
    expect(result.isError).not.toBe(true);
    expect(images.generate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-image-2', size: '1536x864',
      prompt: 'Mountains in morning mist', output_format: 'png',
    }));
    expect(createArtifact).toHaveBeenCalledWith(expect.objectContaining({
      name: 'generated-image.png', mimeType: 'image/png', content: png,
    }));
    expect(result.content).toContain('art-created-image');
  });

  it('edits current-task attachments without modifying or replacing the source', async () => {
    const { tool, ctx, createArtifact, attachments } = env();
    (ctx as unknown as { attachments: unknown[] }).attachments = [sampleAttachment];
    const input = tool.parse({ prompt: 'Make the sky overcast', title: 'Retouched', source_attachment_id: sampleAttachment.id });
    if (!input.ok) throw new Error('invalid input');
    expect(await tool.authorize!(input.value, ctx)).toBeNull();
    await tool.execute(input.value, ctx);
    expect(attachments.readOriginal).toHaveBeenCalledOnce();
    expect(images.toFile).toHaveBeenCalledOnce();
    expect(images.edit).toHaveBeenCalledOnce();
    expect(createArtifact).toHaveBeenCalledWith(expect.objectContaining({ name: 'edited-image.png' }));
  });

  it('rejects inaccessible image references and invalid provider bytes', async () => {
    const { tool, ctx, createArtifact } = env();
    const input = tool.parse({ prompt: 'Edit', title: 'Edit', source_artifact_id: 'art-other-person' });
    if (!input.ok) throw new Error('invalid input');
    (ctx as unknown as { canReadArtifact: () => Promise<boolean> }).canReadArtifact = async () => false;
    expect((await tool.authorize!(input.value, ctx))?.isError).toBe(true);
    images.generate.mockResolvedValue({ data: [{ b64_json: Buffer.from('not a PNG').toString('base64') }] });
    await expect(tool.execute({ prompt: 'Test', title: 'Output', size: 'auto' }, ctx)).rejects.toThrow('valid PNG');
    expect(createArtifact).not.toHaveBeenCalled();
  });
});
