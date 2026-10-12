import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, GUARDRAIL_SKILL } from '../src/agent/systemPrompt.js';
import { loadConfig } from '../src/config.js';
import { SkillStore } from '../src/skills/skillStore.js';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

describe('guardrail (the user\'s rules for how the agent talks to them)', () => {
  it('ships as a built-in skill with the six steps in both languages, and switches the prompt rules with it', async () => {
    const data = mkdtempSync(join(tmpdir(), 'solar-guardrail-'));
    const skills = new SkillStore(join(ROOT, 'skills'), join(data, 'skills'), data);
    await skills.init();

    const skill = await skills.get(GUARDRAIL_SKILL);
    expect(skill).toMatchObject({ source: 'builtin', enabled: true });
    expect(skill!.name).toContain('Guardrail');
    for (const heading of ['Where the reasoning breaks', 'Di mana logikanya patah', 'The question you are avoiding', 'Pertanyaan yang Anda hindari']) {
      expect(skill!.content).toContain(heading);
    }

    const config = loadConfig({ ...process.env, SOLAR_ROOT: ROOT, DATA_DIR: data, DATABASE_URL: '', S3_BUCKET: '' });
    const prompt = async () => buildSystemPrompt({ config, skills: await skills.list(), plugins: [], builtinToolNames: [] });

    const on = await prompt();
    expect(on).toContain('# Guardrail');
    expect(on).toContain('Never open with praise');
    expect(on).toContain(`load_skill("${GUARDRAIL_SKILL}")`);
    expect(on).toContain(`- ${GUARDRAIL_SKILL}: Guardrail`);
    // stable text, so the prompt keeps hitting the prompt cache
    expect(await prompt()).toBe(on);

    // disabling the skill in Settings → Skills turns the whole guardrail off
    await skills.update(GUARDRAIL_SKILL, { enabled: false });
    const off = await prompt();
    expect(off).not.toContain('# Guardrail');
    expect(off).not.toContain(`- ${GUARDRAIL_SKILL}:`);
  });
});
