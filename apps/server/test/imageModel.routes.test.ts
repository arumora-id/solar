import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { LlmProviderStore } from '../src/llm/providerStore.js';

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'solar-image-models-'));
  const config = { dataDir, openai: { model: 'gpt-6', apiKey: 'test-key' } } as AppConfig;
  const store = new LlmProviderStore(config, {});
  await store.init();
  await store.create({
    id: 'omniroute', name: 'OmniRoute', kind: 'openai-chat', enabled: true,
    baseUrl: 'https://router.mesthi.com/v1', apiKey: 'router-key',
    models: [{ id: 'both-operations', imageGeneration: true, imageEditing: true }],
  });
  return { store, cleanup: () => rm(dataDir, { recursive: true, force: true }) };
}

describe('capability-based image model routing', () => {
  it('automatically selects a single image model for both API operations', async () => {
    const { store, cleanup } = await fixture();
    try {
      expect(store.imageRoute('generate')).toEqual({ entries: ['omniroute/both-operations'], requireCapability: true });
      expect(store.imageRoute('edit')).toEqual({ entries: ['omniroute/both-operations'], requireCapability: true });
      expect(store.route()).toEqual(['openai/gpt-6']);
    } finally { await cleanup(); }
  });

  it('preserves existing v1.0.5 per-operation routes until explicitly replaced', async () => {
    const { store, cleanup } = await fixture();
    try {
      await store.setRoutes({
        'image-generation': ['omniroute/old-gen'],
        'image-edit': ['omniroute/old-edit'],
      });
      expect(store.imageRoute('generate').entries).toEqual(['omniroute/old-gen']);
      expect(store.imageRoute('edit').entries).toEqual(['omniroute/old-edit']);
      expect(store.imageRoute('edit').requireCapability).toBe(false);
      await store.setRoutes({ image: ['omniroute/both-operations'] });
      expect(store.imageRoute('generate').entries).toEqual(['omniroute/both-operations']);
      expect(store.imageRoute('edit').entries).toEqual(['omniroute/both-operations']);
    } finally { await cleanup(); }
  });

  it('rejects a chat-only model in the shared image route', async () => {
    const { store, cleanup } = await fixture();
    try {
      await expect(store.setRoutes({ image: ['openai/gpt-6'] })).rejects.toThrow('must be declared');
      await expect(store.setRoutes({ image: ['omniroute/unknown'] })).rejects.toThrow('must be declared');
      expect(store.imageRoute('generate').entries).toEqual(['omniroute/both-operations']);
    } finally { await cleanup(); }
  });

  it('falls back to env image model only when no explicit or unique image-capable model is present', async () => {
    const { store, cleanup } = await fixture();
    try {
      await store.create({
        id: 'second', name: 'Another image provider', kind: 'openai-chat', enabled: true,
        models: [{ id: 'another', imageGeneration: true }],
      });
      expect(store.imageRoute('generate').entries).toEqual(['openai/gpt-image-2']);
      expect(store.imageRoute('edit').entries).toEqual(['omniroute/both-operations']);
    } finally { await cleanup(); }
  });
});
