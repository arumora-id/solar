import type { Role } from '@solar/shared';
import type { AgentTool } from './types.js';

/**
 * Server-side authorization for agent tools. Never rely on hiding a Settings
 * panel; the model must not receive privileged tools or their descriptions.
 */
const STAFF_RESTRICTED_TOOLS = new Set([
  'list_knowledge', 'read_knowledge', 'search_knowledge',
  'save_knowledge', 'import_artifact_to_knowledge',
  'load_skill', 'read_skill_file',
  'publish_artifacts_to_github', 'plane_list_projects', 'plane_create_backlog_items',
]);

export function selectAgentTools(
  role: Role | undefined,
  imageEnabled: boolean,
  builtinTools: AgentTool[],
  mcpTools: AgentTool[],
): AgentTool[] {
  const staff = role === 'staff';
  const builtins = builtinTools.filter((tool) => {
    if (tool.name === 'create_or_edit_image') return role === 'superadmin' && imageEnabled;
    if (staff && (STAFF_RESTRICTED_TOOLS.has(tool.name) || tool.source === 'mcp')) return false;
    return true;
  });
  // All dynamic MCP tools are administrator-managed; until a separate
  // fine-grained sharing policy exists, do not expose any to Staff.
  return staff ? builtins : [...builtins, ...mcpTools];
}
