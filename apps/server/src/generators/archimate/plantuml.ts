import type { NormalizedArchimateModel } from './model.js';
import { ELEMENT_INFO } from './metamodel.js';

/**
 * Portable PlantUML for VP Online / VPasCode, using only built-in PlantUML
 * constructs. Types and definitions are displayed as labels and notes;
 * use the Open Group Exchange XML for full ArchiMate metamodel semantics.
 */
function label(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/"/g, "'")
    .replace(/\r?\n/g, '\\n')
    .replace(/[\u0000-\u001f]/g, ' ')
    .trim();
}

const color: Record<string, string> = {
  business: '#FFF0C4',
  application: '#D9EEFF',
  technology: '#DDF3DD',
  physical: '#E9F1D7',
  motivation: '#F1E4F9',
  strategy: '#FBE3E7',
  implementation: '#FDE6D5',
  other: '#F2F2F2',
};

/** One standalone editable-as-code PlantUML source per ArchiMate view. */
export function toPlantUmlArchimate(
  model: NormalizedArchimateModel,
  view: NormalizedArchimateModel['views'][number],
): string {
  const byId = new Map(model.elements.map((element) => [element.id, element]));
  const aliases = new Map<string, string>();
  const out = [
    '@startuml',
    'title ' + label(model.name + ' — ' + view.name),
    'top to bottom direction',
    'skinparam shadowing false',
    'skinparam defaultFontName Arial',
    'skinparam componentStyle rectangle',
    '',
  ];
  for (const [index, elementId] of view.elements.entries()) {
    const element = byId.get(elementId);
    if (!element) continue;
    const alias = 'E' + index;
    aliases.set(elementId, alias);
    const info = ELEMENT_INFO[element.type];
    out.push('rectangle "' + label(element.name) + '\\n«' + info.label + '»" as ' + alias + ' ' + (color[info.layer] ?? color.other));
    const definition = [
      element.documentation ?? '',
      ...Object.entries(element.properties ?? {}).map(([key, value]) => key + ': ' + value),
    ].filter(Boolean).join('\n');
    if (definition) out.push('note right of ' + alias + ' : ' + label(definition));
  }
  out.push('');
  for (const relationId of view.relationships) {
    const relation = model.relationships.find((candidate) => candidate.id === relationId);
    if (!relation) continue;
    const source = aliases.get(relation.source);
    const target = aliases.get(relation.target);
    if (!source || !target) continue;
    const title = [relation.type, relation.name, relation.documentation].filter(Boolean).join(' — ');
    out.push(source + (relation.isDirected === false ? ' -- ' : ' --> ') + target + ' : ' + label(title));
  }
  out.push('@enduml', '');
  return out.join('\n');
}
