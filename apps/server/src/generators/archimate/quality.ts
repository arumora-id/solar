import type { ArchimateRelationship } from './model.js';
import type { ViewLayout } from './layout.js';
import type { Rect, RoutedLabel, RoutedRelationship, Point } from './routing.js';
import { crossesNode } from './routing.js';

export type DiagramIssueKind =
  | 'node-overlap' | 'connector-obstacle' | 'nonorthogonal-connector'
  | 'label-obstacle' | 'label-overlap' | 'canvas-overflow' | 'missing-route';

export interface DiagramQualityIssue {
  kind: DiagramIssueKind;
  subject: string;
  detail: string;
}
export interface DiagramQualityReport {
  issues: DiagramQualityIssue[];
  /** Crossing unrelated connectors is not generally avoidable in dense graphs. */
  crossingCount: number;
  nodeCount: number;
  relationshipCount: number;
}

const overlaps = (a: Rect, b: Rect) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 &&
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;
const onCanvas = (b: Rect, width: number, height: number) =>
  b.x >= -0.5 && b.y >= -0.5 && b.x + b.w <= width + 0.5 && b.y + b.h <= height + 0.5;
const segments = (points: Point[]) => points.slice(1).map((p, i) => [points[i]!, p] as const);
function strictlyCross(a: Point, b: Point, c: Point, d: Point): boolean {
  if (a.x === b.x && c.y === d.y) return c.y > Math.min(a.y, b.y) && c.y < Math.max(a.y, b.y) &&
    a.x > Math.min(c.x, d.x) && a.x < Math.max(c.x, d.x);
  if (a.y === b.y && c.x === d.x) return a.y > Math.min(c.y, d.y) && a.y < Math.max(c.y, d.y) &&
    c.x > Math.min(a.x, b.x) && c.x < Math.max(a.x, b.x);
  return false;
}

/**
 * Geometry-only audit, independent from SVG/mxGraph formatting.
 * Deliberately does not claim that every possible dense graph can have zero crossings.
 * Can be used in tests and to surface user-visible export quality advisories.
 */
export function assessArchiMateGeometry(
  layout: ViewLayout, relationships: ArchimateRelationship[],
  routes: Map<string, RoutedRelationship>, labels: Map<string, RoutedLabel>,
): DiagramQualityReport {
  const issues: DiagramQualityIssue[] = [];
  const nodes = [...layout.nodes.values()];
  const labelRects = [...labels.entries()].map(([id, label]) => ({ id, rect: label.box }));
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    if (!onCanvas(n, layout.width, layout.height))
      issues.push({ kind: 'canvas-overflow', subject: n.id, detail: 'Element extends outside the view' });
    for (let j = i + 1; j < nodes.length; j++) if (overlaps(n, nodes[j]!))
      issues.push({ kind: 'node-overlap', subject: n.id, detail: 'Overlaps element ' + nodes[j]!.id });
  }
  for (const { id, rect } of labelRects) {
    if (!onCanvas(rect, layout.width, layout.height))
      issues.push({ kind: 'canvas-overflow', subject: id, detail: 'Relationship label extends outside the view' });
    for (const n of nodes) if (overlaps(rect, n))
      issues.push({ kind: 'label-obstacle', subject: id, detail: 'Label overlaps element ' + n.id });
  }
  for (let i = 0; i < labelRects.length; i++)
    for (let j = i + 1; j < labelRects.length; j++)
      if (overlaps(labelRects[i]!.rect, labelRects[j]!.rect))
        issues.push({ kind: 'label-overlap', subject: labelRects[i]!.id, detail: 'Overlaps label ' + labelRects[j]!.id });

  for (const r of relationships) {
    const path = routes.get(r.id)?.points;
    if (!path || path.length < 2) {
      issues.push({ kind: 'missing-route', subject: r.id, detail: 'Relationship has no visible path' });
      continue;
    }
    let nonOrthogonal = false;
    const blocked = new Set<string>();
    for (const [a, b] of segments(path)) {
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y) ||
        (a.x !== b.x && a.y !== b.y)) nonOrthogonal = true;
      for (const n of nodes) {
        if (n.id === r.source || n.id === r.target) continue;
        if (crossesNode(a, b, n)) blocked.add(n.id);
      }
    }
    if (nonOrthogonal) issues.push({ kind: 'nonorthogonal-connector', subject: r.id, detail: 'Router used diagonal or non-finite coordinates' });
    for (const id of blocked)
      issues.push({ kind: 'connector-obstacle', subject: r.id, detail: 'Connector crosses element ' + id });
  }

  let crossingCount = 0;
  for (let i = 0; i < relationships.length; i++) for (let j = i + 1; j < relationships.length; j++) {
    const r = relationships[i]!, s = relationships[j]!;
    // Shared endpoints naturally join; do not flag those as incidental intersections.
    if ([r.source, r.target].some((id) => id === s.source || id === s.target)) continue;
    const a = routes.get(r.id)?.points, b = routes.get(s.id)?.points;
    if (!a || !b) continue;
    for (const [a1, a2] of segments(a))
      for (const [b1, b2] of segments(b))
        if (strictlyCross(a1, a2, b1, b2)) crossingCount++;
  }
  return { issues, crossingCount, nodeCount: nodes.length, relationshipCount: relationships.length };
}
