import { ELEMENT_INFO, LAYER_ORDER, LAYER_ROWS, isJunction, type Layer, type RowKind } from './metamodel.js';
import type { ArchimateElement, ArchimateRelationship } from './model.js';

export const BOX_W = 170;
export const BOX_H = 72;
export const JUNCTION_SIZE = 16;
const JUNCTION_SLOT = 40;
const MAX_PER_ROW = 6;
const COL_GAP = 52;
const ROW_GAP = 58;
const BAND_PAD_Y = 24;
const BAND_GAP = 14;
export const MARGIN = 24;
export const TITLE_H = 58;
export const BAND_LABEL_W = 30;

export interface NodeBox {
  id: string;
  element: ArchimateElement;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BandBox {
  layer: Layer;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ViewLayout {
  width: number;
  /** Height of the diagram area (legend is appended by the renderer). */
  height: number;
  nodes: Map<string, NodeBox>;
  bands: BandBox[];
}

function slotWidth(el: ArchimateElement): number {
  return isJunction(el.type) ? JUNCTION_SLOT : BOX_W;
}

function rowWidth(row: ArchimateElement[]): number {
  return row.reduce((sum, el) => sum + slotWidth(el), 0) + Math.max(0, row.length - 1) * COL_GAP;
}

/** Layered auto-layout: one band per ArchiMate layer, rows by aspect, barycenter ordering to reduce crossings. */
export function layoutView(elements: ArchimateElement[], relationships: ArchimateRelationship[]): ViewLayout {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const neighbours = new Map<string, Set<string>>();
  for (const r of relationships) {
    if (!byId.has(r.source) || !byId.has(r.target) || r.source === r.target) continue;
    if (!neighbours.has(r.source)) neighbours.set(r.source, new Set());
    if (!neighbours.has(r.target)) neighbours.set(r.target, new Set());
    neighbours.get(r.source)!.add(r.target);
    neighbours.get(r.target)!.add(r.source);
  }

  // Junctions live in the band where most of their neighbours are.
  const layerOf = (el: ArchimateElement): Layer => {
    if (!isJunction(el.type)) return ELEMENT_INFO[el.type].layer;
    const counts = new Map<Layer, number>();
    for (const n of neighbours.get(el.id) ?? []) {
      const ne = byId.get(n);
      if (!ne || isJunction(ne.type)) continue;
      const l = ELEMENT_INFO[ne.type].layer;
      counts.set(l, (counts.get(l) ?? 0) + 1);
    }
    let best: Layer = 'other';
    let bestCount = 0;
    for (const [l, c] of counts) {
      if (c > bestCount) {
        best = l;
        bestCount = c;
      }
    }
    return best;
  };
  const rowOf = (el: ArchimateElement): RowKind => (isJunction(el.type) ? 'other' : ELEMENT_INFO[el.type].row);

  // Build rows per band (junctions are inserted afterwards between the rows they connect).
  const bandRows: Array<{ layer: Layer; rows: ArchimateElement[][] }> = [];
  for (const layer of LAYER_ORDER) {
    const inLayer = elements.filter((e) => layerOf(e) === layer);
    if (inLayer.length === 0) continue;
    const rows: ArchimateElement[][] = [];
    for (const kind of LAYER_ROWS[layer]) {
      const group = inLayer.filter((e) => {
        if (isJunction(e.type)) return false;
        const r = rowOf(e);
        return LAYER_ROWS[layer].includes(r) ? r === kind : kind === 'other';
      });
      for (let i = 0; i < group.length; i += MAX_PER_ROW) rows.push(group.slice(i, i + MAX_PER_ROW));
    }
    const rowIndex = new Map<string, number>();
    rows.forEach((row, i) => row.forEach((e) => rowIndex.set(e.id, i)));
    const inserts = new Map<number, ArchimateElement[]>();
    for (const j of inLayer.filter((e) => isJunction(e.type))) {
      const idx = [...(neighbours.get(j.id) ?? [])].map((n) => rowIndex.get(n)).filter((i): i is number => i !== undefined);
      const at = idx.length ? Math.floor(idx.reduce((a, b) => a + b, 0) / idx.length) + 1 : rows.length;
      inserts.set(at, [...(inserts.get(at) ?? []), j]);
    }
    for (const at of [...inserts.keys()].sort((a, b) => b - a)) {
      const group = inserts.get(at)!;
      const chunks: ArchimateElement[][] = [];
      for (let i = 0; i < group.length; i += MAX_PER_ROW) chunks.push(group.slice(i, i + MAX_PER_ROW));
      rows.splice(Math.min(at, rows.length), 0, ...chunks);
    }
    bandRows.push({ layer, rows });
  }
  const allRows = bandRows.flatMap((b) => b.rows);
  const contentWidth = Math.max(420, ...allRows.map(rowWidth));

  const centers = new Map<string, number>();
  const placeRow = (row: ArchimateElement[]) => {
    let x = (contentWidth - rowWidth(row)) / 2;
    for (const el of row) {
      const w = slotWidth(el);
      centers.set(el.id, x + w / 2);
      x += w + COL_GAP;
    }
  };
  allRows.forEach(placeRow);

  const reorder = (row: ArchimateElement[], placed: Set<string>) => {
    const score = new Map<string, number>();
    row.forEach((el) => {
      const xs = [...(neighbours.get(el.id) ?? [])].filter((n) => placed.has(n)).map((n) => centers.get(n)!);
      score.set(el.id, xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : centers.get(el.id)!);
    });
    const indexed = row.map((el, i) => ({ el, i }));
    indexed.sort((a, b) => score.get(a.el.id)! - score.get(b.el.id)! || a.i - b.i);
    row.splice(0, row.length, ...indexed.map((x) => x.el));
    placeRow(row);
  };

  // Down sweep then up sweep.
  const placedDown = new Set<string>(allRows[0]?.map((e) => e.id) ?? []);
  for (let i = 1; i < allRows.length; i++) {
    reorder(allRows[i]!, placedDown);
    allRows[i]!.forEach((e) => placedDown.add(e.id));
  }
  const placedUp = new Set<string>(allRows[allRows.length - 1]?.map((e) => e.id) ?? []);
  for (let i = allRows.length - 2; i >= 0; i--) {
    reorder(allRows[i]!, placedUp);
    allRows[i]!.forEach((e) => placedUp.add(e.id));
  }

  // Final coordinates.
  const left = MARGIN + BAND_LABEL_W + 16;
  const width = left + contentWidth + MARGIN + 8;
  const nodes = new Map<string, NodeBox>();
  const bands: BandBox[] = [];
  let y = MARGIN + TITLE_H;
  for (const band of bandRows) {
    const top = y;
    y += BAND_PAD_Y;
    band.rows.forEach((row, ri) => {
      const rowH = Math.max(...row.map((e) => (isJunction(e.type) ? JUNCTION_SIZE : BOX_H)));
      for (const el of row) {
        const junction = isJunction(el.type);
        const w = junction ? JUNCTION_SIZE : BOX_W;
        const h = junction ? JUNCTION_SIZE : BOX_H;
        const cx = left + centers.get(el.id)!;
        nodes.set(el.id, { id: el.id, element: el, x: Math.round(cx - w / 2), y: Math.round(y + (rowH - h) / 2), w, h });
      }
      y += rowH + (ri < band.rows.length - 1 ? ROW_GAP : 0);
    });
    y += BAND_PAD_Y;
    bands.push({ layer: band.layer, x: MARGIN, y: top, w: width - 2 * MARGIN, h: y - top });
    y += BAND_GAP;
  }

  return { width: Math.round(width), height: Math.round(y - BAND_GAP + MARGIN), nodes, bands };
}
