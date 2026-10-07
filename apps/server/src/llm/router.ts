import OpenAI from 'openai';
import type { LlmModelConfig, LlmTestResult } from '@solar/shared';
import { capabilitiesOf, type ModelCapabilities } from '../agent/models.js';
import { APP_SLUG, APP_VERSION, type AppConfig } from '../config.js';
import { chatApiOf, createChatClient, type ChatCompletionsApi } from './chatClient.js';
import { toLlmError } from './errors.js';
import { DEFAULT_ROUTE, ENV_PROVIDER_ID, splitRouteEntry, type LlmProviderStore, type ResolvedProvider } from './providerStore.js';
import { createResponsesClient, type ResponsesStreamer } from './responsesClient.js';
import { LlmError, type ModelClient, type TurnRequest } from './types.js';

const OPENAI_NAME = /^(gpt-|o\d|chatgpt|codex)/i;
/** Output limit assumed for non-OpenAI chat models without an explicit maxOutputTokens. */
const DEFAULT_CHAT_MAX_OUTPUT = 16_384;

export function modelCapabilities(kind: string, model: string, override?: LlmModelConfig): ModelCapabilities {
  const base: ModelCapabilities =
    kind === 'openai-responses' || OPENAI_NAME.test(model) ? capabilitiesOf(model) : { reasoning: false, maxOutputTokens: DEFAULT_CHAT_MAX_OUTPUT };
  return {
    reasoning: override?.reasoning ?? base.reasoning,
    maxOutputTokens: override?.maxOutputTokens ?? base.maxOutputTokens,
  };
}

export interface ModelRouterDeps {
  config: AppConfig;
  store: LlmProviderStore;
  /** Test hook: replaces the Responses API transport of the .env provider. */
  envStreamer?: ResponsesStreamer;
  /** Test hook: Chat Completions transport per provider id. */
  chatApis?: Record<string, ChatCompletionsApi>;
}

/** A client whose construction failed: every call reports the configuration problem (and allows a fallback). */
function brokenClient(key: string, providerId: string, providerName: string, model: string, message: string): ModelClient {
  return {
    key,
    providerId,
    providerName,
    model,
    capabilities: { reasoning: false, maxOutputTokens: DEFAULT_CHAT_MAX_OUTPUT },
    price: undefined,
    turn: async (_req: TurnRequest) => {
      throw new LlmError('config', message);
    },
  };
}

/** Builds model clients for a route: primary first, then the fallbacks. Reads the store on every call. */
export class ModelRouter {
  private readonly sdkClients = new Map<string, { fingerprint: string; client: OpenAI }>();

  constructor(private readonly deps: ModelRouterDeps) {}

  /** Label for task records, e.g. "gpt-6.1-sol" or "omniroute/claude-x". */
  primaryLabel(route = DEFAULT_ROUTE): string {
    const first = this.deps.store.route(route)[0];
    if (!first) return this.deps.config.openai.model;
    const { providerId, model } = splitRouteEntry(first);
    return providerId === ENV_PROVIDER_ID ? model : first;
  }

  /** True when the primary model has a usable provider. */
  primaryReady(route = DEFAULT_ROUTE): boolean {
    const first = this.deps.store.route(route)[0];
    if (!first) return false;
    const r = this.deps.store.resolve(splitRouteEntry(first).providerId);
    return Boolean(r && r.config.enabled && (r.apiKey || (r.source === 'user' && r.baseUrl)));
  }

  private sdk(p: ResolvedProvider): OpenAI {
    const fingerprint = JSON.stringify([p.apiKey, p.baseUrl, p.headers, p.organization, p.project]);
    const cached = this.sdkClients.get(p.config.id);
    if (cached && cached.fingerprint === fingerprint) return cached.client;
    const client = new OpenAI({
      // keyless local endpoints (Ollama, vLLM, LM Studio) still need a non-empty value for the SDK
      apiKey: p.apiKey || 'not-needed',
      baseURL: p.baseUrl,
      organization: p.organization ?? null,
      project: p.project ?? null,
      defaultHeaders: { 'User-Agent': `${APP_SLUG}/${APP_VERSION}`, ...p.headers },
      maxRetries: 4,
      timeout: 15 * 60_000,
    });
    this.sdkClients.set(p.config.id, { fingerprint, client });
    return client;
  }

  clientsFor(route = DEFAULT_ROUTE): { clients: ModelClient[]; warnings: string[] } {
    const { config, store } = this.deps;
    const clients: ModelClient[] = [];
    const warnings: string[] = [];
    for (const entry of store.route(route)) {
      const { providerId, model } = splitRouteEntry(entry);
      const p = store.resolve(providerId);
      if (!p) {
        warnings.push(`Provider "${providerId}" untuk ${entry} tidak ditemukan; dilewati.`);
        continue;
      }
      if (!p.config.enabled) {
        warnings.push(`Provider "${p.config.name}" nonaktif; ${entry} dilewati.`);
        continue;
      }
      const env = p.source === 'env';
      const override = p.config.models.find((m) => m.id === model);
      const caps = modelCapabilities(p.config.kind, model, override);
      const price = override?.price ?? (env ? config.openai.price : undefined);
      const name = p.config.name;

      if (p.missingVars.length) {
        warnings.push(`Provider "${name}": variabel ${p.missingVars.join(', ')} belum diisi.`);
      }
      if (env && !p.apiKey && !this.deps.envStreamer) {
        clients.push(brokenClient(entry, providerId, name, model, 'OPENAI_API_KEY belum diisi: isi API key OpenAI di .env (lihat README) lalu restart SOLAR AI AGENT.'));
        continue;
      }
      if (!env && !p.apiKey && !p.baseUrl && !this.deps.chatApis?.[providerId]) {
        clients.push(brokenClient(entry, providerId, name, model, `Provider "${name}" belum punya API key atau base URL (Pengaturan → Model AI).`));
        continue;
      }

      if (p.config.kind === 'openai-responses') {
        const streamer: ResponsesStreamer =
          env && this.deps.envStreamer ? this.deps.envStreamer : { stream: (params, options) => this.sdk(p).responses.stream(params, options) };
        clients.push(
          createResponsesClient({
            key: entry,
            providerId,
            providerName: name,
            model,
            capabilities: caps,
            price,
            effort: override?.effort ?? config.openai.effort,
            envProvider: env,
            streamer,
          }),
        );
      } else {
        const isOpenAIHost = !p.baseUrl || /(^|\.)api\.openai\.com/i.test(new URL(p.baseUrl).hostname);
        clients.push(
          createChatClient({
            key: entry,
            providerId,
            providerName: name,
            model,
            capabilities: caps,
            price,
            effort: override?.effort ?? (caps.reasoning ? config.openai.effort : undefined),
            maxTokensParam: p.config.maxTokensParam ?? (isOpenAIHost ? 'max_completion_tokens' : 'max_tokens'),
            vision: p.config.vision ?? true,
            api: this.deps.chatApis?.[providerId] ?? chatApiOf(this.sdk(p)),
          }),
        );
      }
    }
    return { clients, warnings };
  }

  /** Checks a provider by listing its models (GET /models). */
  async test(providerId: string): Promise<LlmTestResult> {
    const p = this.deps.store.resolve(providerId);
    if (!p) return { ok: false, error: `Provider "${providerId}" tidak ditemukan` };
    if (p.source === 'env' && !p.apiKey) return { ok: false, error: 'OPENAI_API_KEY belum diisi di .env' };
    try {
      const models: string[] = [];
      for await (const m of this.sdk(p).models.list({ timeout: 20_000, maxRetries: 0 })) {
        models.push(m.id);
        if (models.length >= 500) break;
      }
      return { ok: true, models: models.sort() };
    } catch (err) {
      const mapped = toLlmError(err, p.config.name, '-', p.source === 'env');
      return { ok: false, error: mapped instanceof Error ? mapped.message : String(mapped) };
    }
  }
}
