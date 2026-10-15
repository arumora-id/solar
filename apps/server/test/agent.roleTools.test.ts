import { describe, expect, it } from 'vitest';
import type { AgentTool } from '../src/agent/types.js';
import { selectAgentTools } from '../src/agent/roleTools.js';

const tool = (name: string, source: 'builtin' | 'mcp' = 'builtin') => ({ name, source }) as AgentTool;
const builtins = [
  tool('create_sequence_diagram'), tool('update_progress'), tool('read_artifact'),
  tool('list_knowledge'), tool('read_knowledge'), tool('save_knowledge'),
  tool('load_skill'), tool('read_skill_file'), tool('publish_artifacts_to_github'),
  tool('plane_list_projects'), tool('plane_create_backlog_items'),
  tool('create_or_edit_image'),
];
const integrations = [tool('mcp__private__read_secrets', 'mcp'), tool('mcp__private__publish', 'mcp')];
const names = (items: AgentTool[]) => items.map((x) => x.name);

describe('agent role tool isolation', () => {
  it('keeps admin Knowledge, Skill, integration and image tools out of Staff model tool specs', () => {
    const staff = selectAgentTools('staff', true, builtins, integrations);
    expect(names(staff)).toEqual(['create_sequence_diagram', 'update_progress', 'read_artifact']);
    expect(staff.some((x) => x.source === 'mcp')).toBe(false);
    const injected = selectAgentTools('staff', false, [tool('mcp__injected', 'mcp')], integrations);
    expect(injected).toHaveLength(0);
  });

  it('never exposes image generation to Head of IT or disabled Superadmin', () => {
    expect(names(selectAgentTools('head_of_it', true, builtins, integrations))).not.toContain('create_or_edit_image');
    expect(names(selectAgentTools('superadmin', false, builtins, integrations))).not.toContain('create_or_edit_image');
    expect(names(selectAgentTools(undefined, true, builtins, integrations))).not.toContain('create_or_edit_image');
    expect(names(selectAgentTools('superadmin', true, builtins, integrations))).toContain('create_or_edit_image');
    expect(names(selectAgentTools('superadmin', true, builtins, integrations))).toContain('mcp__private__publish');
  });

  it('lets Head of IT access normal Knowledge and MCP tools, without image capability', () => {
    const head = names(selectAgentTools('head_of_it', false, builtins, integrations));
    expect(head).toContain('read_knowledge');
    expect(head).toContain('mcp__private__read_secrets');
    expect(head).not.toContain('create_or_edit_image');
  });
});
