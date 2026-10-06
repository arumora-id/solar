import { randomUUID } from 'node:crypto';

/** Short, sortable-enough, URL-safe identifier with a readable prefix (e.g. `task_3f9c...`). */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/** Lower-case, dash separated slug safe for file names and identifiers. */
export function slugify(input: string, fallback = 'item'): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || fallback;
}

export function nowIso(): string {
  return new Date().toISOString();
}
