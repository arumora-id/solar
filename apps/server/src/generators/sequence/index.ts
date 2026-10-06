import type { ValidationIssue } from '../validation.js';
import { toMermaid } from './mermaid.js';
import { SequenceDiagramSchema, type SequenceDiagram } from './model.js';
import { toPlantUml } from './plantuml.js';
import { toSequenceSvg } from './svg.js';
import { validateSequence } from './validate.js';

export interface SequenceBuildOutput {
  diagram: SequenceDiagram;
  mermaid: string;
  plantuml: string;
  svg: string;
  warnings: ValidationIssue[];
}

export type SequenceBuildResult =
  | { ok: true; output: SequenceBuildOutput }
  | { ok: false; errors: ValidationIssue[]; warnings: ValidationIssue[] };

/** Parses, validates and renders a sequence diagram (Mermaid, PlantUML and SVG). */
export function buildSequence(input: unknown): SequenceBuildResult {
  const parsed = SequenceDiagramSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })),
      warnings: [],
    };
  }
  const validation = validateSequence(parsed.data);
  if (!validation.ok) return { ok: false, errors: validation.errors, warnings: validation.warnings };
  const diagram = validation.value;
  return {
    ok: true,
    output: {
      diagram,
      mermaid: toMermaid(diagram),
      plantuml: toPlantUml(diagram),
      svg: toSequenceSvg(diagram),
      warnings: validation.warnings,
    },
  };
}

export { SequenceDiagramSchema } from './model.js';
