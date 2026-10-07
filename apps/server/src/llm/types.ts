import type { ToolResultContent } from '../agent/types.js';
import type { ModelCapabilities, Price, TokenUsage } from '../agent/models.js';

/**
 * Provider-neutral conversation. The agent keeps this transcript; each adapter converts it to its own API
 * format. `native` keeps an adapter's raw output (e.g. encrypted reasoning items of the Responses API) so the
 * same model gets it back verbatim, while a fallback model is fed from the neutral fields.
 */
export type ConversationItem =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; calls: ToolCall[]; native?: { clientKey: string; items: unknown[] } }
  | { role: 'tool'; callId: string; name: string; content: ToolResultContent; ok: boolean };

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON arguments as produced by the model. */
  arguments: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface TurnRequest {
  instructions: string;
  history: ConversationItem[];
  tools: ToolSpec[];
  maxOutputTokens: number;
  signal: AbortSignal;
  onText(delta: string): void;
  /** `key` changes when a new reasoning summary block starts. */
  onThinking(delta: string, key: string): void;
}

export interface TurnResult {
  status: 'completed' | 'incomplete';
  /** For incomplete turns: max_output_tokens, content_filter, ... */
  incompleteReason?: string;
  texts: string[];
  /** Complete reasoning summaries of this turn (shown in the timeline). */
  thinking: string[];
  refusal?: string;
  calls: ToolCall[];
  usage: TokenUsage;
  /** The model that answered (providers may return a dated snapshot id). */
  model: string;
  native?: unknown[];
}

export interface ModelClient {
  /** "<provider>/<model>" - unique per route entry. */
  readonly key: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly model: string;
  readonly capabilities: ModelCapabilities;
  /** Price override for cost estimates (undefined = built-in table). */
  readonly price: Price | undefined;
  turn(req: TurnRequest): Promise<TurnResult>;
}

export type LlmErrorKind =
  | 'config'
  | 'connection'
  | 'auth'
  | 'quota'
  | 'rate_limit'
  | 'not_found'
  | 'permission'
  | 'bad_request'
  | 'server'
  | 'failed'
  | 'cut';

/** A model call that failed. `fallback` = another model may succeed where this one did not. */
export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly fallback = true,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}
