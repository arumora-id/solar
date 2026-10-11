import type { Plugin } from 'esbuild';

export function embedAssets(options: { embed: boolean }): Plugin;
export function stripEmbeddedSources(mapFile: string): void;
export function wordRendererInWorkerOnly(): Plugin;
