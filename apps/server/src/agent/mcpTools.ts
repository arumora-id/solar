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

/** Wraps every tool of the connected MCP plugins as an agent tool (with the plugin's confirmation policy). */
export function createMcpTools(mcp: McpManager): AgentTool[] {
  return mcp.bindings().map(({ qualifiedName, plugin, tool }) => {
    const write = isWriteTool(tool);
    const title = tool.annotations?.title ?? tool.name;
    const description = `[${plugin.name}] ${tool.description ?? title}`.slice(0, 4000);
    return {
      name: qualifiedName,
      displayName: `${plugin.name}: ${title}`,
      description:
        plugin.confirm === 'always' || (plugin.confirm === 'writes' && write)
          ? `${description}\n(This call requires the user's approval before it runs.)`
          : description,
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
      confirmation() {
        if (plugin.confirm === 'always') return `${plugin.name} mewajibkan persetujuan Anda untuk setiap pemanggilan`;
        if (plugin.confirm === 'writes' && write) return `${tool.name} dapat mengubah data di ${plugin.name}`;
        return null;
      },
      async execute(input, ctx) {
        const result = await mcp.callTool(plugin.id, tool.name, input as Record<string, unknown>, ctx.signal);
        const firstText = result.blocks.find((b) => b.type === 'text');
        const preview = firstText && firstText.type === 'text' ? firstText.text.replace(/\s+/g, ' ').slice(0, 140) : 'ok';
        return { content: result.blocks, isError: result.isError, summary: result.isError ? `error: ${preview}` : preview };
      },
    } satisfies AgentTool;
  });
}
