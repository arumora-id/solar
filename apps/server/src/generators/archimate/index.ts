import type { ValidationIssue } from '../validation.js';
import { toExchangeXml } from './exchange.js';
import { layoutView, type ViewLayout } from './layout.js';
import { ArchimateModelSchema, type ArchimateModelInput, type NormalizedArchimateModel } from './model.js';
import { renderViewSvg } from './svg.js';
import { validateArchimateModel } from './validate.js';

export interface ArchimateBuildOutput {
  model: NormalizedArchimateModel;
  exchangeXml: string;
  views: Array<{ id: string; name: string; svg: string; elementCount: number; relationshipCount: number }>;
  warnings: ValidationIssue[];
}

export type ArchimateBuildResult =
  | { ok: true; output: ArchimateBuildOutput }
  | { ok: false; errors: ValidationIssue[]; warnings: ValidationIssue[] };

/** Parses, validates and renders an ArchiMate model (exchange XML + one SVG per view). */
export function buildArchimate(input: ArchimateModelInput | unknown): ArchimateBuildResult {
  const parsed = ArchimateModelSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })),
      warnings: [],
    };
  }
  const validation = validateArchimateModel(parsed.data);
  if (!validation.ok) return { ok: false, errors: validation.errors, warnings: validation.warnings };
  const model = validation.value;

  const byId = new Map(model.elements.map((e) => [e.id, e]));
  const relById = new Map(model.relationships.map((r) => [r.id, r]));
  const layouts = new Map<string, ViewLayout>();
  const views: ArchimateBuildOutput['views'] = [];
  for (const view of model.views) {
    const elements = view.elements.map((id) => byId.get(id)!);
    const relationships = view.relationships.map((id) => relById.get(id)!);
    const layout = layoutView(elements, relationships);
    layouts.set(view.id, layout);
    views.push({
      id: view.id,
      name: view.name,
      svg: renderViewSvg(layout, { modelName: model.name, viewName: view.name, viewpoint: view.viewpoint, relationships }),
      elementCount: elements.length,
      relationshipCount: relationships.length,
    });
  }
  return { ok: true, output: { model, exchangeXml: toExchangeXml(model, layouts), views, warnings: validation.warnings } };
}

export { ArchimateModelSchema } from './model.js';
export { ELEMENT_INFO, ELEMENT_TYPES, RELATIONSHIP_TYPES, allowedRelationships } from './metamodel.js';
