import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { SkillDetail, SkillInput, SkillSource, SkillSummary } from '@solar/shared';
import { both, LocalizedError } from '../i18n.js';
import { resolveInside, writeFileAtomic } from '../util/fs.js';
import { slugify } from '../util/ids.js';

const SKILL_FILE = 'SKILL.md';
const MAX_SKILL_FILE_BYTES = 512 * 1024;

interface ParsedSkill {
  name: string;
  description: string;
  body: string;
}

export function parseSkillMarkdown(raw: string, fallbackName: string): ParsedSkill {
  const text = raw.replace(/^﻿/, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return { name: fallbackName, description: '', body: text.trim() };
  let meta: Record<string, unknown> = {};
  try {
    const parsed: unknown = parseYaml(match[1] ?? '');
    if (parsed && typeof parsed === 'object') meta = parsed as Record<string, unknown>;
  } catch {
    // invalid front matter: treat the whole file as body
    return { name: fallbackName, description: '', body: text.trim() };
  }
  return {
    name: typeof meta.name === 'string' && meta.name.trim() ? meta.name.trim() : fallbackName,
    description: typeof meta.description === 'string' ? meta.description.trim() : '',
    body: (match[2] ?? '').trim(),
  };
}

export function renderSkillMarkdown(input: { name: string; description: string; content: string }): string {
  const front = stringifyYaml({ name: input.name, description: input.description }).trim();
  return `---\n${front}\n---\n\n${input.content.trim()}\n`;
}

async function listFilesRecursive(dir: string, root = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFilesRecursive(full, root)));
    else if (entry.isFile()) out.push(relative(root, full).split(sep).join('/'));
  }
  return out.sort();
}

/**
 * Skills are folders containing a SKILL.md (front matter `name` + `description`, markdown body)
 * plus optional reference files. Built-in skills ship in `skills/`; user skills live in
 * `<dataDir>/skills/` and override a built-in skill with the same id.
 */
export class SkillStore {
  private readonly stateFile: string;

  constructor(
    private readonly builtinDir: string,
    private readonly userDir: string,
    dataDir: string,
  ) {
    this.stateFile = join(dataDir, 'skills-state.json');
  }

  async init(): Promise<void> {
    await mkdir(this.userDir, { recursive: true });
  }

  private async disabledIds(): Promise<Set<string>> {
    try {
      const raw = JSON.parse(await readFile(this.stateFile, 'utf8')) as { disabled?: string[] };
      return new Set(raw.disabled ?? []);
    } catch {
      return new Set();
    }
  }

  private async setDisabled(id: string, disabled: boolean): Promise<void> {
    const set = await this.disabledIds();
    if (disabled) set.add(id);
    else set.delete(id);
    await writeFileAtomic(this.stateFile, JSON.stringify({ disabled: [...set].sort() }, null, 2));
  }

  private async readSkillDir(dir: string, id: string, source: SkillSource, disabled: Set<string>): Promise<SkillDetail | null> {
    const file = join(dir, SKILL_FILE);
    if (!existsSync(file)) return null;
    const raw = await readFile(file, 'utf8');
    const parsed = parseSkillMarkdown(raw, id);
    const info = await stat(file);
    return {
      id,
      name: parsed.name,
      description: parsed.description,
      source,
      enabled: !disabled.has(id),
      files: (await listFilesRecursive(dir)).filter((f) => f !== SKILL_FILE),
      updatedAt: info.mtime.toISOString(),
      content: parsed.body,
    };
  }

  private async scan(dir: string, source: SkillSource, disabled: Set<string>): Promise<Map<string, SkillDetail>> {
    const out = new Map<string, SkillDetail>();
    if (!existsSync(dir)) return out;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9-]*$/.test(entry.name)) continue;
      const skill = await this.readSkillDir(join(dir, entry.name), entry.name, source, disabled);
      if (skill) out.set(entry.name, skill);
    }
    return out;
  }

  async listDetailed(): Promise<SkillDetail[]> {
    const disabled = await this.disabledIds();
    const merged = await this.scan(this.builtinDir, 'builtin', disabled);
    for (const [id, skill] of await this.scan(this.userDir, 'user', disabled)) {
      // An override keeps access to the reference files of the built-in skill it replaces.
      const base = merged.get(id);
      const files = base ? [...new Set([...base.files, ...skill.files])].sort() : skill.files;
      merged.set(id, { ...skill, files });
    }
    return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async list(): Promise<SkillSummary[]> {
    return (await this.listDetailed()).map(({ content: _content, ...summary }) => summary);
  }

  async get(id: string): Promise<SkillDetail | null> {
    return (await this.listDetailed()).find((s) => s.id === id) ?? null;
  }

  async readFile(id: string, path: string): Promise<string> {
    const skill = await this.get(id);
    if (!skill) throw new LocalizedError(both('store.skill.notFound', { id }), 'en');
    const candidates = [join(this.userDir, skill.id), join(this.builtinDir, skill.id)].map((dir) => resolveInside(dir, path));
    const full = candidates.find((c) => existsSync(c));
    if (!full) throw new LocalizedError(both('store.skill.fileNotFound', { path, id }), 'en');
    const info = await stat(full);
    if (info.size > MAX_SKILL_FILE_BYTES) throw new LocalizedError(both('store.skill.fileTooLarge', { bytes: MAX_SKILL_FILE_BYTES }), 'en');
    return readFile(full, 'utf8');
  }

  async create(input: SkillInput): Promise<SkillDetail> {
    const id = slugify(input.name, 'skill');
    if (existsSync(join(this.userDir, id))) throw new LocalizedError(both('store.skill.exists', { id }), 'en');
    await writeFileAtomic(join(this.userDir, id, SKILL_FILE), renderSkillMarkdown(input));
    await this.setDisabled(id, input.enabled === false);
    return (await this.get(id))!;
  }

  /** Updating a built-in skill stores an override copy in the user directory. */
  async update(id: string, input: Partial<SkillInput>): Promise<SkillDetail> {
    const current = await this.get(id);
    if (!current) throw new LocalizedError(both('store.skill.notFound', { id }), 'en');
    if (input.name !== undefined || input.description !== undefined || input.content !== undefined) {
      await writeFileAtomic(
        join(this.userDir, id, SKILL_FILE),
        renderSkillMarkdown({
          name: input.name ?? current.name,
          description: input.description ?? current.description,
          content: input.content ?? current.content,
        }),
      );
    }
    if (input.enabled !== undefined) await this.setDisabled(id, !input.enabled);
    return (await this.get(id))!;
  }

  /** Deletes a user skill. For an overridden built-in skill this restores the original. */
  async remove(id: string): Promise<'deleted' | 'reverted'> {
    const userPath = join(this.userDir, id);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || !existsSync(userPath)) {
      throw new LocalizedError(both('store.skill.notUserSkill', { id }), 'en');
    }
    await rm(userPath, { recursive: true, force: true });
    const builtinExists = existsSync(join(this.builtinDir, id, SKILL_FILE));
    if (!builtinExists) await this.setDisabled(id, false);
    return builtinExists ? 'reverted' : 'deleted';
  }

  /** Imports a raw SKILL.md (with front matter). */
  async importMarkdown(raw: string): Promise<SkillDetail> {
    const parsed = parseSkillMarkdown(raw, 'imported-skill');
    if (!parsed.body) throw new LocalizedError(both('store.skill.noContent'), 'en');
    return this.create({ name: parsed.name, description: parsed.description, content: parsed.body });
  }
}
