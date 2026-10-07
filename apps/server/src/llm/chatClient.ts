import type OpenAI from 'openai';
import type {
  ChatCompletionChunk,
  ChatCompletionContentPart,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import type { ModelCapabilities, Price } from '../agent/models.js';
import type { ToolResultContent } from '../agent/types.js';
import { toLlmError } from './errors.js';
import { LlmError, type ConversationItem, type ModelClient, type ToolCall, type TurnRequest, type TurnResult } from './types.js';

/** The part of the OpenAI SDK the Chat Completions client uses (lets tests inject a fake). */
export interface ChatCompletionsApi {
  create(params: ChatCompletionCreateParamsStreaming, options?: { signal?: AbortSignal }): Promise<AsyncIterable<ChatCompletionChunk>>;
}

export function chatApiOf(client: OpenAI): ChatCompletionsApi {
  return { create: (params, options) => client.chat.completions.create(params, options) };
}

function toolText(content: ToolResultContent, ok: boolean): { text: string; images: Array<{ mimeType: string; data: string }> } {
  const images: Array<{ mimeType: string; data: string }> = [];
  let text: string;
  if (typeof content === 'string') {
    text = content;
  } else {
    const parts: string[] = [];
    for (const block of content) {
      if (block.type === 'text') parts.push(block.text);
      else {
        images.push({ mimeType: block.mimeType, data: block.data });
        parts.push(`[image ${images.length}]`);
      }
    }
    text = parts.join('\n');
  }
  if (!text.trim()) text = '(empty result)';
  return { text: ok ? text : `ERROR: ${text}`, images };
}

/**
 * Neutral transcript -> Chat Completions messages. Tool results that carry images are followed by one user
 * message with the images (tool messages are text-only on most providers).
 */
export function toChatMessages(instructions: string, history: ConversationItem[], vision: boolean): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [{ role: 'system', content: instructions }];
  let pendingImages: Array<{ mimeType: string; data: string }> = [];
  const flushImages = () => {
    if (!pendingImages.length) return;
    const parts: ChatCompletionContentPart[] = [{ type: 'text', text: 'Images returned by the tool calls above, in order:' }];
    for (const img of pendingImages) parts.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}` } });
    messages.push({ role: 'user', content: parts });
    pendingImages = [];
  };
  for (const item of history) {
    if (item.role !== 'tool') flushImages();
    if (item.role === 'user') {
      messages.push({ role: 'user', content: item.text });
    } else if (item.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: item.text || null,
        ...(item.calls.length
          ? { tool_calls: item.calls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.arguments || '{}' } })) }
          : {}),
      });
    } else {
      const { text, images } = toolText(item.content, item.ok);
      messages.push({
        role: 'tool',
        tool_call_id: item.callId,
        content: images.length && !vision ? `${text}\n(${images.length} image(s) omitted: this model does not accept images)` : text,
      });
      if (vision) pendingImages.push(...images);
    }
  }
  flushImages();
  return messages;
}

/** Splits streamed text into answer and <think>...</think> reasoning (used by several open models). */
export class ThinkTagSplitter {
  private inThink = false;
  private buffer = '';

  constructor(
    private readonly onText: (s: string) => void,
    private readonly onThink: (s: string) => void,
  ) {}

  push(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const tag = this.inThink ? '</think>' : '<think>';
      const at = this.buffer.indexOf(tag);
      if (at >= 0) {
        this.emit(this.buffer.slice(0, at));
        this.buffer = this.buffer.slice(at + tag.length);
        this.inThink = !this.inThink;
        continue;
      }
      // keep a possible partial tag at the end for the next chunk
      let keep = 0;
      for (let n = Math.min(tag.length - 1, this.buffer.length); n > 0; n--) {
        if (tag.startsWith(this.buffer.slice(-n))) {
          keep = n;
          break;
        }
      }
      this.emit(this.buffer.slice(0, this.buffer.length - keep));
      this.buffer = this.buffer.slice(this.buffer.length - keep);
      return;
    }
  }

  end(): void {
    this.emit(this.buffer);
    this.buffer = '';
  }

  private emit(s: string): void {
    if (!s) return;
    if (this.inThink) this.onThink(s);
    else this.onText(s);
  }
}

export interface ChatClientOptions {
  key: string;
  providerId: string;
  providerName: string;
  model: string;
  capabilities: ModelCapabilities;
  price: Price | undefined;
  /** Reasoning effort to send (only when set). */
  effort: string | undefined;
  maxTokensParam: 'max_tokens' | 'max_completion_tokens';
  vision: boolean;
  api: ChatCompletionsApi;
}

interface PartialCall {
  id: string;
  name: string;
  arguments: string;
}

export function createChatClient(opts: ChatClientOptions): ModelClient {
  return {
    key: opts.key,
    providerId: opts.providerId,
    providerName: opts.providerName,
    model: opts.model,
    capabilities: opts.capabilities,
    price: opts.price,
    async turn(req: TurnRequest): Promise<TurnResult> {
      const tools: ChatCompletionTool[] = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      const params: ChatCompletionCreateParamsStreaming = {
        model: opts.model,
        messages: toChatMessages(req.instructions, req.history, opts.vision),
        ...(tools.length ? { tools, tool_choice: 'auto' as const } : {}),
        stream: true,
        stream_options: { include_usage: true },
        [opts.maxTokensParam]: req.maxOutputTokens,
        ...(opts.effort ? { reasoning_effort: opts.effort as ChatCompletionCreateParamsStreaming['reasoning_effort'] } : {}),
      };

      let text = '';
      let thinking = '';
      let refusal = '';
      let finish: string | null = null;
      let model = opts.model;
      let usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
      const calls = new Map<number, PartialCall>();
      const thinkKey = 'think:0';
      const splitter = new ThinkTagSplitter(
        (s) => {
          text += s;
          req.onText(s);
        },
        (s) => {
          thinking += s;
          req.onThinking(s, thinkKey);
        },
      );

      try {
        const stream = await opts.api.create(params, { signal: req.signal });
        for await (const chunk of stream) {
          if (chunk.model) model = chunk.model;
          if (chunk.usage) {
            const cached = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
            usage = {
              inputTokens: Math.max(0, (chunk.usage.prompt_tokens ?? 0) - cached),
              outputTokens: chunk.usage.completion_tokens ?? 0,
              cacheReadTokens: cached,
              cacheWriteTokens: 0,
            };
          }
          const choice = chunk.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta as (typeof choice.delta & { reasoning_content?: string | null; reasoning?: string | null }) | undefined;
          if (delta) {
            const reasoning = delta.reasoning_content ?? delta.reasoning;
            if (typeof reasoning === 'string' && reasoning) {
              thinking += reasoning;
              req.onThinking(reasoning, thinkKey);
            }
            if (typeof delta.content === 'string' && delta.content) splitter.push(delta.content);
            if (typeof delta.refusal === 'string') refusal += delta.refusal;
            for (const tc of delta.tool_calls ?? []) {
              const index = tc.index ?? calls.size;
              const current = calls.get(index) ?? { id: '', name: '', arguments: '' };
              if (tc.id) current.id = tc.id;
              if (tc.function?.name) current.name += tc.function.name;
              if (tc.function?.arguments) current.arguments += tc.function.arguments;
              calls.set(index, current);
            }
          }
          if (choice.finish_reason) finish = choice.finish_reason;
        }
        splitter.end();
      } catch (err) {
        if (req.signal.aborted) throw req.signal.reason ?? err;
        throw toLlmError(err, opts.providerName, opts.model, false);
      }

      if (!finish) {
        throw Object.assign(new LlmError('cut', `Koneksi ke ${opts.providerName} terputus sebelum respons selesai. Kirim ulang task.`), { usage });
      }

      const toolCalls: ToolCall[] = [...calls.entries()]
        .sort(([a], [b]) => a - b)
        .filter(([, c]) => c.name)
        .map(([index, c]) => ({ id: c.id || `call_${index}_${Math.random().toString(36).slice(2, 10)}`, name: c.name, arguments: c.arguments }));

      const incomplete = finish === 'length' ? 'max_output_tokens' : finish === 'content_filter' ? 'content_filter' : undefined;
      return {
        status: incomplete ? 'incomplete' : 'completed',
        incompleteReason: incomplete,
        texts: text.trim() ? [text.trim()] : [],
        thinking: thinking.trim() ? [thinking.trim()] : [],
        refusal: refusal.trim() || undefined,
        calls: toolCalls,
        usage,
        model,
      };
    },
  };
}
