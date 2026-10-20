import { describe, expect, it } from 'vitest';
import type { ArchimateRelationship } from '../src/generators/archimate/model.js';
import type { NodeBox, ViewLayout } from '../src/generators/archimate/layout.js';
import { assessArchiMateGeometry } from '../src/generators/archimate/quality.js';
import { routeArchiMateEdges, type RoutedLabel, type RoutedRelationship } from '../src/generators/archimate/routing.js';
import { buildArchimate } from '../src/generators/archimate/index.js';
import { buildSequence } from '../src/generators/sequence/index.js';
import { computeSequenceTimeline } from '../src/generators/sequence/timeline.js';
import { sampleArchimate } from './fixtures.js';

const node = (id: string, x: number, y: number): NodeBox => ({
  id, x, y, w: 120, h: 66, element: { id, type: 'ApplicationComponent', name: id },
});
const rel = (id: string, source: string, target: string): ArchimateRelationship => ({
  id, source, target, type: 'Flow', name: 'Data ' + id,
});
const layoutOf = (nodes: NodeBox[]): ViewLayout => ({
  width: 1130, height: 850, bands: [],
  nodes: new Map(nodes.map((n) => [n.id, n])),
});

describe('Diagram layout quality — Phase D geometry and stress', () => {
  it('detects diagonal fallback, blocked connectors, node overlaps, label collisions and overflow', () => {
    const a = node('a', 25, 110), blocker = node('blocker', 200, 110);
    const b = node('b', 420, 110), overlapping = node('overlap', 220, 120);
    const layout = layoutOf([a, blocker, b, overlapping]);
    const routes = new Map<string, RoutedRelationship>([
      ['flow', { id: 'flow', points: [
        { x: a.x + a.w / 2, y: a.y + a.h / 2 },
        { x: b.x + b.w / 2, y: b.y + b.h / 2 },
      ] }],
    ]);
    const labels = new Map<string, RoutedLabel>([
      ['flow', { text: 'Warning', lines: ['Warning'], box: { x: 206, y: 126, w: 82, h: 24 } }],
      ['other', { text: 'Overlaid', lines: ['Overlaid'], box: { x: 210, y: 130, w: 82, h: 24 } }],
      ['outside', { text: 'Out', lines: ['Out'], box: { x: -3, y: 4, w: 20, h: 15 } }],
    ]);
    const report = assessArchiMateGeometry(layout, [rel('flow', 'a', 'b')], routes, labels);
    const kinds = new Set<string>(report.issues.map((issue) => issue.kind));
    for (const kind of ['node-overlap', 'connector-obstacle', 'nonorthogonal-connector',
      'label-obstacle', 'label-overlap', 'canvas-overflow']) expect(kinds.has(kind), kind).toBe(true);
    expect(report.nodeCount).toBe(4);
    expect(report.relationshipCount).toBe(1);
  });

  it('routes a blocked three-element view without unrelated-box collisions', () => {
    const a = node('a', 45, 170), middle = node('middle', 315, 170), b = node('b', 635, 170);
    const layout = layoutOf([a, middle, b]);
    const links = [rel('around', 'a', 'b')];
    const paths = routeArchiMateEdges(layout, links);
    const report = assessArchiMateGeometry(layout, links, paths, new Map());
    expect(report.issues).toEqual([]);
    expect(report.crossingCount).toBe(0);
    expect(paths.get('around')!.points.length).toBeGreaterThan(2);
  });

  it('stress-checks deterministic routing for 20 grid nodes and 7 cross-row links', () => {
    const nodes = Array.from({ length: 20 }, (_, index) =>
      node('n' + index, 55 + (index % 5) * 205, 105 + Math.floor(index / 5) * 165));
    const layout = layoutOf(nodes);
    const links = [
      rel('r0', 'n0', 'n4'), rel('r1', 'n5', 'n9'),
      rel('r2', 'n10', 'n14'), rel('r3', 'n15', 'n19'),
      rel('c0', 'n0', 'n15'), rel('c4', 'n4', 'n19'),
      rel('diag', 'n1', 'n18'),
    ];
    const first = routeArchiMateEdges(layout, links);
    const second = routeArchiMateEdges(layout, links);
    expect(first).toEqual(second);
    const report = assessArchiMateGeometry(layout, links, first, new Map());
    expect(report.nodeCount).toBe(20);
    expect(report.relationshipCount).toBe(7);
    expect(report.issues.filter((issue) => issue.kind === 'node-overlap')).toHaveLength(0);
    expect(report.issues.filter((issue) => issue.kind === 'missing-route')).toHaveLength(0);
    expect(Number.isFinite(report.crossingCount)).toBe(true);
    // Dense topologies may need crossings or fallback; auditors report them,
    // rather than hiding relationships or claiming every crossing was removed.
    expect(first.size).toBe(links.length);
  }, 20000);

  it('keeps multi-view ArchiMate outputs complete and structured', () => {
    const result = buildArchimate(sampleArchimate);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { model, views, exchangeXml, drawio, warnings } = result.output;
    expect(views).toHaveLength(model.views.length);
    expect((drawio.match(/<diagram /g) ?? []).length).toBe(model.views.length);
    expect((exchangeXml.match(/<view identifier=/g) ?? []).length).toBe(model.views.length);
    for (const view of views) {
      expect(view.svg).toContain('<svg');
      expect(view.svg).not.toMatch(/(?:NaN|Infinity|undefined)/);
    }
    expect(warnings.every((w) => typeof w.path === 'string' && w.message.length > 0)).toBe(true);
  });

  it('handles long-label sequence stress with nested fragments and preserves editable diagram files', () => {
    const participants = Array.from({ length: 8 }, (_, i) => ({
      id: 'P' + i, label: 'Internal Integration Participant ' + i + ' with long name',
    }));
    const steps: Array<Record<string, unknown>> = [
      { type: 'fragment_start', kind: 'alt', label: 'Validate request and downstream approval conditions' },
      { type: 'fragment_start', kind: 'loop', label: 'Retry while approved state is not available' },
    ];
    for (let i = 0; i < 32; i++) {
      steps.push({ type: 'message', from: 'P' + (i % 8), to: 'P' + ((i * 3 + 1) % 8),
        text: 'Submit transaction ' + i + ' with metadata for reconciliation and audit ' + 'abc '.repeat(15),
        style: i % 4 === 0 ? 'async' : i % 4 === 1 ? 'reply' : 'sync' });
      if (i % 8 === 3) steps.push({
        type: 'note', over: ['P' + (i % 8)],
        text: 'Reconciliation note ' + i + ': ' + 'long business requirement '.repeat(10),
      });
    }
    steps.push({ type: 'fragment_end' }, { type: 'fragment_else', label: 'Needs manual review' },
      { type: 'message', from: 'P0', to: 'P0', text: 'Revalidate this request on the same participant' },
      { type: 'fragment_end' });
    const result = buildSequence({ title: 'Sequence layout stress and export quality', participants, steps });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { svg, drawio, plantuml, mermaid, diagram } = result.output;
    expect(mermaid).toContain('sequenceDiagram');
    expect(plantuml).toContain('@startuml');
    expect(drawio).toContain('<mxfile ');
    expect(svg).toContain('<svg');
    expect(svg).not.toMatch(/(?:NaN|Infinity|undefined)/);
    expect(drawio).not.toMatch(/(?:NaN|Infinity|undefined)/);
    const timeline = computeSequenceTimeline(diagram);
    for (let i = 1; i < timeline.steps.length; i++) {
      expect(timeline.steps[i]!.top).toBeGreaterThanOrEqual(timeline.steps[i - 1]!.bottom);
    }
    expect(timeline.steps[timeline.steps.length - 1]!.bottom).toBe(timeline.endY);
    expect((drawio.match(/id="participant-\d+"/g) ?? []).length).toBe(8);
    expect((drawio.match(/id="frame-\d+"/g) ?? []).length).toBe(2);
    expect((drawio.match(/id="step-\d+-label"/g) ?? []).length).toBe(33);
  }, 20000);
});
