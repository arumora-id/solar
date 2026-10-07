import { toResponseInputItems } from 'openai/lib/responses/ResponseInputItems';
import type { ResponseCreateAndStreamParams } from 'openai/lib/responses/ResponseStream';
import type {
  FunctionTool,
  Response as ModelResponse,
  ResponseFunctionCallOutputItemList,
  ResponseFunctionToolCall,
  ResponseInputItem,
} from 'openai/resources/responses/responses';
import type { ModelCapabilities, Price } from '../agent/models.js';
import type { ToolResultContent } from '../agent/types.js';
import { toLlmError } from './errors.js';
import { LlmError, type ConversationItem, type ModelClient, type ToolCall, type TurnRequest, type TurnResult } from './types.js';

export type StreamParams = ResponseCreateAndStreamParams;

export interface StreamDeltaEvent {
  delta: string;
  item_id?: string;
  summary_index?: number;
}

/** The part of the OpenAI SDK's ResponseStream the client uses (lets tests inject a scripted model). */
export interface ResponseStreamLike {
  on(event: 'response.output_text.delta' | 'response.reasoning_summary_text.delta', listener: (event: StreamDeltaEvent) => void): unknown;
  finalResponse(): Promise<ModelResponse>;
}

export interface ResponsesStreamer {
  stream(params: StreamParams, options?: { signal?: AbortSignal }): ResponseStreamLike;
}

/** Shared by every task: the frozen instructions + tool list prefix is identical, so caching works across tasks. */
const PROMPT_CACHE_KEY = 'solar-agent';

/** Converts a tool result to the Responses API `function_call_output.output` format. */
export function toFunctionOutput(content: ToolResultContent, ok: boolean): string | ResponseFunctionCallOutputItemList {
  if (typeof content === 'string') {
    const text = content.trim() ? content : '(empty result)';
    return ok ? text : `ERROR: ${text}`;
  }
  const items: ResponseFunctionCallOutputItemList = content.map((block) =>
    block.type === 'text'
      ? { type: 'input_text', text: block.text }
      : { type: 'input_image', image_url: `data:${block.mimeType};base64,${block.data}`, detail: 'auto' },
  );
  if (!items.length) items.push({ type: 'input_text', text: '(empty result)' });
  if (!ok) items.unshift({ type: 'input_text', text: 'ERROR:' });
  return items;
}

/** Neutral transcript -> Responses API input. The client's own earlier output is replayed verbatim. */
export function toResponsesInput(history: ConversationItem[], clientKey: string): ResponseInputItem[] {
  const input: ResponseInputItem[] = [];
  for (const item of history) {
    if (item.role === 'user') {
      input.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text: item.text }] });
    } else if (item.role === 'assistant') {
      if (item.native && item.native.clientKey === clientKey) {
        input.push(...(item.native.items as ResponseInputItem[]));
        continue;
      }
      if (item.text) input.push({ type: 'message', role: 'assistant', content: item.text });
      for (const call of item.calls) input.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments });
    } else {
      input.push({ type: 'function_call_output', call_id: item.callId, output: toFunctionOutput(item.content, item.ok) });
    }
  }
  return input;
}

export interface ResponsesClientOptions {
  key: string;
  providerId: string;
  providerName: string;
  model: string;
  capabilities: ModelCapabilities;
  price: Price | undefined;
  effort: string;
  /** The provider is the one from OPENAI_* in .env (error hints mention .env). */
  envProvider: boolean;
  streamer: ResponsesStreamer;
}

export function createResponsesClient(opts: ResponsesClientOptions): ModelClient {
  const { capabilities: caps } = opts;
  return {
    key: opts.key,
    providerId: opts.providerId,
    providerName: opts.providerName,
    model: opts.model,
    capabilities: caps,
    price: opts.price,
    async turn(req: TurnRequest): Promise<TurnResult> {
      const tools: FunctionTool[] = req.tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: false }));
      const params: StreamParams = {
        model: opts.model,
        instructions: req.instructions,
        input: toResponsesInput(req.history, opts.key),
        tools,
        tool_choice: 'auto',
        parallel_tool_calls: true,
        max_output_tokens: req.maxOutputTokens,
        // stateless: nothing is stored at the provider; reasoning is carried forward as encrypted items
        store: false,
        prompt_cache_key: PROMPT_CACHE_KEY,
        ...(caps.reasoning
          ? {
              reasoning: { effort: opts.effort as NonNullable<NonNullable<StreamParams['reasoning']>['effort']>, summary: 'auto' as const },
              include: ['reasoning.encrypted_content' as const],
            }
          : {}),
      };

      let response: ModelResponse;
      try {
        const stream = opts.streamer.stream(params, { signal: req.signal });
        stream.on('response.output_text.delta', (e) => req.onText(e.delta));
        stream.on('response.reasoning_summary_text.delta', (e) => req.onThinking(e.delta, `${e.item_id ?? ''}:${e.summary_index ?? 0}`));
        response = await stream.finalResponse();
      } catch (err) {
        if (req.signal.aborted) throw req.signal.reason ?? err;
        throw toLlmError(err, opts.providerName, opts.model, opts.envProvider);
      }

      const u = response.usage;
      const cached = u?.input_tokens_details?.cached_tokens ?? 0;
      const cacheWrite = (u?.input_tokens_details as { cache_write_tokens?: number } | undefined)?.cache_write_tokens ?? 0;
      const usage = {
        inputTokens: Math.max(0, (u?.input_tokens ?? 0) - cached - cacheWrite),
        outputTokens: u?.output_tokens ?? 0,
        cacheReadTokens: cached,
        cacheWriteTokens: cacheWrite,
      };

      if (response.status === 'failed') {
        throw Object.assign(new LlmError('failed', `${opts.providerName} gagal memproses permintaan: ${response.error?.message ?? 'unknown error'}`), { usage });
      }
      // the SDK resolves a stream that ended without a terminal event with the partial snapshot
      if (response.status !== 'completed' && response.status !== 'incomplete') {
        throw Object.assign(
          new LlmError('cut', `Koneksi ke ${opts.providerName} terputus sebelum respons selesai (status ${response.status ?? 'unknown'}). Kirim ulang task.`),
          { usage },
        );
      }

      const texts: string[] = [];
      const thinking: string[] = [];
      let refusal: string | undefined;
      for (const item of response.output) {
        if (item.type === 'reasoning') {
          const summary = item.summary.map((part) => part.text.trim()).filter(Boolean).join('\n\n');
          if (summary) thinking.push(summary);
        } else if (item.type === 'message') {
          for (const part of item.content) {
            if (part.type === 'output_text' && part.text.trim()) texts.push(part.text.trim());
            else if (part.type === 'refusal' && part.refusal.trim()) refusal = part.refusal.trim();
          }
        }
      }
      const calls: ToolCall[] = response.output
        .filter((item): item is ResponseFunctionToolCall => item.type === 'function_call')
        .map((c) => ({ id: c.call_id, name: c.name, arguments: c.arguments }));

      return {
        status: response.status,
        incompleteReason: response.incomplete_details?.reason ?? undefined,
        texts,
        thinking,
        refusal,
        calls,
        usage,
        model: response.model || opts.model,
        // toResponseInputItems strips SDK-only fields (parsed, parsed_arguments) the API would reject
        native: toResponseInputItems(response.output),
      };
    },
  };
}
