import type { ValidationIssue, ValidationResult } from '../validation.js';
import { ELEMENT_INFO, allowedRelationships, isJunction } from './metamodel.js';
import type { ArchimateModel, ArchimateRelationship, NormalizedArchimateModel } from './model.js';

const MAX_ELEMENTS_PER_VIEW = 60;

/**
 * Validates a model against the ArchiMate 3.2 metamodel (relationship table from the specification's
 * Appendix B), referential integrity, junction rules and view consistency.
 */
export function validateArchimateModel(model: ArchimateModel): ValidationResult<NormalizedArchimateModel> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // --- elements -----------------------------------------------------------
  const elements = new Map<string, (typeof model.elements)[number]>();
  const nameKeys = new Map<string, string>();
  model.elements.forEach((el, i) => {
    if (elements.has(el.id)) errors.push({ path: `elements[${i}].id`, message: `Duplicate element id "${el.id}"` });
    elements.set(el.id, el);
    const key = `${el.type}::${el.name.trim().toLowerCase()}`;
    const other = nameKeys.get(key);
    if (other) {
      warnings.push({
        path: `elements[${i}]`,
        message: `"${el.name}" (${el.type}) duplicates element "${other}"; reuse one element instead of two copies`,
      });
    } else nameKeys.set(key, el.id);
    for (const k of Object.keys(el.properties ?? {})) {
      if (!k.trim()) errors.push({ path: `elements[${i}].properties`, message: 'Property keys must not be empty' });
    }
  });

  // --- relationships ------------------------------------------------------
  const usedIds = new Set<string>(elements.keys());
  model.relationships.forEach((r, i) => {
    if (!r.id) return;
    if (usedIds.has(r.id)) errors.push({ path: `relationships[${i}].id`, message: `Id "${r.id}" is already used` });
    usedIds.add(r.id);
  });
  let counter = 0;
  const relationships: ArchimateRelationship[] = model.relationships.map((r) => {
    if (r.id) return { ...r, id: r.id };
    let generated: string;
    do generated = `rel-${++counter}`;
    while (usedIds.has(generated));
    usedIds.add(generated);
    return { ...r, id: generated };
  });

  const seen = new Map<string, string>();
  const degree = new Map<string, number>();
  relationships.forEach((r, i) => {
    const path = `relationships[${i}]`;
    const source = elements.get(r.source);
    const target = elements.get(r.target);
    if (!source) errors.push({ path: `${path}.source`, message: `Unknown source element "${r.source}"` });
    if (!target) errors.push({ path: `${path}.target`, message: `Unknown target element "${r.target}"` });
    if (!source || !target) return;

    const allowed = allowedRelationships(source.type, target.type);
    if (!allowed.includes(r.type)) {
      errors.push({
        path,
        message:
          `${r.type} is not allowed from ${source.type} "${source.name}" to ${target.type} "${target.name}" in ArchiMate 3.2. ` +
          (allowed.length ? `Allowed: ${allowed.join(', ')}.` : 'No relationship is allowed between these types.'),
      });
    }
    if (r.accessType !== undefined && r.type !== 'Access') {
      warnings.push({ path: `${path}.accessType`, message: 'accessType is only used on Access relationships and was ignored' });
      r.accessType = undefined;
    }
    if (r.isDirected !== undefined && r.type !== 'Association') {
      warnings.push({ path: `${path}.isDirected`, message: 'isDirected is only used on Association relationships and was ignored' });
      r.isDirected = undefined;
    }
    if (r.influenceModifier !== undefined && r.type !== 'Influence') {
      warnings.push({ path: `${path}.influenceModifier`, message: 'influenceModifier is only used on Influence relationships and was ignored' });
      r.influenceModifier = undefined;
    }
    if (r.source === r.target) {
      warnings.push({ path, message: `${r.type} relationship from "${source.name}" to itself; check that this is intended` });
    }
    const key = `${r.type}|${r.source}|${r.target}|${r.accessType ?? ''}`;
    const dup = seen.get(key);
    if (dup) warnings.push({ path, message: `Duplicate of relationship "${dup}" (same type, source and target)` });
    else seen.set(key, r.id);
    degree.set(r.source, (degree.get(r.source) ?? 0) + 1);
    degree.set(r.target, (degree.get(r.target) ?? 0) + 1);
  });

  // --- junctions ----------------------------------------------------------
  // Non-junction elements reached by following relationships through (chains of) junctions.
  const ends = (start: string, direction: 'in' | 'out'): Set<string> => {
    const found = new Set<string>();
    const visited = new Set<string>([start]);
    const stack = [start];
    while (stack.length) {
      const id = stack.pop()!;
      for (const r of relationships) {
        const next = direction === 'in' ? (r.target === id ? r.source : null) : r.source === id ? r.target : null;
        if (!next || visited.has(next)) continue;
        visited.add(next);
        const nextEl = elements.get(next);
        if (!nextEl) continue;
        if (isJunction(nextEl.type)) stack.push(next);
        else found.add(next);
      }
    }
    return found;
  };
  const checkedThroughJunction = new Set<string>();
  for (const el of elements.values()) {
    if (!isJunction(el.type)) continue;
    const incoming = relationships.filter((r) => r.target === el.id);
    const outgoing = relationships.filter((r) => r.source === el.id);
    const types = new Set([...incoming, ...outgoing].map((r) => r.type));
    if (types.size > 1) {
      errors.push({
        path: `elements[${model.elements.indexOf(el)}]`,
        message: `Junction "${el.name}" connects relationships of different types (${[...types].join(', ')}); all relationships of a junction must have the same type`,
      });
    } else if (types.size === 1) {
      // A relationship through a junction is only valid if the direct relationship between its end elements is valid.
      const type = [...types][0]!;
      for (const srcId of ends(el.id, 'in')) {
        for (const tgtId of ends(el.id, 'out')) {
          const key = `${srcId}|${tgtId}|${type}`;
          if (checkedThroughJunction.has(key)) continue;
          checkedThroughJunction.add(key);
          const src = elements.get(srcId)!;
          const tgt = elements.get(tgtId)!;
          const allowed = allowedRelationships(src.type, tgt.type);
          if (!allowed.includes(type)) {
            errors.push({
              path: `elements[${model.elements.indexOf(el)}]`,
              message:
                `Via junction "${el.name}", ${type} connects ${src.type} "${src.name}" to ${tgt.type} "${tgt.name}", which is not allowed in ArchiMate 3.2 ` +
                `(a relationship through a junction must also be valid directly). ` +
                (allowed.length ? `Allowed: ${allowed.join(', ')}.` : 'No relationship is allowed between these types.'),
            });
          }
        }
      }
    }
    if (incoming.length === 0 || outgoing.length === 0) {
      warnings.push({ path: `elements[${model.elements.indexOf(el)}]`, message: `Junction "${el.name}" should have at least one incoming and one outgoing relationship` });
    }
  }

  for (const el of elements.values()) {
    if (!degree.has(el.id) && el.type !== 'Grouping') {
      warnings.push({ path: `elements[${model.elements.indexOf(el)}]`, message: `Element "${el.name}" (${el.type}) has no relationships` });
    }
  }

  // --- views --------------------------------------------------------------
  const relById = new Map(relationships.map((r) => [r.id, r]));
  const viewsInput = model.views?.length ? model.views : [{ name: model.name, viewpoint: 'Layered' as string | undefined }];
  const viewIds = new Set<string>();
  const shown = new Set<string>();
  const views: NormalizedArchimateModel['views'] = viewsInput.map((v, vi) => {
    const path = `views[${vi}]`;
    let vid = 'id' in v && v.id ? v.id : `view-${vi + 1}`;
    if (viewIds.has(vid) || usedIds.has(vid)) {
      if ('id' in v && v.id) errors.push({ path: `${path}.id`, message: `Id "${vid}" is already used` });
      vid = `view-${vi + 1}-${viewIds.size + 1}`;
    }
    viewIds.add(vid);

    const explicitElements = 'elements' in v && v.elements ? v.elements : undefined;
    const viewElements = explicitElements ?? model.elements.map((e) => e.id);
    const elementSet = new Set<string>();
    viewElements.forEach((eid, i) => {
      if (!elements.has(eid)) errors.push({ path: `${path}.elements[${i}]`, message: `Unknown element "${eid}"` });
      else if (elementSet.has(eid)) warnings.push({ path: `${path}.elements[${i}]`, message: `Element "${eid}" listed twice` });
      else elementSet.add(eid);
    });

    const explicitRels = 'relationships' in v && v.relationships ? v.relationships : undefined;
    const viewRels: string[] = [];
    if (explicitRels) {
      explicitRels.forEach((rid, i) => {
        const rel = relById.get(rid);
        if (!rel) {
          errors.push({ path: `${path}.relationships[${i}]`, message: `Unknown relationship "${rid}"` });
          return;
        }
        if (!elementSet.has(rel.source) || !elementSet.has(rel.target)) {
          errors.push({
            path: `${path}.relationships[${i}]`,
            message: `Relationship "${rid}" needs both "${rel.source}" and "${rel.target}" in the view`,
          });
          return;
        }
        if (!viewRels.includes(rid)) viewRels.push(rid);
      });
    } else {
      for (const r of relationships) if (elementSet.has(r.source) && elementSet.has(r.target)) viewRels.push(r.id);
    }

    if (elementSet.size === 0) errors.push({ path, message: `View "${v.name}" has no elements` });
    if (elementSet.size > MAX_ELEMENTS_PER_VIEW) {
      warnings.push({ path, message: `View "${v.name}" has ${elementSet.size} elements; consider splitting it (max ${MAX_ELEMENTS_PER_VIEW} recommended)` });
    }
    elementSet.forEach((e) => shown.add(e));
    return { ...v, id: vid, elements: [...elementSet], relationships: viewRels };
  });

  for (const el of elements.values()) {
    if (!shown.has(el.id)) warnings.push({ path: 'views', message: `Element "${el.name}" is not shown in any view` });
  }

  if (errors.length > 0) return { ok: false, errors, warnings };
  return {
    ok: true,
    errors,
    warnings,
    value: {
      name: model.name,
      documentation: model.documentation,
      language: model.language ?? 'en',
      elements: model.elements,
      relationships,
      views,
    },
  };
}

/** Human friendly label of an element type, e.g. "Application Component". */
export function typeLabel(type: keyof typeof ELEMENT_INFO): string {
  return ELEMENT_INFO[type].label;
}
