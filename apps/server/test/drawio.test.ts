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
    expect(drawio).toContain('Sample &amp; &lt;test&gt; model');
    expect(drawio).not.toContain('Sample & <test> model');
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
