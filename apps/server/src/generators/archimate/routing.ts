import type { NodeBox, ViewLayout } from './layout.js';
import type { ArchimateRelationship } from './model.js';

export interface Point { x: number; y: number }
export interface RoutedRelationship { id: string; points: Point[] }
export interface Rect { x: number; y: number; w: number; h: number }

const GAP = 10;
const STUB = GAP + 8;
const BEND_COST = 22;
const SIDES: Array<'left' | 'right' | 'top' | 'bottom'> = ['right', 'bottom', 'left', 'top'];

const center = (n: NodeBox): Point => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
const metric = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

function port(n: NodeBox, side: string): { end: Point; stub: Point } {
  const c = center(n);
  switch (side) {
    case 'left': return { end: { x: n.x, y: c.y }, stub: { x: n.x - STUB, y: c.y } };
    case 'right': return { end: { x: n.x + n.w, y: c.y }, stub: { x: n.x + n.w + STUB, y: c.y } };
    case 'top': return { end: { x: c.x, y: n.y }, stub: { x: c.x, y: n.y - STUB } };
    default: return { end: { x: c.x, y: n.y + n.h }, stub: { x: c.x, y: n.y + n.h + STUB } };
  }
}
function inside(p: Point, n: Rect): boolean {
  return p.x > n.x - GAP && p.x < n.x + n.w + GAP && p.y > n.y - GAP && p.y < n.y + n.h + GAP;
}
/** Exact AABB test for horizontal/vertical segments, with clearance. */
export function crossesNode(a: Point, b: Point, n: Rect): boolean {
  if (a.y === b.y) return a.y > n.y - GAP && a.y < n.y + n.h + GAP &&
    Math.min(a.x, b.x) < n.x + n.w + GAP && Math.max(a.x, b.x) > n.x - GAP;
  if (a.x === b.x) return a.x > n.x - GAP && a.x < n.x + n.w + GAP &&
    Math.min(a.y, b.y) < n.y + n.h + GAP && Math.max(a.y, b.y) > n.y - GAP;
  return true; // every routed segment is required to be orthogonal
}
function clear(a: Point, b: Point, boxes: NodeBox[]): boolean {
  return boxes.every((n) => !crossesNode(a, b, n));
}
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    if (out.length && same(out[out.length - 1]!, p)) continue;
    const prev = out[out.length - 1], before = out[out.length - 2];
    if (prev && before && ((prev.x === before.x && prev.x === p.x) ||
      (prev.y === before.y && prev.y === p.y))) out.pop();
    out.push(p);
  }
  return out;
}
function segments(points: Point[]): Array<[Point, Point]> {
  const result: Array<[Point, Point]> = [];
  for (let i = 1; i < points.length; i++) result.push([points[i - 1]!, points[i]!]);
  return result;
}
function crossings(a: Point, b: Point, prior: Point[]): number {
  let count = 0;
  for (const [c, d] of segments(prior)) {
    if (a.x === b.x && c.y === d.y) {
      if (a.x > Math.min(c.x, d.x) && a.x < Math.max(c.x, d.x) &&
        c.y > Math.min(a.y, b.y) && c.y < Math.max(a.y, b.y)) count++;
    } else if (a.y === b.y && c.x === d.x) {
      if (c.x > Math.min(a.x, b.x) && c.x < Math.max(a.x, b.x) &&
        a.y > Math.min(c.y, d.y) && a.y < Math.max(c.y, d.y)) count++;
    } else if (a.x === b.x && c.x === d.x && a.x === c.x) {
      if (Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) >
        Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))) count += 2;
    } else if (a.y === b.y && c.y === d.y && a.y === c.y) {
      if (Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) >
        Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x))) count += 2;
    }
  }
  return count;
}
function cost(path: Point[], prior: Point[][]): number {
  let score = Math.max(0, path.length - 2) * BEND_COST;
  for (const [a, b] of segments(path)) {
    score += metric(a, b);
    for (const other of prior) score += 90 * crossings(a, b, other);
  }
  return score;
}
function allowed(path: Point[], boxes: NodeBox[]): boolean {
  return segments(path).every(([a, b]) => clear(a, b, boxes));
}
function sortedUnique(xs: number[]): number[] { return [...new Set(xs)].sort((a, b) => a - b); }

/** Bounded visibility-grid A* as a fallback when all 0–2 bend candidates are obstructed. */
function gridSearch(start: Point, goal: Point, boxes: NodeBox[], xs: number[], ys: number[]): Point[] | null {
  const sx = xs.indexOf(start.x), sy = ys.indexOf(start.y);
  const tx = xs.indexOf(goal.x), ty = ys.indexOf(goal.y);
  if (sx < 0 || sy < 0 || tx < 0 || ty < 0) return null;
  const w = xs.length, h = ys.length;
  const state = (x: number, y: number, dir: number) => ((y * w + x) * 3 + dir);
  const initial = state(sx, sy, 2), count = w * h * 3;
  const dist = new Float64Array(count).fill(Infinity);
  const parent = new Int32Array(count).fill(-1);
  const heap: Array<{ f: number; s: number }> = [];
  const push = (item: { f: number; s: number }) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p]!.f <= item.f) break;
      heap[i] = heap[p]!;
      i = p;
    }
    heap[i] = item;
  };
  const pop = () => {
    const first = heap[0]!;
    const tail = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (2 * i + 1 < heap.length) {
        const a = 2 * i + 1, b = a + 1;
        const child = b < heap.length && heap[b]!.f < heap[a]!.f ? b : a;
        if (heap[child]!.f >= tail.f) break;
        heap[i] = heap[child]!;
        i = child;
      }
      heap[i] = tail;
    }
    return first;
  };
  dist[initial] = 0;
  push({ s: initial, f: metric(start, goal) });
  let expanded = 0;
  while (heap.length && expanded < 120000) {
    const entry = pop(), s = entry.s;
    const xy = Math.floor(s / 3), dir = s % 3;
    const x = xy % w, y = Math.floor(xy / w);
    const here = { x: xs[x]!, y: ys[y]! };
    if (entry.f > dist[s]! + metric(here, goal) + 0.001) continue;
    if (x === tx && y === ty) {
      const points: Point[] = [];
      let back = s;
      while (back !== -1) {
        const cell = Math.floor(back / 3);
        points.push({ x: xs[cell % w]!, y: ys[Math.floor(cell / w)]! });
        back = parent[back]!;
      }
      return simplify(points.reverse());
    }
    expanded++;
    for (const [xx, yy, nd] of [[x - 1, y, 0], [x + 1, y, 0], [x, y - 1, 1], [x, y + 1, 1]]) {
      if (xx! < 0 || yy! < 0 || xx! >= w || yy! >= h) continue;
      const next = { x: xs[xx!]!, y: ys[yy!]! };
      if (boxes.some((n) => inside(next, n))) continue;
      if (!clear(here, next, boxes)) continue;
      const nextState = state(xx!, yy!, nd!);
      const d = dist[s]! + metric(here, next) + (dir !== 2 && dir !== nd ? BEND_COST : 0);
      if (d >= dist[nextState]!) continue;
      dist[nextState] = d;
      parent[nextState] = s;
      push({ s: nextState, f: d + metric(next, goal) });
    }
  }
  return null;
}
function pathsFrom(st: Point, en: Point, xs: number[], ys: number[]): Point[][] {
  const paths = [
    [st, { x: en.x, y: st.y }, en],
    [st, { x: st.x, y: en.y }, en],
  ];
  for (const x of xs) paths.push([st, { x, y: st.y }, { x, y: en.y }, en]);
  for (const y of ys) paths.push([st, { x: st.x, y }, { x: en.x, y }, en]);
  return paths.map(simplify);
}
function edgesFor(layout: ViewLayout, links: ArchimateRelationship[]): Map<string, RoutedRelationship> {
  const routes = new Map<string, RoutedRelationship>();
  const allNodes = [...layout.nodes.values()];
  const prior: Point[][] = [];
  const baseXs = sortedUnique([8, layout.width - 8, ...allNodes.flatMap((n) => [n.x - STUB - 4, n.x + n.w + STUB + 4])]);
  const baseYs = sortedUnique([64, layout.height - 8, ...allNodes.flatMap((n) => [n.y - STUB - 4, n.y + n.h + STUB + 4])]);
  for (const rel of links) {
    const from = layout.nodes.get(rel.source), to = layout.nodes.get(rel.target);
    if (!from || !to) continue;
    if (from.id === to.id) {
      const a = port(from, 'top'), b = port(from, 'right');
      const x = from.x + from.w + STUB + 10, y = from.y - STUB - 10;
      const points = [a.end, a.stub, { x: a.stub.x, y }, { x, y }, { x, y: b.stub.y }, b.stub, b.end];
      routes.set(rel.id, { id: rel.id, points });
      prior.push(points);
      continue;
    }
    let best: Point[] | undefined, bestCost = Infinity;
    for (const sideA of SIDES) for (const sideB of SIDES) {
      const a = port(from, sideA), b = port(to, sideB);
      const ends = allNodes.filter((n) => n.id !== from.id && n.id !== to.id);
      if (!clear(a.end, a.stub, ends) || !clear(b.stub, b.end, ends)) continue;
      if (!allNodes.every((n) => !inside(a.stub, n) && !inside(b.stub, n))) continue;
      const xs = sortedUnique([...baseXs, a.stub.x, b.stub.x]);
      const ys = sortedUnique([...baseYs, a.stub.y, b.stub.y]);
      const directionPenalty = metric(a.end, b.end) > metric(a.stub, b.stub) ? 0 : 35;
      for (const route of pathsFrom(a.stub, b.stub, xs, ys)) {
        if (!allowed(route, allNodes)) continue;
        const full = simplify([a.end, ...route, b.end]);
        const score = cost(full, prior) + directionPenalty;
        if (score < bestCost) { best = full; bestCost = score; }
      }
      if (!best) {
        const route = gridSearch(a.stub, b.stub, allNodes, xs, ys);
        if (route) {
          const full = simplify([a.end, ...route, b.end]);
          const score = cost(full, prior) + directionPenalty;
          if (score < bestCost) { best = full; bestCost = score; }
        }
      }
    }
    // A tight or pathological diagram may have no clear route. Keep it visible for review,
    // never silently omit a semantic relationship.
    const points = best ?? [center(from), center(to)];
    routes.set(rel.id, { id: rel.id, points });
    prior.push(points);
  }
  return routes;
}
export const routeArchiMateEdges = edgesFor;

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w + 2 && a.x + a.w + 2 > b.x &&
  a.y < b.y + b.h + 2 && a.y + a.h + 2 > b.y;

/** Place labels next to routed segments, outside node and previous label rectangles. */
export function placeEdgeLabel(
  points: Point[], width: number, height: number, nodes: NodeBox[], placed: Rect[], canvasWidth: number, canvasHeight: number,
): Rect {
  const options = segments(points).sort((a, b) => metric(b[0], b[1]) - metric(a[0], a[1]));
  let fallback: Rect | undefined;
  for (const [a, b] of options) {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const horizontal = a.y === b.y;
    for (const offset of [1, -1, 2, -2, 3, -3]) {
      const x = horizontal ? mx - width / 2 : mx + (offset > 0 ? 1 : -1) * (width / 2 + 10 * Math.abs(offset)) - width / 2;
      const y = horizontal ? my + (offset > 0 ? 1 : -1) * (height / 2 + 8 * Math.abs(offset)) - height / 2 : my - height / 2;
      const r = { x, y, w: width, h: height };
      if (r.x < 4 || r.y < 60 || r.x + r.w > canvasWidth - 4 || r.y + r.h > canvasHeight - 4) continue;
      if (nodes.some((n) => overlaps(r, n))) continue;
      fallback ??= r;
      if (!placed.some((p) => overlaps(r, p))) { placed.push(r); return r; }
    }
  }
  const result = fallback ?? { x: points[0]!.x, y: points[0]!.y, w: width, h: height };
  placed.push(result);
  return result;
}
