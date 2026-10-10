import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { PluginConfig } from '@solar/shared';
import { SECRET_MASK } from '@solar/shared';
import { both, LocalizedError } from '../i18n.js';
import { writeFileAtomic } from '../util/fs.js';
import { slugify } from '../util/ids.js';

const stringRecord = z.record(z.string(), z.string());

export const PluginConfigBaseSchema = z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'id must be lower-case letters, digits or dashes'),
    name: z.string().min(1).max(80),
    description: z.string().max(500).default(''),
    preset: z.enum(['github', 'plane', 'visual-paradigm', 'custom']).default('custom'),
    enabled: z.boolean().default(true),
    transport: z.enum(['stdio', 'http', 'sse']),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: stringRecord.optional(),
    url: z.string().optional(),
    headers: stringRecord.optional(),
    confirm: z.enum(['never', 'writes', 'always']).default('writes'),
    toolAllowlist: z.array(z.string()).optional(),
    toolDenylist: z.array(z.string()).optional(),
});

export const PluginConfigSchema = PluginConfigBaseSchema.superRefine((p, ctx) => {
    if (p.transport === 'stdio' && !p.command?.trim()) {
      ctx.addIssue({ code: 'custom', path: ['command'], message: 'command is required for stdio plugins' });
    }
    if (p.transport !== 'stdio' && !p.url?.trim()) {
      ctx.addIssue({ code: 'custom', path: ['url'], message: 'url is required for http/sse plugins' });
    }
  });

export type PluginInput = z.input<typeof PluginConfigSchema>;

const VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Values that only reference environment variables are not secret and are shown as-is. */
function isReferenceOnly(value: string): boolean {
  return value.replace(VAR_RE, '').replace(/^(Bearer|Basic|token)\s+/i, '').trim() === '';
}

export interface ResolvedPlugin {
  config: PluginConfig;
  env: Record<string, string>;
  headers: Record<string, string>;
  url: string | undefined;
  args: string[];
  command: string | undefined;
  missingVars: string[];
}

export function interpolate(value: string, env: NodeJS.ProcessEnv, missing: Set<string>): string {
  return value.replace(VAR_RE, (_, name: string) => {
    const v = env[name];
    if (v === undefined || v === '') {
      missing.add(name);
      return '';
    }
    return v;
  });
}

export function resolvePlugin(config: PluginConfig, env: NodeJS.ProcessEnv = process.env): ResolvedPlugin {
  const missing = new Set<string>();
  const map = (rec?: Record<string, string>) =>
    Object.fromEntries(Object.entries(rec ?? {}).map(([k, v]) => [k, interpolate(v, env, missing)]));
  return {
    config,
    env: map(config.env),
    headers: map(config.headers),
    url: config.url === undefined ? undefined : interpolate(config.url, env, missing),
    args: (config.args ?? []).map((a) => interpolate(a, env, missing)),
    command: config.command === undefined ? undefined : interpolate(config.command, env, missing),
    missingVars: [...missing].sort(),
  };
}

function maskRecord(rec?: Record<string, string>): Record<string, string> | undefined {
  if (!rec) return undefined;
  return Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, isReferenceOnly(v) ? v : SECRET_MASK]));
}

/** Returns a copy that is safe to send to the browser (literal secrets replaced by a mask). */
export function maskPlugin(config: PluginConfig): PluginConfig {
  return { ...config, env: maskRecord(config.env), headers: maskRecord(config.headers) };
}

function unmaskRecord(next?: Record<string, string>, prev?: Record<string, string>): Record<string, string> | undefined {
  if (!next) return undefined;
  return Object.fromEntries(Object.entries(next).map(([k, v]) => [k, v === SECRET_MASK ? (prev?.[k] ?? '') : v]));
}

/** Persists MCP plugin definitions in <dataDir>/plugins.json (seeded from config/plugins.default.json). */
export class PluginStore {
  private readonly file: string;
  private plugins: PluginConfig[] = [];

  constructor(
    dataDir: string,
    private readonly defaultsFile: string,
  ) {
    this.file = join(dataDir, 'plugins.json');
  }

  async init(): Promise<void> {
    if (existsSync(this.file)) {
      this.plugins = z.array(PluginConfigSchema).parse(JSON.parse(await readFile(this.file, 'utf8'))) as PluginConfig[];
      return;
    }
    if (existsSync(this.defaultsFile)) {
      this.plugins = z.array(PluginConfigSchema).parse(JSON.parse(await readFile(this.defaultsFile, 'utf8'))) as PluginConfig[];
    }
    await this.save();
  }

  private async save(): Promise<void> {
    await writeFileAtomic(this.file, JSON.stringify(this.plugins, null, 2));
  }

  list(): PluginConfig[] {
    return this.plugins.map((p) => ({ ...p }));
  }

  get(id: string): PluginConfig | undefined {
    const p = this.plugins.find((x) => x.id === id);
    return p ? { ...p } : undefined;
  }

  /** `id` may be omitted: it is then derived from the name. */
  async create(input: Omit<PluginInput, 'id'> & { id?: string }): Promise<PluginConfig> {
    // ids are limited to 40 characters (see PluginConfigBaseSchema); slugify allows longer names
    const derived = slugify(input.name ?? 'plugin', 'plugin').slice(0, 40).replace(/-+$/, '') || 'plugin';
    const candidate = { ...input, id: input.id?.trim() ? input.id : derived };
    const config = PluginConfigSchema.parse(candidate) as PluginConfig;
    if (this.plugins.some((p) => p.id === config.id)) throw new LocalizedError(both('store.plugin.exists', { id: config.id }), 'en');
    this.plugins.push(config);
    await this.save();
    return config;
  }

  async update(id: string, input: Partial<PluginInput>): Promise<PluginConfig> {
    const index = this.plugins.findIndex((p) => p.id === id);
    if (index < 0) throw new LocalizedError(both('store.plugin.notFound', { id }), 'en');
    const prev = this.plugins[index]!;
    const merged = {
      ...prev,
      ...input,
      id,
      env: input.env === undefined ? prev.env : unmaskRecord(input.env, prev.env),
      headers: input.headers === undefined ? prev.headers : unmaskRecord(input.headers, prev.headers),
    };
    const config = PluginConfigSchema.parse(merged) as PluginConfig;
    this.plugins[index] = config;
    await this.save();
    return config;
  }

  async remove(id: string): Promise<void> {
    const before = this.plugins.length;
    this.plugins = this.plugins.filter((p) => p.id !== id);
    if (this.plugins.length === before) throw new LocalizedError(both('store.plugin.notFound', { id }), 'en');
    await this.save();
  }
}
