import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmProviderStore } from '../src/llm/providerStore.js';
import type { AttachmentService } from '../src/tasks/attachmentService.js';
import type { ArtifactService } from '../src/tasks/artifactService.js';
import type { TaskRunContext } from '../src/tasks/taskManager.js';
import { createImageTools } from '../src/agent/imageTools.js';

const images = vi.hoisted(() => ({
  generate: vi.fn(),
  edit: vi.fn(),
  toFile: vi.fn(),
  clients: [] as Array<Record<string, unknown>>,
}));
vi.mock('openai', () => ({
  default: class FakeOpenAI {
    constructor(options: Record<string, unknown>) { images.clients.push(options); }
    images = { generate: images.generate, edit: images.edit };
  },
  toFile: images.toFile,
}));

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 73, 72, 68, 82]);
const jpeg = Buffer.from([255, 216, 255, 224, 0, 0, 74, 70, 73, 70]);
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
  const routes: Record<string, string[]> = {
    'image-generation': ['openai/gpt-image-2'],
    'image-edit': ['openai/gpt-image-2'],
  };
  const resolved: Record<string, { config: { enabled: boolean }; apiKey: string; baseUrl?: string; headers: Record<string, string> }> = {
    openai: { config: { enabled: true }, apiKey: 'test-key', headers: {} },
  };
  const providers = {
    route: (name: string) => routes[name]!,
    resolve: (id: string) => resolved[id],
  } as unknown as LlmProviderStore;
  const tool = createImageTools(providers, artifacts, attachments)[0]!;
  return { tool, ctx, artifacts, attachments, createArtifact, routes, resolved };
}

beforeEach(() => {
  vi.clearAllMocks();
  images.clients.length = 0;
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
    }), expect.objectContaining({ signal: ctx.signal }));
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
  it('uses a configured OmniRoute image generation model, URL and key instead of OPENAI_*', async () => {
    const { tool, ctx, routes, resolved } = env();
    routes['image-generation'] = ['omniroute/custom-image-generator'];
    resolved.omniroute = {
      config: { enabled: true },
      apiKey: 'router-test-key',
      baseUrl: 'https://router.mesthi.com/v1',
      headers: { 'X-Solar-Route': 'images' },
    };
    await tool.execute({ prompt: 'Photorealistic solar farm', title: 'Solar', size: 'auto' }, ctx);
    expect(images.generate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'custom-image-generator' }),
      expect.objectContaining({ signal: ctx.signal }),
    );
    expect(images.clients[0]).toMatchObject({
      apiKey: 'router-test-key', baseURL: 'https://router.mesthi.com/v1',
      defaultHeaders: { 'X-Solar-Route': 'images' },
    });
  });

  it('selects an independent image edit model on the same provider', async () => {
    const { tool, ctx, routes, resolved } = env();
    routes['image-edit'] = ['omniroute/router-editor'];
    resolved.omniroute = {
      config: { enabled: true },
      apiKey: 'router-test-key',
      baseUrl: 'https://router.mesthi.com/v1',
      headers: {},
    };
    (ctx as unknown as { attachments: unknown[] }).attachments = [sampleAttachment];
    await tool.execute({ prompt: 'Make it sepia', title: 'Sepia', source_attachment_id: sampleAttachment.id, size: 'auto' }, ctx);
    expect(images.edit).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'router-editor', prompt: 'Make it sepia' }),
      expect.objectContaining({ signal: ctx.signal }),
    );
    expect(images.generate).not.toHaveBeenCalled();
  });

  it('falls back to the next image model when the first provider fails', async () => {
    const { tool, ctx, routes, resolved, createArtifact } = env();
    routes['image-generation'] = ['omniroute/fails', 'openai/gpt-image-2'];
    resolved.omniroute = { config: { enabled: true }, apiKey: 'bad-key', baseUrl: 'https://router.mesthi.com/v1', headers: {} };
    images.generate.mockRejectedValueOnce(new Error('gateway unavailable'));
    await tool.execute({ prompt: 'A solar panel', title: 'Fallback test', size: 'auto' }, ctx);
    expect(images.generate).toHaveBeenCalledTimes(2);
    expect(createArtifact).toHaveBeenCalledOnce();
  });

  it('does not fall back to a chat model when the image provider is disabled', async () => {
    const { tool, ctx, routes, resolved, createArtifact } = env();
    routes['image-generation'] = ['omniroute/disabled-image'];
    resolved.omniroute = { config: { enabled: false }, apiKey: 'any-key', baseUrl: 'https://router.mesthi.com/v1', headers: {} };
    await expect(tool.execute({ prompt: 'Test', title: 'No image', size: 'auto' }, ctx)).rejects.toThrow('unavailable or disabled');
    expect(images.generate).not.toHaveBeenCalled();
    expect(createArtifact).not.toHaveBeenCalled();
  });

});
