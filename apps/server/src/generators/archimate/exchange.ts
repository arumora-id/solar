import { escapeXml } from '../validation.js';
import type { ViewLayout } from './layout.js';
import type { NormalizedArchimateModel } from './model.js';

/** Prefix that turns user ids into valid xs:ID values (NCName must not start with a digit). */
export const xmlId = (id: string) => `id-${id}`;

/**
 * Serialises the model in The Open Group ArchiMate Model Exchange File Format 3.1
 * (namespace http://www.opengroup.org/xsd/archimate/3.0/), importable by Archi, Visual Paradigm,
 * BiZZdesign, Sparx EA and other tools that support the standard.
 */
export function toExchangeXml(model: NormalizedArchimateModel, layouts: Map<string, ViewLayout>): string {
  const lang = escapeXml(model.language);
  const text = (tag: string, value: string | undefined, indent: string) =>
    value === undefined || value.trim() === '' ? '' : `${indent}<${tag} xml:lang="${lang}">${escapeXml(value)}</${tag}>\n`;

  // property definitions (one per distinct key)
  const propKeys = [...new Set(model.elements.flatMap((e) => Object.keys(e.properties ?? {})))].sort();
  const propId = new Map(propKeys.map((k, i) => [k, `propid-${i + 1}`]));

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml +=
    '<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/"\n' +
    '       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n' +
    '       xsi:schemaLocation="http://www.opengroup.org/xsd/archimate/3.0/ http://www.opengroup.org/xsd/archimate/3.1/archimate3_Diagram.xsd"\n' +
    `       identifier="${escapeXml(xmlId(`model-${slugId(model.name)}`))}">\n`;
  xml += text('name', model.name, '  ');
  xml += text('documentation', model.documentation, '  ');

  xml += '  <elements>\n';
  for (const el of model.elements) {
    xml += `    <element identifier="${escapeXml(xmlId(el.id))}" xsi:type="${el.type}">\n`;
    xml += text('name', el.name, '      ');
    xml += text('documentation', el.documentation, '      ');
    const props = Object.entries(el.properties ?? {});
    if (props.length) {
      xml += '      <properties>\n';
      for (const [k, v] of props) {
        xml += `        <property propertyDefinitionRef="${propId.get(k)}">\n`;
        xml += `          <value xml:lang="${lang}">${escapeXml(v)}</value>\n`;
        xml += '        </property>\n';
      }
      xml += '      </properties>\n';
    }
    xml += '    </element>\n';
  }
  xml += '  </elements>\n';

  if (model.relationships.length) {
    xml += '  <relationships>\n';
    for (const r of model.relationships) {
      let attrs = `identifier="${escapeXml(xmlId(r.id))}" source="${escapeXml(xmlId(r.source))}" target="${escapeXml(xmlId(r.target))}" xsi:type="${r.type}"`;
      if (r.type === 'Access') attrs += ` accessType="${r.accessType ?? 'Access'}"`;
      if (r.type === 'Association') attrs += ` isDirected="${r.isDirected ? 'true' : 'false'}"`;
      if (r.type === 'Influence' && r.influenceModifier) attrs += ` modifier="${escapeXml(r.influenceModifier)}"`;
      const body = text('name', r.name, '      ') + text('documentation', r.documentation, '      ');
      xml += body ? `    <relationship ${attrs}>\n${body}    </relationship>\n` : `    <relationship ${attrs}/>\n`;
    }
    xml += '  </relationships>\n';
  }

  if (propKeys.length) {
    xml += '  <propertyDefinitions>\n';
    for (const k of propKeys) {
      xml += `    <propertyDefinition identifier="${propId.get(k)}" type="string">\n`;
      xml += `      <name xml:lang="${lang}">${escapeXml(k)}</name>\n`;
      xml += '    </propertyDefinition>\n';
    }
    xml += '  </propertyDefinitions>\n';
  }

  xml += '  <views>\n    <diagrams>\n';
  model.views.forEach((view, vi) => {
    const layout = layouts.get(view.id);
    if (!layout) return;
    xml += `      <view identifier="${escapeXml(xmlId(view.id))}" xsi:type="Diagram">\n`;
    xml += text('name', view.name, '        ');
    xml += text('documentation', view.documentation, '        ');
    for (const eid of view.elements) {
      const n = layout.nodes.get(eid);
      if (!n) continue;
      xml += `        <node identifier="${escapeXml(xmlId(`v${vi + 1}-n-${eid}`))}" elementRef="${escapeXml(xmlId(eid))}" xsi:type="Element" x="${n.x}" y="${n.y}" w="${n.w}" h="${n.h}"/>\n`;
    }
    for (const rid of view.relationships) {
      const r = model.relationships.find((x) => x.id === rid);
      if (!r || !layout.nodes.has(r.source) || !layout.nodes.has(r.target)) continue;
      xml += `        <connection identifier="${escapeXml(xmlId(`v${vi + 1}-c-${rid}`))}" relationshipRef="${escapeXml(xmlId(rid))}" xsi:type="Relationship" source="${escapeXml(xmlId(`v${vi + 1}-n-${r.source}`))}" target="${escapeXml(xmlId(`v${vi + 1}-n-${r.target}`))}"/>\n`;
    }
    xml += '      </view>\n';
  });
  xml += '    </diagrams>\n  </views>\n';
  xml += '</model>\n';
  return xml;
}

function slugId(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 40) || 'model'
  );
}
