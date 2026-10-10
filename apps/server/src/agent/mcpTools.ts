import { DEFAULT_LANG, t, taskLang } from '../i18n.js';
import type { McpManager } from '../plugins/mcpManager.js';
import { isWriteTool } from '../plugins/mcpManager.js';
import type { AgentTool } from './types.js';

function sanitizeSchema(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(schema ?? {})) as Record<string, unknown>;
  delete clone.$schema;
  if (clone.type !== 'object') return { type: 'object', properties: {} };
  if (!clone.properties || typeof clone.properties !== 'object') clone.properties = {};
  return clone;
}

const MAX_DESCRIPTION = 1024;
const APPROVAL_NOTE = "\n(This call requires the user's approval before it runs.)";

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Wraps every tool of the connected MCP plugins as an agent tool (with the plugin's confirmation policy). */
export function createMcpTools(mcp: McpManager): AgentTool[] {
  return mcp.bindings().map(({ qualifiedName, plugin, tool }) => {
    const write = isWriteTool(tool);
    const title = tool.annotations?.title ?? tool.name;
    const note = plugin.confirm === 'always' || (plugin.confirm === 'writes' && write) ? APPROVAL_NOTE : '';
    // OpenAI rejects function descriptions longer than 1024 characters
    const description = `${clip(`[${plugin.name}] ${tool.description ?? title}`, MAX_DESCRIPTION - note.length)}${note}`;
    return {
      name: qualifiedName,
      // the plugin's own names, the same in both languages
      displayName: `${plugin.name}: ${title}`,
      description,
      inputSchema: sanitizeSchema(tool.inputSchema),
      source: 'mcp',
      pluginId: plugin.id,
      pluginName: plugin.name,
      parse(input) {
        if (input === null || typeof input !== 'object' || Array.isArray(input)) {
          return { ok: false, error: 'Tool input must be a JSON object' };
        }
        return { ok: true, value: input };
      },
      confirmation(_input, lang = DEFAULT_LANG) {
        if (plugin.confirm === 'always') return t(lang, 'confirm.mcp.always', { plugin: plugin.name });
        if (plugin.confirm === 'writes' && write) return t(lang, 'confirm.mcp.write', { tool: tool.name, plugin: plugin.name });
        return null;
      },
      async execute(input, ctx) {
        const result = await mcp.callTool(plugin.id, tool.name, input as Record<string, unknown>, ctx.signal);
        const firstText = result.blocks.find((b) => b.type === 'text');
        const preview = firstText && firstText.type === 'text' ? firstText.text.replace(/\s+/g, ' ').slice(0, 140) : 'ok';
        // the plugin's own text, labelled as an error in the task's language
        return { content: result.blocks, isError: result.isError, summary: result.isError ? t(taskLang(ctx), 'tool.failed', { message: preview }) : preview };
      },
    } satisfies AgentTool;
  });
}
