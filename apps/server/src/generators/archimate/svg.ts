import { escapeXml, textWidth, wrapText } from '../validation.js';
import { BAND_LABEL_W, MARGIN, type NodeBox, type ViewLayout } from './layout.js';
import { ELEMENT_INFO, LAYER_BAND_FILL, LAYER_LABEL, elementFill, type Glyph, type RelationshipType } from './metamodel.js';
import type { ArchimateRelationship } from './model.js';

const MAX_TITLE_CANVAS = 1400;

const FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const STROKE = '#4a4a4a';

interface Point {
  x: number;
  y: number;
}

const f = (n: number) => Math.round(n * 10) / 10;

/** Glyph drawn in an 18x14 box whose top-left corner is (x, y). */
function glyph(kind: Glyph, x: number, y: number): string {
  const p = (d: string) => `<path d="${d}"/>`;
  const c = (cx: number, cy: number, r: number, fill = 'none') => `<circle cx="${f(x + cx)}" cy="${f(y + cy)}" r="${r}" fill="${fill}"/>`;
  const r = (rx: number, ry: number, w: number, h: number, rad = 0, fill = 'none') =>
    `<rect x="${f(x + rx)}" y="${f(y + ry)}" width="${w}" height="${h}" rx="${rad}" fill="${fill}"/>`;
  const X = (n: number) => f(x + n);
  const Y = (n: number) => f(y + n);
  switch (kind) {
    case 'actor':
      return c(9, 3, 2.6) + p(`M${X(9)} ${Y(5.6)}V${Y(10)}M${X(5)} ${Y(7.5)}H${X(13)}M${X(9)} ${Y(10)}L${X(5.5)} ${Y(14)}M${X(9)} ${Y(10)}L${X(12.5)} ${Y(14)}`);
    case 'role':
    case 'stakeholder':
      return p(`M${X(5)} ${Y(2)}H${X(13)}A3 5 0 0 1 ${X(13)} ${Y(12)}H${X(5)}A3 5 0 0 1 ${X(5)} ${Y(2)}Z`) + `<ellipse cx="${X(13)}" cy="${Y(7)}" rx="3" ry="5" fill="none"/>`;
    case 'collaboration':
      return c(6.5, 7, 5) + c(11.5, 7, 5);
    case 'interface':
      return c(12, 7, 4) + p(`M${X(2)} ${Y(7)}H${X(8)}`);
    case 'process':
      return p(`M${X(1)} ${Y(5)}H${X(11)}V${Y(2)}L${X(17)} ${Y(7)}L${X(11)} ${Y(12)}V${Y(9)}H${X(1)}Z`);
    case 'function':
      return p(`M${X(2)} ${Y(4)}L${X(9)} ${Y(1)}L${X(16)} ${Y(4)}V${Y(13)}L${X(9)} ${Y(10)}L${X(2)} ${Y(13)}Z`);
    case 'interaction':
      return p(`M${X(8)} ${Y(2)}A5 5 0 0 0 ${X(8)} ${Y(12)}Z`) + p(`M${X(10)} ${Y(2)}A5 5 0 0 1 ${X(10)} ${Y(12)}Z`);
    case 'event':
      return p(`M${X(1)} ${Y(2)}H${X(13)}A3 5 0 0 1 ${X(13)} ${Y(12)}H${X(1)}L${X(4)} ${Y(7)}Z`);
    case 'service':
      return r(1, 3, 16, 8, 4);
    case 'object':
      return r(2, 2, 14, 10) + p(`M${X(2)} ${Y(5)}H${X(16)}`);
    case 'contract':
      return r(2, 2, 14, 10) + p(`M${X(2)} ${Y(5)}H${X(16)}M${X(2)} ${Y(8.5)}H${X(16)}`);
    case 'representation':
    case 'deliverable':
      return p(`M${X(2)} ${Y(2)}H${X(16)}V${Y(11)}Q${X(12.5)} ${Y(8)} ${X(9)} ${Y(11)}T${X(2)} ${Y(11)}Z`);
    case 'product':
      return r(2, 2, 14, 10) + r(2, 2, 7, 3);
    case 'component':
      return r(5, 1, 12, 12) + r(2, 3.5, 6, 2.5, 0, '#ffffff') + r(2, 8, 6, 2.5, 0, '#ffffff');
    case 'node':
      return p(`M${X(1)} ${Y(4)}L${X(4)} ${Y(1)}H${X(17)}V${Y(10)}L${X(14)} ${Y(13)}H${X(1)}ZM${X(1)} ${Y(4)}H${X(14)}V${Y(13)}M${X(14)} ${Y(4)}L${X(17)} ${Y(1)}`);
    case 'device':
      return r(2, 1, 14, 9, 1) + p(`M${X(5)} ${Y(13)}H${X(13)}L${X(11)} ${Y(10)}H${X(7)}Z`);
    case 'systemSoftware':
      return c(8, 8, 5.5) + p(`M${X(6)} ${Y(3.2)}A5.5 5.5 0 0 1 ${X(14.5)} ${Y(9)}`);
    case 'path':
      return `<path d="M${X(2)} ${Y(7)}H${X(16)}" stroke-dasharray="2 2"/>` + p(`M${X(4)} ${Y(4)}L${X(1)} ${Y(7)}L${X(4)} ${Y(10)}M${X(14)} ${Y(4)}L${X(17)} ${Y(7)}L${X(14)} ${Y(10)}`);
    case 'network':
      return p(`M${X(3)} ${Y(11)}L${X(6)} ${Y(3)}H${X(16)}L${X(13)} ${Y(11)}Z`) + c(3, 11, 1.5, STROKE) + c(6, 3, 1.5, STROKE) + c(16, 3, 1.5, STROKE) + c(13, 11, 1.5, STROKE);
    case 'artifact':
      return p(`M${X(3)} ${Y(1)}H${X(11)}L${X(15)} ${Y(5)}V${Y(13)}H${X(3)}ZM${X(11)} ${Y(1)}V${Y(5)}H${X(15)}`);
    case 'equipment':
      return c(7, 8, 4) + c(13.5, 4, 2.5);
    case 'facility':
      return p(`M${X(1)} ${Y(13)}V${Y(3)}H${X(4)}V${Y(8)}L${X(8)} ${Y(5)}V${Y(8)}L${X(12)} ${Y(5)}V${Y(8)}L${X(16)} ${Y(5)}V${Y(13)}Z`);
    case 'distribution':
      return p(`M${X(3)} ${Y(5)}H${X(15)}M${X(3)} ${Y(9)}H${X(15)}M${X(5)} ${Y(2.5)}L${X(1)} ${Y(7)}L${X(5)} ${Y(11.5)}M${X(13)} ${Y(2.5)}L${X(17)} ${Y(7)}L${X(13)} ${Y(11.5)}`);
    case 'material':
      return p(`M${X(5)} ${Y(1)}H${X(13)}L${X(17)} ${Y(7)}L${X(13)} ${Y(13)}H${X(5)}L${X(1)} ${Y(7)}Z`);
    case 'driver':
      return c(9, 7, 5.5) + p(`M${X(9)} ${Y(1)}V${Y(13)}M${X(3)} ${Y(7)}H${X(15)}`) + c(9, 7, 1.5, STROKE);
    case 'assessment':
      return c(7, 6, 4.5) + p(`M${X(10.2)} ${Y(9.2)}L${X(15)} ${Y(13.5)}`);
    case 'goal':
      return c(9, 7, 6) + c(9, 7, 3.8) + c(9, 7, 1.5, STROKE);
    case 'outcome':
      return c(8, 8, 5.5) + c(8, 8, 3) + p(`M${X(8)} ${Y(8)}L${X(16)} ${Y(1)}M${X(12.5)} ${Y(1)}H${X(16)}V${Y(4.5)}`);
    case 'principle':
      return r(3, 1, 12, 12) + p(`M${X(9)} ${Y(3.5)}V${Y(8.5)}`) + c(9, 10.8, 0.8, STROKE);
    case 'requirement':
      return p(`M${X(5)} ${Y(2)}H${X(17)}L${X(13)} ${Y(12)}H${X(1)}Z`);
    case 'constraint':
      return p(`M${X(5)} ${Y(2)}H${X(17)}L${X(13)} ${Y(12)}H${X(1)}ZM${X(8)} ${Y(2)}L${X(4)} ${Y(12)}`);
    case 'meaning':
      return p(`M${X(5)} ${Y(11)}A3 3 0 0 1 ${X(4)} ${Y(5)}A4 4 0 0 1 ${X(11)} ${Y(3)}A3.5 3.5 0 0 1 ${X(16)} ${Y(8)}A3 3 0 0 1 ${X(13)} ${Y(11)}Z`);
    case 'value':
      return `<ellipse cx="${X(9)}" cy="${Y(7)}" rx="7" ry="4.5" fill="none"/>`;
    case 'resource':
      return r(1, 4, 14, 7, 2) + r(15, 6, 2, 3) + p(`M${X(5)} ${Y(6)}V${Y(9)}M${X(8)} ${Y(6)}V${Y(9)}M${X(11)} ${Y(6)}V${Y(9)}`);
    case 'capability':
      return r(11, 1, 4, 4) + r(7, 5, 4, 4) + r(11, 5, 4, 4) + r(3, 9, 4, 4) + r(7, 9, 4, 4) + r(11, 9, 4, 4);
    case 'valueStream':
      return p(`M${X(1)} ${Y(2)}H${X(13)}L${X(17)} ${Y(7)}L${X(13)} ${Y(12)}H${X(1)}L${X(5)} ${Y(7)}Z`);
    case 'courseOfAction':
      return c(11, 5, 4.5) + c(11, 5, 1.8, STROKE) + p(`M${X(7.8)} ${Y(8.2)}L${X(2)} ${Y(13)}`);
    case 'workPackage':
      return p(`M${X(15)} ${Y(7)}A6 5 0 1 1 ${X(11)} ${Y(2.3)}M${X(8.8)} ${Y(0.6)}L${X(11.3)} ${Y(2.3)}L${X(9.2)} ${Y(4.6)}`);
    case 'plateau':
      return `<path d="M${X(5)} ${Y(3)}H${X(17)}M${X(3)} ${Y(7)}H${X(15)}M${X(1)} ${Y(11)}H${X(13)}" stroke-width="2"/>`;
    case 'gap':
      return c(9, 7, 5) + p(`M${X(2)} ${Y(5.5)}H${X(16)}M${X(2)} ${Y(8.5)}H${X(16)}`);
    case 'location':
      return p(`M${X(9)} ${Y(13.5)}L${X(5)} ${Y(7.5)}A4.5 4.5 0 1 1 ${X(13)} ${Y(7.5)}Z`) + c(9, 4.8, 1.4);
    case 'grouping':
    case 'junction':
      return '';
  }
}

function nodeShape(node: NodeBox): string {
  const el = node.element;
  const meta = ELEMENT_INFO[el.type];
  const fill = elementFill(el.type);
  const { x, y, w, h } = node;
  switch (meta.shape) {
    case 'junction':
      return `<circle cx="${x + w / 2}" cy="${y + h / 2}" r="${w / 2 - 1}" fill="${fill}" stroke="#000" stroke-width="1.4"/>`;
    case 'group':
      return (
        `<rect x="${x}" y="${y + 14}" width="${w}" height="${h - 14}" fill="none" stroke="${STROKE}" stroke-dasharray="6 3"/>` +
        `<path d="M${x} ${y + 14}V${y}H${x + w * 0.6}V${y + 14}" fill="none" stroke="${STROKE}" stroke-dasharray="6 3"/>`
      );
    case 'cut': {
      const k = 9;
      return `<path d="M${x + k} ${y}H${x + w - k}L${x + w} ${y + k}V${y + h - k}L${x + w - k} ${y + h}H${x + k}L${x} ${y + h - k}V${y + k}Z" fill="${fill}" stroke="${STROKE}"/>`;
    }
    case 'pill':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="26" fill="${fill}" stroke="${STROKE}"/>`;
    case 'rounded':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${STROKE}"/>`;
    case 'rect':
    default: {
      let extra = '';
      if (meta.headerBand) extra = `<path d="M${x} ${y + 16}H${x + w}" stroke="${STROKE}"/>`;
      if (el.type === 'Contract') extra += `<path d="M${x} ${y + h - 14}H${x + w}" stroke="${STROKE}"/>`;
      if (el.type === 'Representation' || el.type === 'Deliverable') {
        return `<path d="M${x} ${y}H${x + w}V${y + h - 8}Q${x + w * 0.75} ${y + h - 18} ${x + w / 2} ${y + h - 8}T${x} ${y + h - 8}Z" fill="${fill}" stroke="${STROKE}"/>`;
      }
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${fill}" stroke="${STROKE}"/>${extra}`;
    }
  }
}

function renderNode(node: NodeBox): string {
  const el = node.element;
  const meta = ELEMENT_INFO[el.type];
  const { x, y, w, h } = node;
  const title = `<title>${escapeXml(`${meta.label}: ${el.name}${el.documentation ? `\n${el.documentation}` : ''}`)}</title>`;
  if (meta.shape === 'junction') {
    return `<g class="node" data-id="${escapeXml(el.id)}">${title}${nodeShape(node)}</g>`;
  }
  const lines = wrapText(el.name, w - 26, 12, meta.shape === 'group' ? 1 : 3);
  const nameTop = meta.shape === 'group' ? y + 11 : y + 22 + (3 - lines.length) * 6;
  const textX = meta.shape === 'group' ? x + 6 : x + w / 2;
  const anchor = meta.shape === 'group' ? 'start' : 'middle';
  const name = lines
    .map((line, i) => `<text x="${textX}" y="${nameTop + i * 14}" text-anchor="${anchor}" font-size="12" font-weight="600" fill="#1f2328">${escapeXml(line)}</text>`)
    .join('');
  const typeText =
    meta.shape === 'group'
      ? ''
      : `<text x="${x + w / 2}" y="${y + h - 6}" text-anchor="middle" font-size="9.5" fill="#5b616b">${escapeXml(meta.label)}</text>`;
  const icon = glyph(meta.glyph, x + w - 24, y + 5);
  return (
    `<g class="node" data-id="${escapeXml(el.id)}">${title}${nodeShape(node)}` +
    (icon ? `<g fill="none" stroke="${STROKE}" stroke-width="1.1">${icon}</g>` : '') +
    `${name}${typeText}</g>`
  );
}

const DASH: Partial<Record<RelationshipType, string>> = {
  Realization: '6 4',
  Influence: '6 4',
  Flow: '7 4',
  Access: '2 3',
};

function markersFor(r: ArchimateRelationship): { start?: string; end?: string } {
  switch (r.type) {
    case 'Composition':
      return { start: 'diamond-filled' };
    case 'Aggregation':
      return { start: 'diamond-hollow' };
    case 'Assignment':
      return { start: 'dot', end: 'arrow-filled' };
    case 'Realization':
    case 'Specialization':
      return { end: 'triangle-hollow' };
    case 'Serving':
    case 'Influence':
      return { end: 'arrow-open' };
    case 'Triggering':
    case 'Flow':
      return { end: 'arrow-filled' };
    case 'Access':
      if (r.accessType === 'Write') return { end: 'arrow-small' };
      if (r.accessType === 'Read') return { start: 'arrow-small' };
      if (r.accessType === 'ReadWrite') return { start: 'arrow-small', end: 'arrow-small' };
      return {};
    case 'Association':
      return r.isDirected ? { end: 'arrow-half' } : {};
  }
}

const MARKER_DEFS = `
<marker id="arrow-filled" viewBox="0 0 10 10" refX="9.5" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="${STROKE}"/></marker>
<marker id="arrow-open" viewBox="0 0 10 10" refX="9.5" refY="5" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L10 5L0 10" fill="none" stroke="${STROKE}" stroke-width="1.3"/></marker>
<marker id="arrow-small" viewBox="0 0 10 10" refX="9.5" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 1L10 5L0 9" fill="none" stroke="${STROKE}" stroke-width="1.3"/></marker>
<marker id="arrow-half" viewBox="0 0 10 10" refX="9.5" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L10 5" fill="none" stroke="${STROKE}" stroke-width="1.3"/></marker>
<marker id="triangle-hollow" viewBox="0 0 12 12" refX="11.5" refY="6" markerWidth="13" markerHeight="13" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L12 6L0 12Z" fill="#ffffff" stroke="${STROKE}" stroke-width="1.2"/></marker>
<marker id="diamond-filled" viewBox="0 0 16 10" refX="15.5" refY="5" markerWidth="16" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 5L8 0L16 5L8 10Z" fill="${STROKE}"/></marker>
<marker id="diamond-hollow" viewBox="0 0 16 10" refX="15.5" refY="5" markerWidth="16" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 5L8 0L16 5L8 10Z" fill="#ffffff" stroke="${STROKE}" stroke-width="1.1"/></marker>
<marker id="dot" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><circle cx="4" cy="4" r="3.2" fill="${STROKE}"/></marker>`;

/** Point where the segment from the box centre towards `toward` leaves the box. */
function clipToBox(box: NodeBox, toward: Point): Point {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  if (box.w === box.h && box.w <= 20) {
    const len = Math.hypot(dx, dy);
    return { x: cx + (dx / len) * (box.w / 2), y: cy + (dy / len) * (box.h / 2) };
  }
  const sx = dx === 0 ? Infinity : box.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : box.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

interface EdgeGeometry {
  d: string;
  label: Point;
}

const PAD = 5;

function insideAny(pt: Point, boxes: NodeBox[]): boolean {
  return boxes.some((b) => pt.x > b.x - PAD && pt.x < b.x + b.w + PAD && pt.y > b.y - PAD && pt.y < b.y + b.h + PAD);
}

function segmentHits(a: Point, b: Point, boxes: NodeBox[]): boolean {
  const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 5));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (insideAny({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, boxes)) return true;
  }
  return false;
}

function quadPoint(a: Point, c: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

function curveHits(a: Point, c: Point, b: Point, boxes: NodeBox[], bounds: { minX: number; maxX: number; minY: number }): boolean {
  for (let i = 1; i < 40; i++) {
    const pt = quadPoint(a, c, b, i / 40);
    if (pt.x < bounds.minX || pt.x > bounds.maxX || pt.y < bounds.minY) return true;
    if (insideAny(pt, boxes)) return true;
  }
  return false;
}

/**
 * Straight connection when nothing is in the way; otherwise the first quadratic curve (bending
 * left or right, progressively further) that clears every other element of the view.
 */
function edgeGeometry(
  src: NodeBox,
  dst: NodeBox,
  offset: number,
  all: NodeBox[],
  bounds: { minX: number; maxX: number; minY: number },
): EdgeGeometry {
  const c1 = { x: src.x + src.w / 2, y: src.y + src.h / 2 };
  const c2 = { x: dst.x + dst.w / 2, y: dst.y + dst.h / 2 };

  if (src.id === dst.id) {
    const sx = src.x + src.w - 20;
    const sy = src.y;
    const ex = src.x + src.w;
    const ey = src.y + 20;
    return {
      d: `M${sx} ${sy}C${sx + 10} ${sy - 36} ${ex + 36} ${ey - 10} ${ex} ${ey}`,
      label: { x: ex + 18, y: sy - 14 },
    };
  }

  const obstacles = all.filter((o) => o.id !== src.id && o.id !== dst.id);
  const len = Math.hypot(c2.x - c1.x, c2.y - c1.y) || 1;
  const nx = -(c2.y - c1.y) / len;
  const ny = (c2.x - c1.x) / len;

  if (offset === 0) {
    const p1 = clipToBox(src, c2);
    const p2 = clipToBox(dst, c1);
    if (!segmentHits(p1, p2, obstacles)) {
      return { d: `M${f(p1.x)} ${f(p1.y)}L${f(p2.x)} ${f(p2.y)}`, label: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } };
    }
  }

  // Curved candidates; same-row connections prefer bending upwards, parallel ones keep their side.
  const mid = { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2 };
  const upFirst = ny < 0 ? 1 : -1;
  const preferred = offset !== 0 ? Math.sign(offset) : upFirst;
  const magnitudes = [40, 80, 130, 190, 260, 340];
  const base = offset !== 0 ? Math.abs(offset) * 2.2 : 0;
  for (const m of magnitudes) {
    for (const side of [preferred, -preferred]) {
      const k = side * (m + base);
      const ctrl = { x: mid.x + nx * k, y: mid.y + ny * k };
      const p1 = clipToBox(src, ctrl);
      const p2 = clipToBox(dst, ctrl);
      if (!curveHits(p1, ctrl, p2, obstacles, bounds)) {
        return {
          d: `M${f(p1.x)} ${f(p1.y)}Q${f(ctrl.x)} ${f(ctrl.y)} ${f(p2.x)} ${f(p2.y)}`,
          label: quadPoint(p1, ctrl, p2, 0.5),
        };
      }
    }
  }

  // Nothing clears every element: keep a gentle curve (parallel) or a straight line.
  if (offset !== 0) {
    const ctrl = { x: mid.x + nx * offset * 2.2, y: mid.y + ny * offset * 2.2 };
    const p1 = clipToBox(src, ctrl);
    const p2 = clipToBox(dst, ctrl);
    return { d: `M${f(p1.x)} ${f(p1.y)}Q${f(ctrl.x)} ${f(ctrl.y)} ${f(p2.x)} ${f(p2.y)}`, label: quadPoint(p1, ctrl, p2, 0.5) };
  }
  const p1 = clipToBox(src, c2);
  const p2 = clipToBox(dst, c1);
  return { d: `M${f(p1.x)} ${f(p1.y)}L${f(p2.x)} ${f(p2.y)}`, label: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } };
}

function relationshipLabel(r: ArchimateRelationship): string {
  const parts: string[] = [];
  if (r.name) parts.push(r.name);
  if (r.type === 'Influence' && r.influenceModifier) parts.push(r.influenceModifier);
  return parts.join(' ');
}

function legend(types: RelationshipType[], x: number, y: number, maxWidth: number): { svg: string; height: number } {
  if (types.length === 0) return { svg: '', height: 0 };
  const itemW = 170;
  const perRow = Math.max(1, Math.floor(maxWidth / itemW));
  const rows = Math.ceil(types.length / perRow);
  const items = types
    .map((t, i) => {
      const ix = x + (i % perRow) * itemW;
      const iy = y + 22 + Math.floor(i / perRow) * 20;
      const fake = { type: t, accessType: t === 'Access' ? ('Write' as const) : undefined, isDirected: t === 'Association' ? false : undefined } as ArchimateRelationship;
      const m = markersFor(fake);
      return (
        `<path d="M${ix} ${iy}H${ix + 46}" stroke="${STROKE}" stroke-width="1.2" fill="none"` +
        (DASH[t] ? ` stroke-dasharray="${DASH[t]}"` : '') +
        (m.start ? ` marker-start="url(#${m.start})"` : '') +
        (m.end ? ` marker-end="url(#${m.end})"` : '') +
        `/><text x="${ix + 54}" y="${iy + 4}" font-size="11" fill="#3d434a">${t}</text>`
      );
    })
    .join('');
  return {
    svg: `<g class="legend"><text x="${x}" y="${y + 6}" font-size="11" font-weight="600" fill="#3d434a">Relationships</text>${items}</g>`,
    height: 22 + rows * 20 + 6,
  };
}

export interface RenderViewOptions {
  modelName: string;
  viewName: string;
  viewpoint?: string;
  relationships: ArchimateRelationship[];
}

export function renderViewSvg(layout: ViewLayout, opts: RenderViewOptions): string {
  const nodes = [...layout.nodes.values()];
  const rels = opts.relationships.filter((r) => layout.nodes.has(r.source) && layout.nodes.has(r.target));

  const pairCount = new Map<string, number>();
  const pairIndex = new Map<string, number>();
  const pairKey = (r: ArchimateRelationship) => [r.source, r.target].sort().join('|');
  for (const r of rels) pairCount.set(pairKey(r), (pairCount.get(pairKey(r)) ?? 0) + 1);

  const edges: string[] = [];
  const labels: string[] = [];
  const bounds = { minX: MARGIN + BAND_LABEL_W, maxX: layout.width - MARGIN, minY: MARGIN + 44 };
  for (const r of rels) {
    const key = pairKey(r);
    const n = pairCount.get(key)!;
    const k = pairIndex.get(key) ?? 0;
    pairIndex.set(key, k + 1);
    // keep the offset direction stable regardless of edge direction
    const sign = r.source < r.target ? 1 : -1;
    const offset = n > 1 ? (k - (n - 1) / 2) * 14 * sign : 0;
    const geo = edgeGeometry(layout.nodes.get(r.source)!, layout.nodes.get(r.target)!, offset, nodes, bounds);
    const m = markersFor(r);
    edges.push(
      `<path class="rel" data-id="${escapeXml(r.id)}" d="${geo.d}" fill="none" stroke="${STROKE}" stroke-width="1.2"` +
        (DASH[r.type] ? ` stroke-dasharray="${DASH[r.type]}"` : '') +
        (m.start ? ` marker-start="url(#${m.start})"` : '') +
        (m.end ? ` marker-end="url(#${m.end})"` : '') +
        `><title>${escapeXml(`${r.type}${r.name ? `: ${r.name}` : ''}`)}</title></path>`,
    );
    const text = relationshipLabel(r);
    if (text) {
      const lines = wrapText(text, 150, 10.5, 2);
      const w = Math.max(...lines.map((l) => l.length)) * 5.9 + 8;
      const h = lines.length * 13 + 4;
      labels.push(
        `<g class="rel-label"><rect x="${f(geo.label.x - w / 2)}" y="${f(geo.label.y - h / 2)}" width="${f(w)}" height="${h}" rx="3" fill="#ffffff" fill-opacity="0.9"/>` +
          lines
            .map((l, i) => `<text x="${f(geo.label.x)}" y="${f(geo.label.y - h / 2 + 12 + i * 13)}" text-anchor="middle" font-size="10.5" fill="#24292f">${escapeXml(l)}</text>`)
            .join('') +
          '</g>',
      );
    }
  }

  const bands = layout.bands
    .map(
      (b) =>
        `<g class="band"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6" fill="${LAYER_BAND_FILL[b.layer]}" stroke="#d0d7de"/>` +
        `<text transform="translate(${b.x + BAND_LABEL_W / 2 + 4} ${b.y + b.h / 2}) rotate(-90)" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="600" letter-spacing="0.5" fill="#57606a">${escapeXml(LAYER_LABEL[b.layer].toUpperCase())}</text></g>`,
    )
    .join('');

  const usedTypes = [...new Set(rels.map((r) => r.type))];
  const leg = legend(usedTypes, MARGIN, layout.height, layout.width - 2 * MARGIN);
  const height = layout.height + leg.height + (leg.height ? MARGIN : 0);
  const subtitle = [`Model: ${opts.modelName}`, opts.viewpoint ? `Viewpoint: ${opts.viewpoint}` : null, 'ArchiMate® 3.2']
    .filter(Boolean)
    .join('  ·  ');
  // small views: widen the canvas so title and subtitle fit (up to a cap), then ellipsize what still does not fit
  const titleNeed = Math.max(textWidth(opts.viewName, 17) * 1.08, textWidth(subtitle, 11.5));
  const width = Math.max(layout.width, Math.min(MAX_TITLE_CANVAS, Math.ceil(2 * MARGIN + titleNeed)));
  const title = wrapText(opts.viewName, (width - 2 * MARGIN) / 1.08, 17, 1)[0] ?? '';
  const sub = wrapText(subtitle, width - 2 * MARGIN, 11.5, 1)[0] ?? '';

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}">`,
    `<title>${escapeXml(opts.viewName)}</title>`,
    `<defs>${MARKER_DEFS}</defs>`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    `<text x="${MARGIN}" y="${MARGIN + 18}" font-size="17" font-weight="700" fill="#1f2328">${escapeXml(title)}</text>`,
    `<text x="${MARGIN}" y="${MARGIN + 38}" font-size="11.5" fill="#57606a">${escapeXml(sub)}</text>`,
    bands,
    `<g class="relationships">${edges.join('')}</g>`,
    `<g class="elements">${nodes.map(renderNode).join('')}</g>`,
    `<g class="labels">${labels.join('')}</g>`,
    leg.svg,
    '</svg>',
  ].join('\n');
}
