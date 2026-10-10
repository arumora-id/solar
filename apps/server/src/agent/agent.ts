import type { AppConfig } from '../config.js';
import { LANGUAGE_NAME, localize, t, taskLang, type Lang } from '../i18n.js';
import type { KnowledgeStore } from '../knowledge/knowledgeStore.js';
import type { ModelRouter } from '../llm/router.js';
import { LlmError, type ConversationItem, type ModelClient, type ToolCall, type TurnResult } from '../llm/types.js';
import { createLogger } from '../logger.js';
import type { McpManager } from '../plugins/mcpManager.js';
import type { PluginStore } from '../plugins/pluginStore.js';
import type { SkillStore } from '../skills/skillStore.js';
import type { AttachmentService } from '../tasks/attachmentService.js';
import type { TaskRunContext, TaskRunner } from '../tasks/taskManager.js';
import type { TokenUsage } from './models.js';
import { documentsIntro } from './documentIntro.js';
import { knowledgeIntro } from './knowledgeTools.js';
import { createMcpTools } from './mcpTools.js';
import { estimateCostUsd } from './models.js';
import { buildSystemPrompt } from './systemPrompt.js';
import type { AgentTool, ToolResultContent } from './types.js';

// The Responses API transport types and the tool-output conversion live in the LLM layer; re-exported for tests.
export {
  toFunctionOutput,
  type ResponsesStreamer,
  type ResponseStreamLike,
  type StreamDeltaEvent,
  type StreamParams,
} from '../llm/responsesClient.js';

const log = createLogger('agent');

export interface AgentDeps {
  config: AppConfig;
  models: ModelRouter;
  skills: SkillStore;
  knowledge: KnowledgeStore;
  plugins: PluginStore;
  mcp: McpManager;
  builtinTools: AgentTool[];
  attachments: AttachmentService;
}

const MAX_EVENT_INPUT_CHARS = 20_000;

function previewInput(input: unknown): unknown {
  const text = JSON.stringify(input ?? null);
  if (text.length <= MAX_EVENT_INPUT_CHARS) return input;
  return { _preview: `${text.slice(0, MAX_EVENT_INPUT_CHARS)}…`, _note: `input truncated for the timeline (${text.length} characters)` };
}

export function createAgentRunner(deps: AgentDeps): TaskRunner {
  const { config } = deps;

  return async (ctx: TaskRunContext) => {
    // Tools and instructions are frozen for the whole task: the input stays append-only,
    // which keeps the prompt cache warm and the encrypted reasoning items valid.
    const tools = [...deps.builtinTools, ...createMcpTools(deps.mcp)];
    const toolMap = new Map(tools.map((t) => [t.name, t]));
    const connected = deps.mcp.statuses().filter((s) => s.state === 'connected');
    const knowledge = await deps.knowledge.list();
    const instructions = buildSystemPrompt({
      config,
      skills: await deps.skills.list(),
      knowledge,
      plugins: connected
        .map((s) => ({ config: deps.plugins.get(s.id), toolCount: deps.mcp.bindings().filter((b) => b.plugin.id === s.id).length }))
        .filter((p): p is { config: NonNullable<typeof p.config>; toolCount: number } => Boolean(p.config)),
      builtinToolNames: deps.builtinTools.map((t) => t.name),
    });
    const toolSpecs = tools.map((t) => ({ name: t.name, description: t.description, parameters: t.inputSchema }));

    const today = new Date().toISOString().slice(0, 10);
    // the task's language: its own texts are written in it, and the agent answers in it when the request's language is unclear
    const lang = taskLang(ctx);
    const intro = [
      `<task_context>\nDate: ${today}\nTask id: ${ctx.task.id}\nInterface language: ${LANGUAGE_NAME[lang]}\n</task_context>`,
      ctx.sessionContext
        ? `<session_history>\nEarlier requests in this conversation (oldest first). Their artifacts can be read with read_artifact and their documents with read_document.\n${ctx.sessionContext}\n</session_history>`
        : '',
      await documentsIntro(ctx.attachments, deps.attachments),
      await knowledgeIntro(deps.knowledge, knowledge, ctx.task.prompt, ctx.attachments.map((a) => a.name)),
      `<request>\n${ctx.task.prompt}\n</request>`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const history: ConversationItem[] = [{ role: 'user', text: intro }];

    const { clients, warnings } = deps.models.clientsFor(undefined, lang);
    for (const message of warnings) await ctx.emit({ type: 'log', level: 'warn', message });
    if (!clients.length) throw new Error(t(lang, 'agent.noModel'));
    let clientIndex = 0;
    let client: ModelClient = clients[0]!;
    const initialMaxTokens = (c: ModelClient) => Math.min(config.openai.maxTokens, c.capabilities.maxOutputTokens);
    let maxTokens = initialMaxTokens(client);
    let turns = 0;
    let lastText = '';

    const addUsage = (usage: TokenUsage, model: string) =>
      ctx.addUsage({ ...usage, costUsd: estimateCostUsd(model, usage, client.price) });

    await ctx.progress(2, t(lang, 'agent.step.reading'));

    for (;;) {
      if (ctx.signal.aborted) throw ctx.signal.reason ?? new Error(t(lang, 'task.step.cancelled'));
      turns += 1;
      if (turns > config.openai.maxTurns) throw new Error(t(lang, 'agent.maxTurns', { max: config.openai.maxTurns }));
      await ctx.step(t(lang, turns === 1 ? 'agent.step.planning' : 'agent.step.thinking'));

      let response: TurnResult;
      let thinkingKey = '';
      try {
        response = await client.turn({
          instructions,
          history: [...history],
          tools: toolSpecs,
          maxOutputTokens: maxTokens,
          signal: ctx.signal,
          onText: (delta) => ctx.delta(delta, 'text'),
          onThinking: (delta, key) => {
            if (thinkingKey && key !== thinkingKey) ctx.delta('\n\n', 'thinking');
            thinkingKey = key;
            ctx.delta(delta, 'thinking');
          },
        });
      } catch (err) {
        if (ctx.signal.aborted) throw ctx.signal.reason ?? err;
        const partial = (err as { usage?: TokenUsage }).usage;
        if (partial) await addUsage(partial, client.model);
        const next = clients[clientIndex + 1];
        if (err instanceof LlmError && err.fallback && next) {
          await ctx.emit({ type: 'log', level: 'warn', message: t(lang, 'agent.fallback', { from: client.key, error: err.message, to: next.key }) });
          log.warn(`Task ${ctx.task.id}: ${client.key} failed (${err.kind}), falling back to ${next.key}`);
          clientIndex += 1;
          client = next;
          maxTokens = initialMaxTokens(client);
          turns -= 1;
          continue;
        }
        throw err;
      }

      await addUsage(response.usage, response.model || client.model);

      for (const summary of response.thinking) await ctx.emit({ type: 'thinking', text: summary });
      const answer = response.texts.join('\n\n');
      if (answer) {
        lastText = answer;
        await ctx.emit({ type: 'text', text: answer });
      }
      const calls = response.calls;

      if (response.refusal && calls.length === 0) {
        throw new Error(t(lang, 'agent.refusal', { refusal: response.refusal }));
      }
      if (response.status === 'incomplete') {
        const reason = response.incompleteReason;
        if (reason === 'content_filter') throw new Error(t(lang, 'agent.contentFilter', { provider: client.providerName }));
        // A truncated tool call can still look valid: never run it. Retry the same turn with more room.
        if (maxTokens < client.capabilities.maxOutputTokens) {
          maxTokens = client.capabilities.maxOutputTokens;
          await ctx.emit({ type: 'log', level: 'warn', message: t(lang, 'agent.truncatedRetry', { reason: reason ?? 'incomplete', max: maxTokens }) });
          turns -= 1;
          continue;
        }
        if (calls.length === 0 && answer) {
          return { result: `${answer}\n\n${t(lang, 'agent.truncatedAnswer')}` };
        }
        throw new Error(t(lang, 'agent.truncatedError'));
      }
      if (calls.length === 0) {
        return { result: answer || lastText || t(lang, 'agent.done') };
      }

      // the assistant turn goes back in order (with the client's raw output for the same model), then every call's output
      history.push({ role: 'assistant', text: answer, calls, native: response.native ? { clientKey: client.key, items: response.native } : undefined });
      const outputs = await Promise.all(calls.map((call) => runTool(call, toolMap, ctx, lang)));
      history.push(...outputs);
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

type ToolOutputItem = Extract<ConversationItem, { role: 'tool' }>;

/** Runs one tool call; what the user sees of it (name, summary, approval) is in `lang`, what the model gets in English. */
async function runTool(call: ToolCall, toolMap: Map<string, AgentTool>, ctx: TaskRunContext, lang: Lang): Promise<ToolOutputItem> {
  const tool = toolMap.get(call.name);
  const displayName = tool ? localize(tool.displayName, lang) : call.name;
  const cancelled = () => new Error(t(lang, 'task.step.cancelled'));
  const started = Date.now();
  const args = parseArguments(call.arguments);
  await ctx.emit({
    type: 'tool_call',
    toolUseId: call.id,
    tool: call.name,
    displayName,
    source: tool?.source ?? 'builtin',
    pluginId: tool?.pluginId,
    input: previewInput(args.ok ? args.value : call.arguments),
  });

  const finish = async (content: ToolResultContent, ok: boolean, summary: string): Promise<ToolOutputItem> => {
    await ctx.emit({ type: 'tool_result', toolUseId: call.id, tool: call.name, ok, summary, durationMs: Date.now() - started });
    return { role: 'tool', callId: call.id, name: call.name, content, ok };
  };

  if (!tool) return finish(`Unknown tool "${call.name}".`, false, t(lang, 'tool.unknown'));
  if (!args.ok) return finish(`${args.error}\nCall the tool again with complete, valid JSON arguments.`, false, t(lang, 'tool.invalidJson'));

  const parsed = tool.parse(args.value);
  if (!parsed.ok) {
    return finish(
      `${JSON.stringify({ INVALID_INPUT: true })}\n${parsed.error}\nCall the tool again with a complete, valid input.`,
      false,
      t(lang, 'tool.invalidInput'),
    );
  }

  if (ctx.signal.aborted) throw ctx.signal.reason ?? cancelled();
  const reason = await tool.confirmation(parsed.value, lang);
  if (reason) {
    const decision = await ctx.confirm({
      toolUseId: call.id,
      tool: call.name,
      displayName,
      pluginId: tool.pluginId ?? null,
      pluginName: tool.pluginName ?? null,
      reason,
      input: tool.confirmationPreview
        ? await tool.confirmationPreview(parsed.value, lang).catch(() => previewInput(parsed.value))
        : previewInput(parsed.value),
    });
    if (!decision.approved) {
      return finish(
        `The user did not approve this action${decision.note ? ` (${decision.note})` : ''}. Do not retry it; continue without it and mention it in the final answer.`,
        false,
        t(lang, 'tool.declined'),
      );
    }
  }

  if (ctx.signal.aborted) throw ctx.signal.reason ?? cancelled();
  if (tool.name !== 'update_progress') await ctx.step(displayName);
  try {
    const out = await tool.execute(parsed.value, ctx);
    if (tool.name !== 'update_progress' && !out.isError) {
      await ctx.progress(Math.min(95, ctx.task.progress + 3), displayName, out.summary);
    }
    return finish(out.content, !out.isError, out.summary);
  } catch (err) {
    if (ctx.signal.aborted) throw ctx.signal.reason ?? err;
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`Tool ${call.name} failed: ${message}`);
    return finish(`Tool error: ${message}`, false, t(lang, 'tool.failed', { message: message.slice(0, 140) }));
  }
}
