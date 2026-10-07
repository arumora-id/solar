import OpenAI from 'openai';
import { toResponseInputItems } from 'openai/lib/responses/ResponseInputItems';
import type { ResponseCreateAndStreamParams } from 'openai/lib/responses/ResponseStream';
import type {
  FunctionTool,
  Response as ModelResponse,
  ResponseFunctionCallOutputItemList,
  ResponseFunctionToolCall,
  ResponseInputItem,
} from 'openai/resources/responses/responses';
import type { AppConfig } from '../config.js';
import { createLogger } from '../logger.js';
import type { McpManager } from '../plugins/mcpManager.js';
import type { PluginStore } from '../plugins/pluginStore.js';
import type { SkillStore } from '../skills/skillStore.js';
import type { AttachmentService } from '../tasks/attachmentService.js';
import type { TaskRunContext, TaskRunner } from '../tasks/taskManager.js';
import { documentsIntro } from './documentIntro.js';
import { createMcpTools } from './mcpTools.js';
import { capabilitiesOf, estimateCostUsd } from './models.js';
import { buildSystemPrompt } from './systemPrompt.js';
import type { AgentTool, ToolResultContent } from './types.js';

const log = createLogger('agent');

export type StreamParams = ResponseCreateAndStreamParams;

export interface StreamDeltaEvent {
  delta: string;
  item_id?: string;
  summary_index?: number;
}

/** The part of the OpenAI SDK's ResponseStream the agent uses (lets tests inject a scripted model). */
export interface ResponseStreamLike {
  on(event: 'response.output_text.delta' | 'response.reasoning_summary_text.delta', listener: (event: StreamDeltaEvent) => void): unknown;
  finalResponse(): Promise<ModelResponse>;
}

export interface ResponsesStreamer {
  stream(params: StreamParams, options?: { signal?: AbortSignal }): ResponseStreamLike;
}

export interface AgentDeps {
  config: AppConfig;
  responses: ResponsesStreamer;
  skills: SkillStore;
  plugins: PluginStore;
  mcp: McpManager;
  builtinTools: AgentTool[];
  attachments: AttachmentService;
}

const MAX_EVENT_INPUT_CHARS = 20_000;
/** Shared by every task: the frozen instructions + tool list prefix is identical, so caching works across tasks. */
const PROMPT_CACHE_KEY = 'solar-agent';

function previewInput(input: unknown): unknown {
  const text = JSON.stringify(input ?? null);
  if (text.length <= MAX_EVENT_INPUT_CHARS) return input;
  return { _preview: `${text.slice(0, MAX_EVENT_INPUT_CHARS)}…`, _note: `input truncated for the timeline (${text.length} characters)` };
}

function friendlyApiError(err: InstanceType<typeof OpenAI.APIError>, model: string): Error {
  if (err instanceof OpenAI.APIConnectionError) {
    return new Error(`Tidak dapat terhubung ke OpenAI API (cek koneksi internet / proxy / OPENAI_BASE_URL): ${err.message}`);
  }
  if (err instanceof OpenAI.AuthenticationError) {
    return new Error('Autentikasi OpenAI gagal: isi OPENAI_API_KEY yang valid di .env lalu restart SOLAR.');
  }
  if (err instanceof OpenAI.RateLimitError && err.code === 'insufficient_quota') {
    return new Error(
      'Saldo/kuota API OpenAI habis (insufficient_quota). Tambahkan kredit di platform.openai.com → Billing. Catatan: langganan ChatGPT Plus/Pro tidak termasuk kredit API.',
    );
  }
  if (err instanceof OpenAI.RateLimitError) {
    return new Error('Batas rate OpenAI tercapai setelah percobaan ulang otomatis. Tunggu sebentar lalu kirim ulang task.');
  }
  if (err instanceof OpenAI.NotFoundError) {
    return new Error(`Model "${model}" tidak ditemukan atau belum tersedia untuk API key/proyek ini. Ganti SOLAR_MODEL di .env. (${err.message})`);
  }
  if (err instanceof OpenAI.PermissionDeniedError) {
    return new Error(`Akses OpenAI ditolak untuk model/proyek ini: ${err.message}`);
  }
  if (err instanceof OpenAI.BadRequestError) {
    return new Error(`Permintaan ditolak oleh OpenAI API: ${err.message}`);
  }
  return new Error(`OpenAI API error${err.status ? ` ${err.status}` : ''}: ${err.message}`);
}

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

export function createAgentRunner(deps: AgentDeps): TaskRunner {
  const { config } = deps;

  return async (ctx: TaskRunContext) => {
    // Tools and instructions are frozen for the whole task: the input stays append-only,
    // which keeps the prompt cache warm and the encrypted reasoning items valid.
    const tools = [...deps.builtinTools, ...createMcpTools(deps.mcp)];
    const toolMap = new Map(tools.map((t) => [t.name, t]));
    const connected = deps.mcp.statuses().filter((s) => s.state === 'connected');
    const instructions = buildSystemPrompt({
      config,
      skills: await deps.skills.list(),
      plugins: connected
        .map((s) => ({ config: deps.plugins.get(s.id), toolCount: deps.mcp.bindings().filter((b) => b.plugin.id === s.id).length }))
        .filter((p): p is { config: NonNullable<typeof p.config>; toolCount: number } => Boolean(p.config)),
      builtinToolNames: deps.builtinTools.map((t) => t.name),
    });
    const apiTools: FunctionTool[] = tools.map((t) => ({
      type: 'function',
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
      strict: false,
    }));

    const today = new Date().toISOString().slice(0, 10);
    const intro = [
      `<task_context>\nDate: ${today}\nTask id: ${ctx.task.id}\n</task_context>`,
      ctx.sessionContext
        ? `<session_history>\nEarlier requests in this conversation (oldest first). Their artifacts can be read with read_artifact and their documents with read_document.\n${ctx.sessionContext}\n</session_history>`
        : '',
      await documentsIntro(ctx.attachments, deps.attachments),
      `<request>\n${ctx.task.prompt}\n</request>`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const input: ResponseInputItem[] = [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: intro }] }];

    const model = config.openai.model;
    const caps = capabilitiesOf(model);
    let maxTokens = Math.min(config.openai.maxTokens, caps.maxOutputTokens);
    let turns = 0;
    let lastText = '';

    await ctx.progress(2, 'Membaca permintaan');

    for (;;) {
      if (ctx.signal.aborted) throw ctx.signal.reason ?? new Error('Cancelled');
      turns += 1;
      if (turns > config.openai.maxTurns) {
        throw new Error(`Dihentikan setelah ${config.openai.maxTurns} giliran model (SOLAR_MAX_TURNS). Artefak yang sudah dibuat tetap tersimpan.`);
      }
      await ctx.step(turns === 1 ? 'Merencanakan' : 'Berpikir');

      const params: StreamParams = {
        model,
        instructions,
        input: [...input],
        tools: apiTools,
        tool_choice: 'auto',
        parallel_tool_calls: true,
        max_output_tokens: maxTokens,
        // stateless: nothing is stored at OpenAI; reasoning is carried forward as encrypted items
        store: false,
        prompt_cache_key: PROMPT_CACHE_KEY,
        ...(caps.reasoning
          ? { reasoning: { effort: config.openai.effort, summary: 'auto' as const }, include: ['reasoning.encrypted_content' as const] }
          : {}),
      };

      let response: ModelResponse;
      try {
        const stream = deps.responses.stream(params, { signal: ctx.signal });
        stream.on('response.output_text.delta', (e) => ctx.delta(e.delta, 'text'));
        let summaryKey = '';
        stream.on('response.reasoning_summary_text.delta', (e) => {
          const key = `${e.item_id ?? ''}:${e.summary_index ?? 0}`;
          if (summaryKey && key !== summaryKey) ctx.delta('\n\n', 'thinking');
          summaryKey = key;
          ctx.delta(e.delta, 'thinking');
        });
        response = await stream.finalResponse();
      } catch (err) {
        if (ctx.signal.aborted) throw ctx.signal.reason ?? err;
        if (err instanceof OpenAI.APIError) throw friendlyApiError(err, model);
        throw err;
      }

      const u = response.usage;
      const cached = u?.input_tokens_details?.cached_tokens ?? 0;
      const cacheWrite = u?.input_tokens_details?.cache_write_tokens ?? 0;
      const usage = {
        inputTokens: Math.max(0, (u?.input_tokens ?? 0) - cached - cacheWrite),
        outputTokens: u?.output_tokens ?? 0,
        cacheReadTokens: cached,
        cacheWriteTokens: cacheWrite,
      };
      await ctx.addUsage({ ...usage, costUsd: estimateCostUsd(response.model || model, usage, config.openai.price) });

      if (response.status === 'failed') {
        throw new Error(`OpenAI gagal memproses permintaan: ${response.error?.message ?? 'unknown error'}`);
      }
      // the SDK resolves a stream that ended without a terminal event with the partial snapshot
      if (response.status !== 'completed' && response.status !== 'incomplete') {
        throw new Error(`Koneksi ke OpenAI terputus sebelum respons selesai (status ${response.status ?? 'unknown'}). Kirim ulang task.`);
      }

      const texts: string[] = [];
      let refusal = '';
      for (const item of response.output) {
        if (item.type === 'reasoning') {
          const summary = item.summary.map((part) => part.text.trim()).filter(Boolean).join('\n\n');
          if (summary) await ctx.emit({ type: 'thinking', text: summary });
        } else if (item.type === 'message') {
          for (const part of item.content) {
            if (part.type === 'output_text' && part.text.trim()) texts.push(part.text.trim());
            else if (part.type === 'refusal' && part.refusal.trim()) refusal = part.refusal.trim();
          }
        }
      }
      const answer = texts.join('\n\n');
      if (answer) {
        lastText = answer;
        await ctx.emit({ type: 'text', text: answer });
      }
      const calls = response.output.filter((item): item is ResponseFunctionToolCall => item.type === 'function_call');

      if (refusal && calls.length === 0) {
        throw new Error(`Model menolak melanjutkan permintaan ini: "${refusal}". Ubah kalimat permintaan atau pecah menjadi bagian yang lebih kecil.`);
      }
      if (response.status === 'incomplete') {
        const reason = response.incomplete_details?.reason;
        if (reason === 'content_filter') {
          throw new Error('Jawaban dihentikan oleh filter konten OpenAI. Ubah kalimat permintaan atau pecah menjadi bagian yang lebih kecil.');
        }
        // A truncated tool call can still look valid: never run it. Retry the same turn with more room.
        if (maxTokens < caps.maxOutputTokens) {
          maxTokens = caps.maxOutputTokens;
          await ctx.emit({ type: 'log', level: 'warn', message: `Output model terpotong (${reason ?? 'incomplete'}); giliran diulang dengan max_output_tokens=${maxTokens}.` });
          turns -= 1;
          continue;
        }
        if (calls.length === 0 && answer) {
          return { result: `${answer}\n\n_(jawaban terpotong: batas output tercapai)_` };
        }
        throw new Error('Output model terpotong walau sudah ukuran maksimum (max_output_tokens). Pecah permintaan menjadi bagian yang lebih kecil.');
      }
      if (calls.length === 0) {
        return { result: answer || lastText || 'Selesai.' };
      }

      // output items (reasoning, messages, function calls) go back in order, followed by every call's output;
      // toResponseInputItems strips SDK-only fields (parsed, parsed_arguments) the API would reject
      input.push(...toResponseInputItems(response.output));
      const outputs = await Promise.all(calls.map((call) => runTool(call, toolMap, ctx)));
      input.push(...outputs);
    }
  };
}

function parseArguments(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!raw.trim()) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch (err) {
    return { ok: false, error: `The arguments are not valid JSON (${err instanceof Error ? err.message : String(err)}).` };
  }
}

async function runTool(
  call: ResponseFunctionToolCall,
  toolMap: Map<string, AgentTool>,
  ctx: TaskRunContext,
): Promise<ResponseInputItem.FunctionCallOutput> {
  const tool = toolMap.get(call.name);
  const started = Date.now();
  const args = parseArguments(call.arguments);
  await ctx.emit({
    type: 'tool_call',
    toolUseId: call.call_id,
    tool: call.name,
    displayName: tool?.displayName ?? call.name,
    source: tool?.source ?? 'builtin',
    pluginId: tool?.pluginId,
    input: previewInput(args.ok ? args.value : call.arguments),
  });

  const finish = async (content: ToolResultContent, ok: boolean, summary: string): Promise<ResponseInputItem.FunctionCallOutput> => {
    await ctx.emit({ type: 'tool_result', toolUseId: call.call_id, tool: call.name, ok, summary, durationMs: Date.now() - started });
    return { type: 'function_call_output', call_id: call.call_id, output: toFunctionOutput(content, ok) };
  };

  if (!tool) return finish(`Unknown tool "${call.name}".`, false, 'unknown tool');
  if (!args.ok) return finish(`${args.error}\nCall the tool again with complete, valid JSON arguments.`, false, 'invalid JSON');

  const parsed = tool.parse(args.value);
  if (!parsed.ok) {
    return finish(`${JSON.stringify({ INVALID_INPUT: true })}\n${parsed.error}\nCall the tool again with a complete, valid input.`, false, 'invalid input');
  }

  if (ctx.signal.aborted) throw ctx.signal.reason ?? new Error('Cancelled');
  const reason = tool.confirmation(parsed.value);
  if (reason) {
    const decision = await ctx.confirm({
      toolUseId: call.call_id,
      tool: call.name,
      displayName: tool.displayName,
      pluginId: tool.pluginId ?? null,
      pluginName: tool.pluginName ?? null,
      reason,
      input: previewInput(parsed.value),
    });
    if (!decision.approved) {
      return finish(
        `The user did not approve this action${decision.note ? ` (${decision.note})` : ''}. Do not retry it; continue without it and mention it in the final answer.`,
        false,
        'declined by user',
      );
    }
  }

  if (ctx.signal.aborted) throw ctx.signal.reason ?? new Error('Cancelled');
  if (tool.name !== 'update_progress') await ctx.step(tool.displayName);
  try {
    const out = await tool.execute(parsed.value, ctx);
    if (tool.name !== 'update_progress' && !out.isError) {
      await ctx.progress(Math.min(95, ctx.task.progress + 3), tool.displayName, out.summary);
    }
    return finish(out.content, !out.isError, out.summary);
  } catch (err) {
    if (ctx.signal.aborted) throw ctx.signal.reason ?? err;
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`Tool ${call.name} failed: ${message}`);
    return finish(`Tool error: ${message}`, false, `error: ${message.slice(0, 140)}`);
  }
}
