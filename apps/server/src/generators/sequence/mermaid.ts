import type { Participant, SequenceDiagram } from './model.js';

/** Escapes free text for Mermaid sequence diagrams (`;` and `#` would end/alter a statement). */
export function mermaidText(text: string): string {
  // single pass, otherwise the ";" of an inserted "#35;" entity would be escaped again
  return text
    .trim()
    .replace(/[#;%]/g, (ch) => (ch === '#' ? '#35;' : ch === ';' ? '#59;' : '#37;'))
    .replace(/\r?\n/g, '<br/>');
}

const ARROW = { sync: '->>', async: '-)', reply: '-->>' } as const;

function declare(p: Participant): string {
  const keyword = p.kind === 'actor' ? 'actor' : 'participant';
  const label = p.kind === 'external' ? `${p.label} (external)` : p.label;
  return `    ${keyword} ${p.id} as ${mermaidText(label)}`;
}

/** Mermaid `sequenceDiagram` source (renders natively on GitHub, GitLab, Confluence plugins, Notion...). */
export function toMermaid(d: SequenceDiagram): string {
  const out: string[] = ['sequenceDiagram'];
  out.push(`    title ${mermaidText(d.title)}`);
  if (d.autonumber) out.push('    autonumber');
  for (const p of d.participants) out.push(declare(p));

  const first = d.participants[0]!.id;
  const last = d.participants[d.participants.length - 1]!.id;
  const kinds: string[] = [];
  let depth = 1;
  const pad = () => '    '.repeat(depth);

  for (const step of d.steps) {
    switch (step.type) {
      case 'message': {
        const marker = step.activate ? '+' : step.deactivate ? '-' : '';
        out.push(`${pad()}${step.from}${ARROW[step.style]}${marker}${step.to}: ${mermaidText(step.text)}`);
        // Mermaid allows only one shortcut per arrow; emit the other one explicitly.
        if (step.activate && step.deactivate) out.push(`${pad()}deactivate ${step.from}`);
        break;
      }
      case 'note':
        out.push(`${pad()}Note over ${step.over.join(',')}: ${mermaidText(step.text)}`);
        break;
      case 'divider':
        out.push(`${pad()}Note over ${first === last ? first : `${first},${last}`}: ${mermaidText(`— ${step.text} —`)}`);
        break;
      case 'fragment_start': {
        kinds.push(step.kind);
        const label = mermaidText(step.label);
        if (step.kind === 'group') {
          out.push(`${pad()}rect rgba(127, 127, 127, 0.08)`);
          depth += 1;
          if (label) out.push(`${pad()}Note over ${first === last ? first : `${first},${last}`}: ${label}`);
          depth -= 1;
        } else {
          out.push(`${pad()}${step.kind}${label ? ` ${label}` : ''}`);
        }
        depth += 1;
        break;
      }
      case 'fragment_else': {
        const kind = kinds[kinds.length - 1];
        const keyword = kind === 'par' ? 'and' : kind === 'critical' ? 'option' : 'else';
        const label = mermaidText(step.label);
        out.push(`${'    '.repeat(depth - 1)}${keyword}${label ? ` ${label}` : ''}`);
        break;
      }
      case 'fragment_end':
        kinds.pop();
        depth -= 1;
        out.push(`${pad()}end`);
        break;
    }
  }
  return `${out.join('\n')}\n`;
}
