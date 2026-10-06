import type { ValidationIssue, ValidationResult } from '../validation.js';
import type { FragmentKind, SequenceDiagram } from './model.js';

/** Words that break Mermaid or PlantUML when used as a participant id. */
const RESERVED = new Set(
  [
    'end', 'alt', 'else', 'opt', 'loop', 'par', 'and', 'critical', 'option', 'break', 'rect', 'note', 'participant',
    'actor', 'activate', 'deactivate', 'autonumber', 'box', 'title', 'over', 'left', 'right', 'of', 'as', 'create',
    'destroy', 'links', 'link', 'properties', 'details', 'group', 'sequencediagram', 'boundary', 'control', 'entity',
    'database', 'queue', 'collections', 'return', 'ref', 'hnote', 'rnote', 'skinparam', 'startuml', 'enduml',
  ].map((w) => w.toLowerCase()),
);

const MULTI_BRANCH: FragmentKind[] = ['alt', 'par', 'critical'];

export function validateSequence(diagram: SequenceDiagram): ValidationResult<SequenceDiagram> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const ids = new Set<string>();
  diagram.participants.forEach((p, i) => {
    if (ids.has(p.id)) errors.push({ path: `participants[${i}].id`, message: `Duplicate participant id "${p.id}"` });
    if (RESERVED.has(p.id.toLowerCase())) {
      errors.push({ path: `participants[${i}].id`, message: `"${p.id}" is a reserved word in Mermaid/PlantUML; choose another id` });
    }
    ids.add(p.id);
  });

  const active = new Map<string, number>();
  const used = new Set<string>();
  const stack: Array<{ kind: FragmentKind; index: number; branchHasContent: boolean }> = [];
  let messages = 0;

  diagram.steps.forEach((step, i) => {
    const path = `steps[${i}]`;
    switch (step.type) {
      case 'message': {
        messages += 1;
        for (const [field, id] of [['from', step.from], ['to', step.to]] as const) {
          if (!ids.has(id)) errors.push({ path: `${path}.${field}`, message: `Unknown participant "${id}"` });
          used.add(id);
        }
        if (step.deactivate) {
          const n = active.get(step.from) ?? 0;
          if (n === 0) {
            errors.push({ path: `${path}.deactivate`, message: `"${step.from}" has no active activation to end at this point` });
          } else active.set(step.from, n - 1);
        }
        if (step.activate) active.set(step.to, (active.get(step.to) ?? 0) + 1);
        if (step.style === 'reply' && step.from === step.to) {
          warnings.push({ path, message: 'A reply message to the same participant is unusual' });
        }
        if (stack.length) stack[stack.length - 1]!.branchHasContent = true;
        break;
      }
      case 'note':
        step.over.forEach((id, k) => {
          if (!ids.has(id)) errors.push({ path: `${path}.over[${k}]`, message: `Unknown participant "${id}"` });
        });
        if (step.over.length === 2 && step.over[0] === step.over[1]) {
          errors.push({ path: `${path}.over`, message: 'Use a single participant instead of the same one twice' });
        }
        if (stack.length) stack[stack.length - 1]!.branchHasContent = true;
        break;
      case 'divider':
        if (stack.length) errors.push({ path, message: 'Dividers cannot be placed inside a fragment' });
        break;
      case 'fragment_start':
        if (stack.length) stack[stack.length - 1]!.branchHasContent = true;
        stack.push({ kind: step.kind, index: i, branchHasContent: false });
        if (stack.length > 4) warnings.push({ path, message: 'Fragments nested more than 4 levels deep are hard to read' });
        break;
      case 'fragment_else': {
        const top = stack[stack.length - 1];
        if (!top) {
          errors.push({ path, message: 'fragment_else without an open fragment' });
        } else if (!MULTI_BRANCH.includes(top.kind)) {
          errors.push({ path, message: `"${top.kind}" fragments have a single branch; fragment_else is only valid in alt, par or critical` });
        } else {
          if (!top.branchHasContent) errors.push({ path, message: `The previous branch of the "${top.kind}" fragment is empty` });
          top.branchHasContent = false;
        }
        break;
      }
      case 'fragment_end': {
        const top = stack.pop();
        if (!top) errors.push({ path, message: 'fragment_end without an open fragment' });
        else if (!top.branchHasContent) errors.push({ path, message: `The last branch of the "${top.kind}" fragment opened at steps[${top.index}] is empty` });
        break;
      }
    }
  });

  for (const open of stack) {
    errors.push({ path: `steps[${open.index}]`, message: `"${open.kind}" fragment is never closed with fragment_end` });
  }
  if (messages === 0) errors.push({ path: 'steps', message: 'The diagram has no messages' });
  for (const p of diagram.participants) {
    if (!used.has(p.id)) warnings.push({ path: 'participants', message: `Participant "${p.label}" sends or receives no message` });
  }
  for (const [id, n] of active) {
    if (n > 0) warnings.push({ path: 'steps', message: `"${id}" still has ${n} open activation(s) at the end of the diagram` });
  }

  if (errors.length) return { ok: false, errors, warnings };
  return { ok: true, value: diagram, errors, warnings };
}
