import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SECRET_MASK } from '@solar/shared';
import { qualifyToolName, isWriteTool, convertResult, stdioEnvironment } from '../src/plugins/mcpManager.js';
import { maskPlugin, PluginStore, resolvePlugin } from '../src/plugins/pluginStore.js';
import { parseSkillMarkdown, SkillStore } from '../src/skills/skillStore.js';
import { resolveInside } from '../src/util/fs.js';

describe('skills', () => {
  it('parses front matter', () => {
    const s = parseSkillMarkdown('---\nname: My Skill\ndescription: Does things\n---\n\n# Body', 'fallback');
    expect(s).toEqual({ name: 'My Skill', description: 'Does things', body: '# Body' });
  });

  it('creates, overrides, disables and deletes skills', async () => {
    const root = mkdtempSync(join(tmpdir(), 'solar-skills-'));
    const builtin = join(root, 'builtin');
    const user = join(root, 'data', 'skills');
    const store = new SkillStore(builtin, user, join(root, 'data'));
    await store.init();
    const created = await store.create({ name: 'Cloud Cost Review', description: 'FinOps checklist', content: 'Check costs.' });
    expect(created.id).toBe('cloud-cost-review');
    expect(created.source).toBe('user');
    const disabled = await store.update(created.id, { enabled: false });
    expect(disabled.enabled).toBe(false);
    expect(disabled.description).toBe('FinOps checklist');
    await expect(store.readFile(created.id, '../../etc/passwd')).rejects.toThrow();
    expect(await store.remove(created.id)).toBe('deleted');
    expect(await store.list()).toHaveLength(0);
  });
});

describe('plugins', () => {
  it('interpolates ${ENV} references and reports missing variables', () => {
    const resolved = resolvePlugin(
      {
        id: 'p',
        name: 'P',
        description: '',
        preset: 'custom',
        enabled: true,
        transport: 'http',
        url: 'https://${HOST_X}/mcp',
        headers: { Authorization: 'Bearer ${TOKEN_X}' },
        confirm: 'writes',
      },
      { HOST_X: 'example.com' },
    );
    expect(resolved.url).toBe('https://example.com/mcp');
    expect(resolved.missingVars).toEqual(['TOKEN_X']);
  });

  it('masks literal secrets but keeps env references visible, and keeps secrets on update', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'solar-plugins-'));
    const defaults = join(dir, 'defaults.json');
    writeFileSync(defaults, '[]');
    const store = new PluginStore(dir, defaults);
    await store.init();
    await store.create({
      id: 'vp',
      name: 'VP',
      transport: 'http',
      url: 'https://vp.example/mcp',
      headers: { Authorization: 'Bearer real-secret', 'X-Ref': '${VP_TOKEN}' },
      confirm: 'always',
    });
    const masked = maskPlugin(store.get('vp')!);
    expect(masked.headers!.Authorization).toBe(SECRET_MASK);
    expect(masked.headers!['X-Ref']).toBe('${VP_TOKEN}');
    await store.update('vp', { headers: { Authorization: SECRET_MASK, 'X-Ref': '${VP_TOKEN}' } });
    expect(store.get('vp')!.headers!.Authorization).toBe('Bearer real-secret');
  });

  it('builds valid Anthropic tool names', () => {
    const name = qualifyToolName('visual-paradigm', 'a'.repeat(100));
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(qualifyToolName('github', 'get_me')).toBe('mcp__github__get_me');
  });

  it('classifies write tools', () => {
    expect(isWriteTool({ name: 'create_issue', inputSchema: {} })).toBe(true);
    expect(isWriteTool({ name: 'list_issues', inputSchema: {} })).toBe(false);
    expect(isWriteTool({ name: 'get_file_contents', inputSchema: {} })).toBe(false);
    expect(isWriteTool({ name: 'whatever', inputSchema: {}, annotations: { destructiveHint: true } })).toBe(true);
  });

  it('passes proxy settings to stdio plugins but never other secrets', () => {
    const env = stdioEnvironment(
      { PLANE_API_KEY: 'p' },
      { HTTPS_PROXY: 'http://proxy:8080', NODE_EXTRA_CA_CERTS: '/ca.pem', npm_config_registry: 'https://r', ANTHROPIC_API_KEY: 'secret', GITHUB_TOKEN: 'secret' },
    );
    expect(env.HTTPS_PROXY).toBe('http://proxy:8080');
    expect(env.NODE_EXTRA_CA_CERTS).toBe('/ca.pem');
    expect(env.npm_config_registry).toBe('https://r');
    expect(env.PLANE_API_KEY).toBe('p');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
  });

  it('converts MCP results', () => {
    const r = convertResult({ content: [{ type: 'text', text: 'hello' }, { type: 'image', mimeType: 'image/png', data: 'AAAA' }], isError: false });
    expect(r.blocks).toHaveLength(2);
    expect(r.blocks[1]!.type).toBe('image');
  });
});

describe('resolveInside', () => {
  it('blocks path traversal', () => {
    expect(() => resolveInside('/data', '../etc/passwd')).toThrow();
    expect(() => resolveInside('/data', '/etc/passwd')).toThrow();
    expect(resolveInside('/data', 'a/b.txt')).toBe(join('/data', 'a/b.txt'));
  });
});
