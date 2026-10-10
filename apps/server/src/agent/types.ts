import type { ToolSource } from '@solar/shared';
import type { Lang, LocalizedText } from '../i18n.js';
import type { TaskRunContext } from '../tasks/taskManager.js';

/** Provider-neutral tool output block (converted to the model API's format by the agent loop). */
export type ToolResultBlock = { type: 'text'; text: string } | { type: 'image'; mimeType: string; data: string };

export type ToolResultContent = string | ToolResultBlock[];

export interface ToolOutput {
  content: ToolResultContent;
  isError?: boolean;
  /** One line shown in the monitor timeline, in the task's language (`content` is for the model and stays English). */
  summary: string;
}

export type ParseResult = { ok: true; value: unknown } | { ok: false; error: string };

export interface AgentTool {
  name: string;
  /**
   * Name shown in the timeline, the approval dialog and as the current step, in the task's language. Built-in tools
   * name themselves in both languages; MCP tools keep the name their plugin gives them.
   */
  displayName: LocalizedText;
  description: string;
  inputSchema: Record<string, unknown>;
  source: ToolSource;
  pluginId?: string;
  pluginName?: string;
  parse(input: unknown): ParseResult;
  /**
   * Returns the reason when the user must approve this call, otherwise null (may look things up first). The reason is
   * shown to the user in `lang`, the task's language (default Indonesian).
   */
  confirmation(input: unknown, lang?: Lang): string | null | Promise<string | null>;
  /** What the approval shows instead of the (shortened) input, e.g. the whole file the call writes. */
  confirmationPreview?(input: unknown, lang?: Lang): Promise<unknown>;
  execute(input: unknown, ctx: TaskRunContext): Promise<ToolOutput>;
}
