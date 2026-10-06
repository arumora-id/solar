import { describe, expect, it } from 'vitest';
import { buildSequence } from '../src/generators/sequence/index.js';
import { mermaidText } from '../src/generators/sequence/mermaid.js';
import { sampleSequence } from './fixtures.js';

describe('buildSequence', () => {
  it('renders Mermaid, PlantUML and SVG', () => {
    const res = buildSequence(sampleSequence);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { mermaid, plantuml, svg } = res.output;
    expect(mermaid).toContain('sequenceDiagram');
    expect(mermaid).toContain('actor Customer as Customer');
    expect(mermaid).toContain('Web->>+OrderSvc: POST /orders');
    expect(mermaid).toContain('OrderSvc-->>-Web: 201 Created');
    expect(mermaid).toContain('alt valid cart');
    expect(mermaid).toContain('else invalid cart');
    expect(mermaid).toContain('Checkout#59; pay #35;1');
    expect(plantuml).toMatch(/^@startuml/);
    expect(plantuml).toContain('Web -> OrderSvc ++ : POST /orders');
    expect(plantuml).toContain('OrderSvc --> Web -- : 201 Created');
    expect(plantuml).toContain('database "Order DB" as DB');
    expect(svg.startsWith('<svg')).toBe(true);
  });

  it('escapes Mermaid special characters in a single pass', () => {
    expect(mermaidText('a;b#c%d')).toBe('a#59;b#35;c#37;d');
  });

  it('rejects unbalanced activations, bad fragments and reserved ids', () => {
    const res = buildSequence({
      title: 't',
      participants: [
        { id: 'end', label: 'x' },
        { id: 'B', label: 'b' },
      ],
      steps: [
        { type: 'fragment_start', kind: 'opt', label: '' },
        { type: 'fragment_else', label: 'x' },
        { type: 'message', from: 'B', to: 'Z', text: 'hi', deactivate: true },
      ],
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    const text = res.errors.map((e) => e.message).join('\n');
    expect(text).toMatch(/reserved word/);
    expect(text).toMatch(/fragment_else is only valid/);
    expect(text).toMatch(/Unknown participant "Z"/);
    expect(text).toMatch(/no active activation/);
    expect(text).toMatch(/never closed/);
  });

  it('rejects empty fragment branches', () => {
    const res = buildSequence({
      ...sampleSequence,
      steps: [
        { type: 'message', from: 'Customer', to: 'Web', text: 'x' },
        { type: 'fragment_start', kind: 'loop', label: 'retry' },
        { type: 'fragment_end' },
      ],
    });
    expect(res.ok).toBe(false);
  });
});
