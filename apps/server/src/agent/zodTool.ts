import { z } from 'zod';
import { formatIssues } from '../generators/validation.js';
import type { TaskRunContext } from '../tasks/taskManager.js';
import type { AgentTool, ToolOutput } from './types.js';

/** JSON Schema for function tools from a zod schema (draft 2020-12, input side of defaults). */
export function toInputSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  const clean = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(clean);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        if (k === '$schema' || k === 'propertyNames') continue;
        out[k] = clean(v);
      }
      return out;
    }
    return node;
  };
  return clean(json) as Record<string, unknown>;
}

export function zodTool<S extends z.ZodType>(def: {
  name: string;
  displayName: string;
  description: string;
  schema: S;
  confirmation?: (input: z.output<S>) => string | null | Promise<string | null>;
  confirmationPreview?: (input: z.output<S>) => Promise<unknown>;
  execute: (input: z.output<S>, ctx: TaskRunContext) => Promise<ToolOutput>;
}): AgentTool {
  return {
    name: def.name,
    displayName: def.displayName,
    description: def.description,
    inputSchema: toInputSchema(def.schema),
    source: 'builtin',
    parse(input) {
      const parsed = def.schema.safeParse(input);
      if (parsed.success) return { ok: true, value: parsed.data };
      return {
        ok: false,
        error: formatIssues(
          'The tool input does not match the schema',
          parsed.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })),
        ),
      };
    },
    confirmation: (input) => def.confirmation?.(input as z.output<S>) ?? null,
    confirmationPreview: def.confirmationPreview && ((input) => def.confirmationPreview!(input as z.output<S>)),
    execute: (input, ctx) => def.execute(input as z.output<S>, ctx),
  };
}

export const json = (value: unknown) => JSON.stringify(value, null, 2);
