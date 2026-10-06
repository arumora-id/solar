import { describe, expect, it } from 'vitest';
import { buildTechSpec, type ResolvedDiagram } from '../src/generators/techspec/index.js';
import { sampleTechSpec } from './fixtures.js';

const diagrams = new Map<string, ResolvedDiagram>([
  ['art_view1', { artifactId: 'art_view1', fileName: 'layered.svg', svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>' }],
]);

describe('buildTechSpec', () => {
  it('renders markdown and safe HTML with embedded diagrams', () => {
    const res = buildTechSpec(sampleTechSpec('art_view1'), diagrams, '2026-10-06');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { markdown, html } = res.output;
    expect(markdown).toContain('# Order Platform - Technical Specification');
    expect(markdown).toContain('## Daftar Isi');
    expect(markdown).toContain('- [1. Ringkasan Eksekutif](#1-ringkasan-eksekutif)');
    expect(markdown).toContain('![Layered view](./layered.svg)');
    expect(markdown).toContain('Lonjakan trafik \\| promo');
    expect(markdown).toContain('```json');
    expect(html).toContain('<figure><svg');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<h2 id="1-ringkasan-eksekutif">');
  });

  it('rejects unknown diagram references and duplicate ids', () => {
    const spec = sampleTechSpec('art_missing');
    spec.nonFunctionalRequirements.push({ id: 'FR-01', category: 'Security', requirement: 'x', metric: 'y' });
    const res = buildTechSpec(spec, diagrams, '2026-10-06');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    const text = res.errors.map((e) => e.message).join('\n');
    expect(text).toMatch(/art_missing/);
    expect(text).toMatch(/already used/);
  });

  it('supports English headings', () => {
    const res = buildTechSpec({ ...sampleTechSpec('art_view1'), language: 'en' }, diagrams, '2026-10-06');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.output.markdown).toContain('## Table of Contents');
  });
});
