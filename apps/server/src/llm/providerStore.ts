import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { SECRET_MASK, type LlmProviderConfig, type LlmProviderView, type LlmSettingsView } from '@solar/shared';
import { REASONING_EFFORTS, type AppConfig } from '../config.js';
import { interpolate } from '../plugins/pluginStore.js';
import { both, LocalizedError } from '../i18n.js';
import { schemaMessage } from '../i18n/zodIssues.js';
import { writeFileAtomic } from '../util/fs.js';
import { slugify } from '../util/ids.js';

/** The provider defined by OPENAI_* in .env. Always present, read-only in the UI. */
export const ENV_PROVIDER_ID = 'openai';
export const DEFAULT_ROUTE = 'default';
/** Image endpoints use independent routes; they do not change the chat model. */
export const IMAGE_GENERATION_ROUTE = 'image-generation';
export const IMAGE_EDIT_ROUTE = 'image-edit';
/** A single image model route used for both API operations, when configured. */
export const IMAGE_ROUTE = 'image';
export const DEFAULT_IMAGE_MODEL = 'gpt-image-2';

const VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

const PriceSchema = z.object({ input: z.number().min(0), cachedInput: z.number().min(0), output: z.number().min(0) });

export const LlmModelSchema = z.object({
  id: z.string().trim().min(1).max(200),
  label: z.string().trim().max(120).optional(),
  reasoning: z.boolean().optional(),
  effort: z.enum(REASONING_EFFORTS).optional(),
  maxOutputTokens: z.number().int().min(256).max(1_000_000).optional(),
  imageGeneration: z.boolean().optional(),
  imageEditing: z.boolean().optional(),
  price: PriceSchema.optional(),
});

export const LlmProviderBaseSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, schemaMessage('validation.idFormat'))
    .refine((id) => id !== ENV_PROVIDER_ID, schemaMessage('validation.reservedProviderId', { id: ENV_PROVIDER_ID })),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['openai-responses', 'openai-chat']),
  enabled: z.boolean().default(true),
  baseUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === '' || /^https?:\/\//i.test(v) || /^\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(v), schemaMessage('validation.baseUrl'))
    .optional(),
  apiKey: z.string().max(4000).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  maxTokensParam: z.enum(['max_tokens', 'max_completion_tokens']).optional(),
  vision: z.boolean().optional(),
  models: z.array(LlmModelSchema).max(100).default([]),
});

const RouteSchema = z.array(z.string().trim().regex(/^[a-z0-9][a-z0-9-]*\/.+$/, schemaMessage('validation.routeEntry'))).max(10);
export const RoutesSchema = z.record(z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, schemaMessage('validation.routeName')), RouteSchema);

const FileSchema = z.object({
  providers: z.array(LlmProviderBaseSchema).default([]),
  routes: RoutesSchema.default({}),
});

export type LlmProviderInput = z.input<typeof LlmProviderBaseSchema>;

/** "provider/model" -> parts. Model ids may contain "/" themselves (e.g. OpenRouter "anthropic/claude-..."). */
export function splitRouteEntry(entry: string): { providerId: string; model: string } {
  const at = entry.indexOf('/');
  return { providerId: entry.slice(0, at), model: entry.slice(at + 1) };
}

function isReferenceOnly(value: string): boolean {
  return value.replace(VAR_RE, '').replace(/^(Bearer|Basic|token)\s+/i, '').trim() === '';
}

const maskValue = (v: string | undefined) => (v === undefined || v === '' || isReferenceOnly(v) ? v : SECRET_MASK);

function maskRecord(rec?: Record<string, string>): Record<string, string> | undefined {
  return rec && Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, maskValue(v) ?? '']));
}

export interface ResolvedProvider {
  config: LlmProviderConfig;
  source: 'env' | 'user';
  apiKey: string | undefined;
  baseUrl: string | undefined;
  headers: Record<string, string>;
  organization?: string;
  project?: string;
  missingVars: string[];
}

/**
 * LLM providers and model routes, stored in <dataDir>/llm.json. The provider from .env (OPENAI_*) is always
 * available as "openai"; without a saved route the agent uses "openai/<SOLAR_MODEL>", exactly as before.
 */
export class LlmProviderStore {
  private readonly file: string;
  private providers: LlmProviderConfig[] = [];
  private routes: Record<string, string[]> = {};

  constructor(
    private readonly config: AppConfig,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    this.file = join(config.dataDir, 'llm.json');
  }

  async init(): Promise<void> {
    if (!existsSync(this.file)) return;
    const parsed = FileSchema.parse(JSON.parse(await readFile(this.file, 'utf8')));
    this.providers = parsed.providers as LlmProviderConfig[];
    this.routes = parsed.routes;
  }

  private async save(): Promise<void> {
    await writeFileAtomic(this.file, JSON.stringify({ providers: this.providers, routes: this.routes }, null, 2));
  }

  private envProvider(): LlmProviderConfig {
    return {
      id: ENV_PROVIDER_ID,
      name: 'OpenAI',
      kind: 'openai-responses',
      enabled: true,
      baseUrl: this.config.openai.baseUrl,
      apiKey: this.config.openai.apiKey,
      models: [{ id: this.config.openai.model }],
    };
  }

  /** All providers: the .env provider first, then the user's. */
  all(): Array<{ config: LlmProviderConfig; source: 'env' | 'user' }> {
    return [{ config: this.envProvider(), source: 'env' as const }, ...this.providers.map((p) => ({ config: { ...p }, source: 'user' as const }))];
  }

  get(id: string): { config: LlmProviderConfig; source: 'env' | 'user' } | undefined {
    return this.all().find((p) => p.config.id === id);
  }

  resolve(id: string): ResolvedProvider | undefined {
    const found = this.get(id);
    if (!found) return undefined;
    const { config, source } = found;
    if (source === 'env') {
      return {
        config,
        source,
        apiKey: this.config.openai.apiKey,
        baseUrl: this.config.openai.baseUrl,
        headers: {},
        organization: this.config.openai.organization,
        project: this.config.openai.project,
        missingVars: [],
      };
    }
    const missing = new Set<string>();
    const sub = (v: string | undefined) => (v === undefined ? undefined : interpolate(v, this.env, missing).trim() || undefined);
    const headers = Object.fromEntries(Object.entries(config.headers ?? {}).map(([k, v]) => [k, interpolate(v, this.env, missing)]));
    return {
      config,
      source,
      apiKey: sub(config.apiKey),
      baseUrl: sub(config.baseUrl)?.replace(/\/+$/, ''),
      headers,
      missingVars: [...missing].sort(),
    };
  }

  /** The routes in effect ("default" falls back to the .env model). */
  effectiveRoutes(): Record<string, string[]> {
    const routes = { ...this.routes };
    if (!routes[DEFAULT_ROUTE]?.length) routes[DEFAULT_ROUTE] = [`${ENV_PROVIDER_ID}/${this.config.openai.model}`];
    return routes;
  }

  route(name = DEFAULT_ROUTE): string[] {
    const routes = this.effectiveRoutes();
    if (routes[name]?.length) return routes[name]!;
    if (name === IMAGE_GENERATION_ROUTE || name === IMAGE_EDIT_ROUTE) return [`${ENV_PROVIDER_ID}/${DEFAULT_IMAGE_MODEL}`];
    return routes[DEFAULT_ROUTE]!;
  }

  /**
   * Model API capabilities are independent of the provider's chat transport.
   * Priority: explicit shared image model, existing v1.0.5 operation routes,
   * a unique capability-marked model, then the legacy .env image default.
   * Never fall through to the chat model route.
   */
  imageRoute(operation: 'generate' | 'edit'): { entries: string[]; requireCapability: boolean } {
    const shared = this.routes[IMAGE_ROUTE];
    if (shared?.length) return { entries: shared, requireCapability: true };
    const legacy = this.routes[operation === 'generate' ? IMAGE_GENERATION_ROUTE : IMAGE_EDIT_ROUTE];
    if (legacy?.length) return { entries: legacy, requireCapability: false };
    const capability = operation === 'generate' ? 'imageGeneration' : 'imageEditing';
    const eligible = this.all().flatMap(({ config }) =>
      config.enabled ? config.models.filter((model) => model[capability] === true)
        .map((model) => `${config.id}/${model.id}`) : [],
    );
    if (eligible.length === 1) return { entries: eligible, requireCapability: true };
    return { entries: [`${ENV_PROVIDER_ID}/${DEFAULT_IMAGE_MODEL}`], requireCapability: false };
  }

  view(): LlmSettingsView {
    const providers: LlmProviderView[] = this.all().map(({ config, source }) => {
      const r = this.resolve(config.id)!;
      return {
        ...config,
        apiKey: maskValue(config.apiKey),
        headers: maskRecord(config.headers),
        source,
        ready: Boolean(r.apiKey) || (source === 'user' && Boolean(r.baseUrl)),
        missingVars: r.missingVars,
      };
    });
    return { providers, routes: this.effectiveRoutes() };
  }

  async create(input: Omit<LlmProviderInput, 'id'> & { id?: string }): Promise<LlmProviderConfig> {
    const derived = slugify(input.name ?? 'provider', 'provider').slice(0, 40).replace(/-+$/, '') || 'provider';
    const config = LlmProviderBaseSchema.parse({ ...input, id: input.id?.trim() ? input.id : derived }) as LlmProviderConfig;
    if (this.get(config.id)) throw new LocalizedError(both('store.provider.exists', { id: config.id }), 'en');
    this.providers.push(config);
    await this.save();
    return config;
  }

  async update(id: string, input: Partial<LlmProviderInput>): Promise<LlmProviderConfig> {
    const index = this.providers.findIndex((p) => p.id === id);
    if (index < 0) {
      throw new LocalizedError(id === ENV_PROVIDER_ID ? both('store.provider.envProvider') : both('store.provider.notFound', { id }), 'en');
    }
    const prev = this.providers[index]!;
    const headers =
      input.headers === undefined
        ? prev.headers
        : Object.fromEntries(Object.entries(input.headers).map(([k, v]) => [k, v === SECRET_MASK ? (prev.headers?.[k] ?? '') : v]));
    const merged = { ...prev, ...input, id, apiKey: input.apiKey === SECRET_MASK ? prev.apiKey : (input.apiKey ?? prev.apiKey), headers };
    const config = LlmProviderBaseSchema.parse(merged) as LlmProviderConfig;
    this.providers[index] = config;
    await this.save();
    return config;
  }

  async remove(id: string): Promise<void> {
    const before = this.providers.length;
    this.providers = this.providers.filter((p) => p.id !== id);
    if (this.providers.length === before) throw new LocalizedError(both('store.provider.notFound', { id }), 'en');
    // routes may keep naming it; they skip unknown providers with a warning
    await this.save();
  }

  async setRoutes(routes: Record<string, string[]>): Promise<Record<string, string[]>> {
    const parsed = RoutesSchema.parse(routes);
    for (const [name, entries] of Object.entries(parsed)) {
      for (const entry of entries) {
        const { providerId, model } = splitRouteEntry(entry);
        const found = this.get(providerId);
        if (!found) throw new LocalizedError(both('store.provider.unknownInRoute', { route: name, entry }), 'en');
        if (name === IMAGE_ROUTE) {
          const declared = found.config.models.find((candidate) => candidate.id === model);
          if (!declared || (declared.imageGeneration !== true && declared.imageEditing !== true)) {
            throw new Error(`Image model "${entry}" must be declared with imageGeneration and/or imageEditing enabled in the provider model list`);
          }
        }
      }
    }
    this.routes = Object.fromEntries(Object.entries(parsed).filter(([, entries]) => entries.length > 0));
    await this.save();
    return this.effectiveRoutes();
  }
}
