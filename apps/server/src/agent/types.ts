import type Anthropic from '@anthropic-ai/sdk';
import type { ToolSource } from '@solar/shared';
import type { TaskRunContext } from '../tasks/taskManager.js';

export type ToolResultContent = string | Array<Anthropic.Beta.BetaTextBlockParam | Anthropic.Beta.BetaImageBlockParam>;

export interface ToolOutput {
  content: ToolResultContent;
  isError?: boolean;
  /** One line shown in the monitor timeline. */
  summary: string;
}

export type ParseResult = { ok: true; value: unknown } | { ok: false; error: string };

export interface AgentTool {
  name: string;
  displayName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  source: ToolSource;
  pluginId?: string;
  pluginName?: string;
  /** Large inputs (documents, models) are streamed eagerly and validated by `parse`. */
  eagerInput?: boolean;
  parse(input: unknown): ParseResult;
  /** Returns the reason when the user must approve this call, otherwise null. */
  confirmation(input: unknown): string | null;
  execute(input: unknown, ctx: TaskRunContext): Promise<ToolOutput>;
}
