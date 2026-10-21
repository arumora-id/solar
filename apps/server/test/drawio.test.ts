import { describe, expect, it } from 'vitest';
import { buildArchimate } from '../src/generators/archimate/index.js';
import { buildSequence } from '../src/generators/sequence/index.js';
import { sampleArchimate, sampleSequence } from './fixtures.js';

describe('editable draw.io / Visual Paradigm Online diagram export', () => {
  it('exports an ArchiMate mxfile page for every view with native elements and relationships', () => {
    const result = buildArchimate(sampleArchimate);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { drawio, views, exchangeXml } = result.output;
    expect(drawio).toContain('<mxfile host="app.diagrams.net"');
    expect((drawio.match(/<diagram /g) ?? [])).toHaveLength(views.length);
    expect(drawio).toContain('<mxGraphModel ');
    expect(drawio).toContain('vertex="1"');
    expect(drawio).toContain('edge="1"');
    expect(drawio).toContain('source="el-');
    expect(drawio).toContain('target="el-');
    expect(drawio).not.toContain('<image');
    // The standards-based ArchiMate model remains separate from the editable drawing.
    expect(exchangeXml).toContain('xmlns="http://www.opengroup.org/xsd/archimate/3.0/"');
    expect(drawio).toContain('Order Platform - Target Architecture');
    expect(drawio).not.toContain('<script>');
  });

  it('keeps full interface, role and component definitions in draw.io and PlantUML exports', () => {
    const result = buildArchimate({
      ...sampleArchimate,
      elements: sampleArchimate.elements.map((element) => element.id === 'ai-order-api'
        ? { ...element, documentation: 'REST API & authentication contract', properties: { Version: 'v2', Owner: 'Platform Team' } }
        : element),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { drawio, views } = result.output;
    expect(drawio).toContain('Element &amp; relationship definitions');
    expect(drawio).toContain('REST API &amp; authentication contract');
    expect(drawio).toContain('Version: v2');
    expect(drawio).toContain('Owner: Platform Team');
    expect(drawio).toContain('Buyer');
    expect(drawio).toContain('Business Role');
    expect(drawio).toContain('Application Interface');
    expect(drawio).toContain('Application Component');
    expect(drawio).toContain('id="definition-');
    expect(views).toHaveLength(2);
    for (const view of views) {
      expect(view.plantuml).toContain('@startuml');
      expect(view.plantuml).toContain('@enduml');
    }
    const layered = views[0]!.plantuml;
    expect(layered).toContain('Business Role');
    expect(layered).toContain('Application Interface');
    expect(layered).toContain('REST API & authentication contract');
    expect(layered).toContain('Owner: Platform Team');
  });

  it('exports native sequence participants, messages, frames, notes and both arrow kinds', () => {
    const result = buildSequence(sampleSequence);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { drawio, mermaid, plantuml } = result.output;
    expect(drawio).toContain('<mxfile ');
    expect(drawio).toContain('id="solar-sequence"');
    expect(drawio).toContain('id="participant-0"');
    expect(drawio).toContain('id="lifeline-0"');
    expect(drawio).toContain('id="step-');
    expect(drawio).toContain('sourcePoint');
    expect(drawio).toContain('targetPoint');
    expect(drawio).toContain('id="frame-0"');
    expect(drawio).toContain('vertex="1"');
    expect(drawio).toContain('edge="1"');
    expect(mermaid).toContain('sequenceDiagram');
    expect(plantuml).toContain('@startuml');
  });

  it('escapes potentially hostile diagram text as XML attributes', () => {
    const arch = buildArchimate({
      ...sampleArchimate,
      name: 'Model "quoted" & <script>alert(1)</script>',
    });
    expect(arch.ok).toBe(true);
    if (!arch.ok) return;
    expect(arch.output.drawio).toContain('&quot;quoted&quot; &amp; &lt;script&gt;');
    expect(arch.output.drawio).not.toContain('<script>');

    const seq = buildSequence({
      ...sampleSequence,
      title: 'Actors & <components>',
    });
    expect(seq.ok).toBe(true);
    if (!seq.ok) return;
    expect(seq.output.drawio).toContain('Actors &amp; &lt;components&gt;');
    expect(seq.output.drawio).not.toContain('<components>');
  });
});
