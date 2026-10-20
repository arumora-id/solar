import { describe, expect, it } from 'vitest';
import type { NodeBox, ViewLayout } from '../src/generators/archimate/layout.js';
import type { ArchimateRelationship } from '../src/generators/archimate/model.js';
import { crossesNode, placeEdgeLabel, routeArchiMateEdges } from '../src/generators/archimate/routing.js';
import { buildArchimate } from '../src/generators/archimate/index.js';
import { sampleArchimate } from './fixtures.js';

const node = (id: string, x: number, y: number, w = 120, h = 65): NodeBox => ({
  id, x, y, w, h,
  element: { id, name: id, type: 'ApplicationComponent' },
});
const relationship = (id: string, source: string, target: string): ArchimateRelationship =>
  ({ id, type: 'Flow', source, target });
const view = (nodes: NodeBox[]): ViewLayout => ({
  width: 720, height: 390, bands: [], nodes: new Map(nodes.map((n) => [n.id, n])),
});
function checkPath(path: Array<{ x: number; y: number }>, boxes: NodeBox[]) {
  expect(path.length).toBeGreaterThanOrEqual(2);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    expect(a.x === b.x || a.y === b.y).toBe(true);
    for (const obstacle of boxes) expect(crossesNode(a, b, obstacle)).toBe(false);
  }
}
describe('ArchiMate collision-aware SVG routing — phase A', () => {
  it('routes around a box blocking the shortest straight connection', () => {
    const a = node('a', 40, 140), blocker = node('blocker', 280, 140), b = node('b', 530, 140);
    const routes = routeArchiMateEdges(view([a, blocker, b]), [relationship('flow', 'a', 'b')]);
    const path = routes.get('flow')!.points;
    checkPath(path, [blocker]);
    expect(path.length).toBeGreaterThanOrEqual(4);
    expect(path[0]!.x === a.x + a.w || path[0]!.x === a.x || path[0]!.y === a.y || path[0]!.y === a.y + a.h).toBe(true);
    expect(path[path.length - 1]!.x === b.x + b.w || path[path.length - 1]!.x === b.x ||
      path[path.length - 1]!.y === b.y || path[path.length - 1]!.y === b.y + b.h).toBe(true);
  });

  it('handles multiple obstacles and outputs deterministic routes', () => {
    const a = node('a', 50, 90), b = node('b', 540, 290);
    const blockers = [node('c', 240, 85), node('d', 240, 190), node('e', 400, 190)];
    const layout = view([a, b, ...blockers]);
    const links = [relationship('one', 'a', 'b'), relationship('two', 'b', 'a')];
    const first = routeArchiMateEdges(layout, links);
    const again = routeArchiMateEdges(layout, links);
    expect(first).toEqual(again);
    for (const id of ['one', 'two']) checkPath(first.get(id)!.points, blockers);
  });

  it('places short labels outside obstacles and earlier label reservations', () => {
    const boxes = [node('center', 240, 125)];
    const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
    const points = [
      { x: 70, y: 120 }, { x: 70, y: 250 }, { x: 550, y: 250 },
    ];
    const first = placeEdgeLabel(points, 95, 20, boxes, placed, 720, 390);
    const second = placeEdgeLabel(points, 95, 20, boxes, placed, 720, 390);
    expect(placed).toHaveLength(2);
    const overlap = first.x < second.x + second.w && first.x + first.w > second.x &&
      first.y < second.y + second.h && first.y + first.h > second.y;
    expect(overlap).toBe(false);
    for (const box of placed) for (const n of boxes) {
      expect(box.x < n.x + n.w && box.x + box.w > n.x &&
        box.y < n.y + n.h && box.y + box.h > n.y).toBe(false);
    }
  });

  it('keeps normal ArchiMate SVG generation, semantics, and exchange output', () => {
    const result = buildArchimate(sampleArchimate);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.views).not.toHaveLength(0);
    for (const v of result.output.views) {
      expect(v.svg).toContain('<g class="relationships">');
      expect(v.svg).toContain('<g class="labels">');
      expect(v.svg).toContain('<svg');
    }
    expect(result.output.exchangeXml).toContain('<connection ');
  });
});
