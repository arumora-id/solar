import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildArchimate } from '../src/generators/archimate/index.js';
import { allowedRelationships, ELEMENT_TYPES } from '../src/generators/archimate/metamodel.js';
import { ARCHIMATE_RELATIONSHIP_TABLE } from '../src/generators/archimate/relationships.generated.js';
import { sampleArchimate } from './fixtures.js';

describe('ArchiMate metamodel', () => {
  it('covers every element type in the relationship table', () => {
    for (const t of ELEMENT_TYPES) {
      const concept = t === 'AndJunction' || t === 'OrJunction' ? 'Junction' : t;
      expect(ARCHIMATE_RELATIONSHIP_TABLE[concept], t).toBeDefined();
    }
  });

  it('knows standard relationships', () => {
    expect(allowedRelationships('ApplicationComponent', 'ApplicationService')).toContain('Realization');
    expect(allowedRelationships('ApplicationService', 'BusinessProcess')).toContain('Serving');
    expect(allowedRelationships('ApplicationComponent', 'DataObject')).toContain('Access');
    expect(allowedRelationships('DataObject', 'ApplicationComponent')).not.toContain('Serving');
    expect(allowedRelationships('BusinessProcess', 'ApplicationComponent')).not.toContain('Realization');
  });
});

describe('buildArchimate', () => {
  it('builds exchange XML and one SVG per view', () => {
    const res = buildArchimate(sampleArchimate);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { exchangeXml, views, model } = res.output;
    expect(views).toHaveLength(2);
    expect(model.relationships.every((r) => r.id)).toBe(true);
    expect(exchangeXml).toContain('xmlns="http://www.opengroup.org/xsd/archimate/3.0/"');
    expect(exchangeXml).toContain('xsi:type="ApplicationComponent"');
    expect(exchangeXml).toContain('accessType="ReadWrite"');
    expect(exchangeXml).toContain('Sample &amp; &lt;test&gt; model');
    expect(exchangeXml).toContain('<propertyDefinition identifier="propid-1" type="string">');
    for (const v of views) {
      expect(v.svg.startsWith('<svg')).toBe(true);
      expect(v.svg).toContain('</svg>');
    }
    // the application cooperation view only contains its 5 elements
    expect(views[1]!.elementCount).toBe(5);
  });

  it('rejects relationships that ArchiMate does not allow and explains the alternatives', () => {
    const res = buildArchimate({
      name: 'bad',
      elements: [
        { id: 'd', type: 'DataObject', name: 'Data' },
        { id: 'c', type: 'ApplicationComponent', name: 'Comp' },
      ],
      relationships: [{ type: 'Serving', source: 'd', target: 'c' }],
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors[0]!.message).toMatch(/Serving is not allowed from DataObject/);
    expect(res.errors[0]!.message).toMatch(/Allowed: Association/);
  });

  it('reports unknown references, duplicate ids and mixed junctions', () => {
    const res = buildArchimate({
      name: 'bad',
      elements: [
        { id: 'a', type: 'ApplicationService', name: 'A' },
        { id: 'a', type: 'ApplicationService', name: 'A2' },
        { id: 'j', type: 'OrJunction', name: 'j' },
        { id: 'p', type: 'ApplicationProcess', name: 'P' },
      ],
      relationships: [
        { type: 'Serving', source: 'a', target: 'j' },
        { type: 'Triggering', source: 'j', target: 'p' },
        { type: 'Flow', source: 'p', target: 'missing' },
      ],
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    const text = res.errors.map((e) => e.message).join('\n');
    expect(text).toMatch(/Duplicate element id "a"/);
    expect(text).toMatch(/Unknown target element "missing"/);
    expect(text).toMatch(/different types/);
  });

  it('validates views against the model', () => {
    const res = buildArchimate({ ...sampleArchimate, views: [{ name: 'V', elements: ['ac-order'], relationships: ['rel-1'] }] });
    expect(res.ok).toBe(false);
  });

  it('produces XML that validates against the Open Group XSD (when ARCHIMATE_XSD_DIR is set)', () => {
    const xsdDir = process.env.ARCHIMATE_XSD_DIR;
    if (!xsdDir || !existsSync(join(xsdDir, 'archimate3_Diagram.xsd'))) return;
    const res = buildArchimate(sampleArchimate);
    if (!res.ok) throw new Error('model should be valid');
    const dir = mkdtempSync(join(tmpdir(), 'solar-xsd-'));
    const file = join(dir, 'model.xml');
    writeFileSync(file, res.output.exchangeXml);
    const out = execFileSync('xmllint', ['--noout', '--schema', join(xsdDir, 'archimate3_Diagram.xsd'), file], { encoding: 'utf8', stdio: 'pipe' });
    expect(out).toBe('');
  });
});
