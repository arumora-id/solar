import type { Participant, SequenceDiagram } from './model.js';

function quote(text: string): string {
  return `"${text.replace(/"/g, "'").replace(/\r?\n/g, '\\n')}"`;
}

function plantText(text: string): string {
  return text.replace(/\r?\n/g, '\\n').trim();
}

const ARROW = { sync: '->', async: '->>', reply: '-->' } as const;

function declare(p: Participant): string {
  switch (p.kind) {
    case 'external':
      return `participant ${quote(p.label)} as ${p.id} <<external>>`;
    default:
      return `${p.kind} ${quote(p.label)} as ${p.id}`;
  }
}

/** PlantUML source for teams that keep diagrams-as-code in PlantUML. */
export function toPlantUml(d: SequenceDiagram): string {
  const out: string[] = ['@startuml', `title ${plantText(d.title)}`];
  if (d.autonumber) out.push('autonumber');
  for (const p of d.participants) out.push(declare(p));
  out.push('');
  let depth = 0;
  const pad = () => '  '.repeat(depth);
  for (const step of d.steps) {
    switch (step.type) {
      case 'message': {
        // PlantUML: "--" ends the sender's activation, "++" starts the receiver's; combined it must be "--++"
        const suffix = step.activate && step.deactivate ? ' --++' : step.activate ? ' ++' : step.deactivate ? ' --' : '';
        out.push(`${pad()}${step.from} ${ARROW[step.style]} ${step.to}${suffix} : ${plantText(step.text)}`);
        break;
      }
      case 'note':
        out.push(`${pad()}note over ${step.over.join(', ')} : ${plantText(step.text)}`);
        break;
      case 'divider':
        out.push(`== ${plantText(step.text)} ==`);
        break;
      case 'fragment_start':
        out.push(`${pad()}${step.kind}${step.label ? ` ${plantText(step.label)}` : ''}`);
        depth += 1;
        break;
      case 'fragment_else':
        out.push(`${'  '.repeat(Math.max(0, depth - 1))}else${step.label ? ` ${plantText(step.label)}` : ''}`);
        break;
      case 'fragment_end':
        depth -= 1;
        out.push(`${pad()}end`);
        break;
    }
  }
  out.push('@enduml');
  return `${out.join('\n')}\n`;
}
