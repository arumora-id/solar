import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages';
import type { AppConfig } from '../config.js';
import { createLogger } from '../logger.js';
import type { McpManager } from '../plugins/mcpManager.js';
import type { PluginStore } from '../plugins/pluginStore.js';
import type { SkillStore } from '../skills/skillStore.js';
import type { TaskRunContext, TaskRunner } from '../tasks/taskManager.js';
import { createMcpTools } from './mcpTools.js';
import { capabilitiesOf, estimateCostUsd } from './models.js';
import { buildSystemPrompt } from './systemPrompt.js';
import type { AgentTool, ToolResultContent } from './types.js';

const log = createLogger('agent');

type BetaMessage = Anthropic.Beta.BetaMessage;
type BetaMessageParam = Anthropic.Beta.BetaMessageParam;
type StreamParams = BetaMessageStreamParams;

/** The part of the SDK the agent uses (lets tests inject a scripted model). */
export interface MessageStreamLike {
  on(event: 'text' | 'thinking', listener: (delta: string) => void): unknown;
  finalMessage(): Promise<BetaMessage>;
}

export interface MessagesStreamer {
  stream(params: StreamParams, options?: { signal?: AbortSignal }): MessageStreamLike;
}

export interface AgentDeps {
  config: AppConfig;
  messages: MessagesStreamer;
  skills: SkillStore;
  plugins: PluginStore;
  mcp: McpManager;
  builtinTools: AgentTool[];
}

const MAX_EVENT_INPUT_CHARS = 20_000;
const ABSOLUTE_MAX_TOKENS = 128_000;

function previewInput(input: unknown): unknown {
  const text = JSON.stringify(input ?? null);
  if (text.length <= MAX_EVENT_INPUT_CHARS) return input;
  return { _preview: `${text.slice(0, MAX_EVENT_INPUT_CHARS)}…`, _note: `input truncated for the timeline (${text.length} characters)` };
}

function friendlyApiError(err: InstanceType<typeof Anthropic.APIError>): Error {
  if (err instanceof Anthropic.AuthenticationError) {
    return new Error('Autentikasi Anthropic gagal: isi ANTHROPIC_API_KEY yang valid di .env lalu restart SOLAR.');
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new Error(`Akses Anthropic ditolak untuk model/workspace ini: ${err.message}`);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new Error('Batas rate Anthropic tercapai setelah percobaan ulang otomatis. Tunggu sebentar lalu kirim ulang task.');
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new Error(`Permintaan ditolak oleh Anthropic API: ${err.message}`);
  }
  return new Error(`Anthropic API error${err.status ? ` ${err.status}` : ''}: ${err.message}`);
}

function textOf(message: BetaMessage): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n\n')
    .trim();
}

function nonEmpty(content: ToolResultContent): ToolResultContent {
  if (typeof content === 'string') return content.trim() ? content : '(empty result)';
  return content.length ? content : '(empty result)';
}

export function createAgentRunner(deps: AgentDeps): TaskRunner {
  const { config } = deps;

  return async (ctx: TaskRunContext) => {
    // Tools and system prompt are frozen for the whole task: the conversation stays append-only,
    // which keeps the prompt cache warm and thinking blocks valid.
    const tools = [...deps.builtinTools, ...createMcpTools(deps.mcp)];
    const toolMap = new Map(tools.map((t) => [t.name, t]));
    const connected = deps.mcp.statuses().filter((s) => s.state === 'connected');
    const system = buildSystemPrompt({
      config,
      skills: await deps.skills.list(),
      plugins: connected
        .map((s) => ({ config: deps.plugins.get(s.id), toolCount: deps.mcp.bindings().filter((b) => b.plugin.id === s.id).length }))
        .filter((p): p is { config: NonNullable<typeof p.config>; toolCount: number } => Boolean(p.config)),
      builtinToolNames: deps.builtinTools.map((t) => t.name),
    });
    const apiTools: Anthropic.Beta.BetaTool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
      ...(t.eagerInput ? { eager_input_streaming: true } : {}),
    }));

    const today = new Date().toISOString().slice(0, 10);
    const intro = [
      `<task_context>\nDate: ${today}\nTask id: ${ctx.task.id}\n</task_context>`,
      ctx.sessionContext
        ? `<session_history>\nEarlier requests in this conversation (oldest first). Their artifacts can be read with read_artifact.\n${ctx.sessionContext}\n</session_history>`
        : '',
      `<request>\n${ctx.task.prompt}\n</request>`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const messages: BetaMessageParam[] = [{ role: 'user', content: [{ type: 'text', text: intro }] }];

    const model = config.anthropic.model;
    const caps = capabilitiesOf(model);
    let maxTokens = config.anthropic.maxTokens;
    let turns = 0;
    let jsonRetries = 0;
    let lastText = '';

    await ctx.progress(2, 'Membaca permintaan');

    for (;;) {
      if (ctx.signal.aborted) throw ctx.signal.reason ?? new Error('Cancelled');
      turns += 1;
      if (turns > config.anthropic.maxTurns) {
        throw new Error(`Dihentikan setelah ${config.anthropic.maxTurns} giliran model (SOLAR_MAX_TURNS). Artefak yang sudah dibuat tetap tersimpan.`);
      }
      await ctx.step(turns === 1 ? 'Merencanakan' : 'Berpikir');

      const params: StreamParams = {
        model,
        max_tokens: maxTokens,
        system: [{ type: 'text', text: system }],
        tools: apiTools,
        messages,
        cache_control: { type: 'ephemeral' },
        ...(caps.adaptiveThinking
          ? { thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort: config.anthropic.effort } }
          : { thinking: { type: 'enabled', budget_tokens: 8000 } }),
        ...(caps.serverFallback && config.anthropic.refusalFallback
          ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
          : {}),
      };

      let message: BetaMessage;
      try {
        const stream = deps.messages.stream(params, { signal: ctx.signal });
        stream.on('text', (delta) => ctx.delta(delta, 'text'));
        stream.on('thinking', (delta) => ctx.delta(delta, 'thinking'));
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        if (ctx.signal.aborted) throw ctx.signal.reason ?? err;
        if (err instanceof Anthropic.APIError) throw friendlyApiError(err);
        // With eager input streaming a tool input that is not parseable JSON rejects the stream;
        // the turn was not appended, so re-issue it (bounded).
        if (jsonRetries++ >= 2) throw err;
        log.warn(`Re-issuing turn after unparseable tool input: ${err instanceof Error ? err.message : String(err)}`);
        await ctx.emit({ type: 'log', level: 'warn', message: 'Input tool dari model tidak valid (JSON); giliran diulang.' });
        turns -= 1;
        continue;
      }

      const u = message.usage;
      const usage = {
        inputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      };
      await ctx.addUsage({ ...usage, costUsd: estimateCostUsd(message.model ?? model, usage) });

      for (const block of message.content) {
        if (block.type === 'thinking' && block.thinking.trim()) await ctx.emit({ type: 'thinking', text: block.thinking.trim() });
        if (block.type === 'text' && block.text.trim()) {
          lastText = block.text.trim();
          await ctx.emit({ type: 'text', text: lastText });
        }
      }

      const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');

      if (message.stop_reason === 'refusal') {
        const details = message.stop_details;
        const category = details && 'category' in details && details.category ? ` (category: ${details.category})` : '';
        throw new Error(`Claude menolak melanjutkan permintaan ini${category}. Ubah kalimat permintaan atau pecah menjadi bagian yang lebih kecil.`);
      }
      if (message.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: message.content });
        continue;
      }
      if (message.stop_reason === 'max_tokens' && toolUses.length > 0) {
        // A truncated tool input can still look valid: never run it. Retry the same turn with more room.
        if (maxTokens < ABSOLUTE_MAX_TOKENS) {
          maxTokens = ABSOLUTE_MAX_TOKENS;
          await ctx.emit({ type: 'log', level: 'warn', message: `Batas output tercapai di dalam pemanggilan tool; diulang dengan max_tokens=${maxTokens}.` });
          turns -= 1;
          continue;
        }
        throw new Error('Output model terpotong di dalam pemanggilan tool walau sudah ukuran maksimum. Pecah permintaan menjadi bagian yang lebih kecil.');
      }
      if (toolUses.length === 0) {
        const answer = textOf(message) || lastText;
        if (message.stop_reason === 'max_tokens') {
          return { result: `${answer}\n\n_(jawaban terpotong: batas output tercapai)_` };
        }
        return { result: answer || 'Selesai.' };
      }

      messages.push({ role: 'assistant', content: message.content });
      const results = await Promise.all(toolUses.map((block) => runTool(block, toolMap, ctx)));
      messages.push({ role: 'user', content: results });
    }
  };
}

async function runTool(
  block: Anthropic.Beta.BetaToolUseBlock,
  toolMap: Map<string, AgentTool>,
  ctx: TaskRunContext,
): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const tool = toolMap.get(block.name);
  const started = Date.now();
  await ctx.emit({
    type: 'tool_call',
    toolUseId: block.id,
    tool: block.name,
    displayName: tool?.displayName ?? block.name,
    source: tool?.source ?? 'builtin',
    pluginId: tool?.pluginId,
    input: previewInput(block.input),
  });

  const finish = async (content: ToolResultContent, ok: boolean, summary: string): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
    await ctx.emit({ type: 'tool_result', toolUseId: block.id, tool: block.name, ok, summary, durationMs: Date.now() - started });
    return { type: 'tool_result', tool_use_id: block.id, content: nonEmpty(content), ...(ok ? {} : { is_error: true }) };
  };

  if (!tool) return finish(`Unknown tool "${block.name}".`, false, 'unknown tool');

  const parsed = tool.parse(block.input);
  if (!parsed.ok) {
    return finish(`${JSON.stringify({ INVALID_INPUT: true })}\n${parsed.error}\nCall the tool again with a complete, valid input.`, false, 'invalid input');
  }

  const reason = tool.confirmation(parsed.value);
  if (reason) {
    const decision = await ctx.confirm({
      toolUseId: block.id,
      tool: block.name,
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
    log.warn(`Tool ${block.name} failed: ${message}`);
    return finish(`Tool error: ${message}`, false, `error: ${message.slice(0, 140)}`);
  }
}
