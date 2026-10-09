import type { ValidationIssue } from '../validation.js';
import { buildDocument, type BuiltDocument } from './document.js';
import { TechSpecSchema, type ResolvedDiagram, type TechSpec } from './model.js';
import { renderTechSpecHtml, renderTechSpecMarkdown } from './render.js';

export interface TechSpecBuildOutput {
  spec: TechSpec;
  /** The format-neutral document the Markdown, HTML and Word (renderTechSpecDocx) files are rendered from. */
  document: BuiltDocument;
  markdown: string;
  html: string;
  warnings: ValidationIssue[];
}

export type TechSpecBuildResult =
  | { ok: true; output: TechSpecBuildOutput }
  | { ok: false; errors: ValidationIssue[]; warnings: ValidationIssue[] };

function uniqueIds(items: Array<{ id?: string }>, path: string, errors: ValidationIssue[], seen: Map<string, string>): void {
  items.forEach((item, i) => {
    if (!item.id) return;
    const key = item.id.trim().toLowerCase();
    const other = seen.get(key);
    if (other) errors.push({ path: `${path}[${i}].id`, message: `Id "${item.id}" is already used by ${other}` });
    else seen.set(key, `${path}[${i}]`);
  });
}

/**
 * Validates the specification (unique ids, resolvable diagrams) and renders Markdown + HTML.
 * `diagrams` holds every SVG artifact of the task that the document may reference.
 */
export function buildTechSpec(input: unknown, diagrams: Map<string, ResolvedDiagram>, today: string): TechSpecBuildResult {
  const parsed = TechSpecSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })),
      warnings: [],
    };
  }
  const spec = parsed.data;
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const seen = new Map<string, string>();
  uniqueIds(spec.functionalRequirements, 'functionalRequirements', errors, seen);
  uniqueIds(spec.nonFunctionalRequirements, 'nonFunctionalRequirements', errors, seen);
  uniqueIds(spec.decisions, 'decisions', errors, seen);
  uniqueIds(spec.integrations, 'integrations', errors, seen);
  uniqueIds(spec.risks, 'risks', errors, seen);
  uniqueIds(spec.openIssues, 'openIssues', errors, seen);

  const checkDiagram = (artifactId: string, path: string) => {
    if (!diagrams.has(artifactId)) {
      errors.push({
        path,
        message: `Artifact "${artifactId}" is not an SVG diagram of this task. Create the diagram first and use the SVG artifact id returned by the tool.`,
      });
    }
  };
  spec.architecture.diagrams.forEach((d, i) => checkDiagram(d.artifactId, `architecture.diagrams[${i}].artifactId`));
  spec.processFlows.forEach((p, i) => {
    if (p.diagram) checkDiagram(p.diagram.artifactId, `processFlows[${i}].diagram.artifactId`);
  });

  spec.functionalRequirements.forEach((r, i) => {
    if (r.acceptanceCriteria.length === 0) {
      warnings.push({ path: `functionalRequirements[${i}]`, message: `${r.id} has no acceptance criteria` });
    }
  });
  spec.nonFunctionalRequirements.forEach((r, i) => {
    if (!r.metric) warnings.push({ path: `nonFunctionalRequirements[${i}]`, message: `${r.id} has no measurable target` });
  });
  if (spec.architecture.diagrams.length === 0) {
    warnings.push({ path: 'architecture.diagrams', message: 'The document contains no architecture diagram' });
  }

  if (errors.length) return { ok: false, errors, warnings };
  const doc = buildDocument(spec, diagrams, today);
  return {
    ok: true,
    output: { spec, document: doc, markdown: renderTechSpecMarkdown(doc), html: renderTechSpecHtml(doc), warnings },
  };
}

export { TechSpecSchema } from './model.js';
export type { ResolvedDiagram } from './model.js';
export type { BuiltDocument } from './document.js';
// The Word renderer (./docx.js) is not re-exported: the server runs it in a worker thread (tasks/techSpecDocxIsolated.ts),
// and importing it here would load the docx library and the rasterizer into the server bundles.
