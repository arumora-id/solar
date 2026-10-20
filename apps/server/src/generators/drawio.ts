import type { NormalizedArchimateModel } from './archimate/model.js';
import type { ViewLayout } from './archimate/layout.js';
import { ELEMENT_INFO, isJunction } from './archimate/metamodel.js';
import { layoutArchiMateLabels, routeArchiMateEdges, type RoutedRelationship } from './archimate/routing.js';
import type { SequenceDiagram } from './sequence/model.js';
import { escapeXml, textWidth, wrapText } from './validation.js';
import { computeSequenceTimeline } from './sequence/timeline.js';

/** Editable native mxGraph shapes/edges; no images or calls to third-party services. */
const attrs = (values: Record<string, string | number>) =>
  Object.entries(values).map(([key, value]) => ' ' + key + '="' + escapeXml(String(value)).replace(/\r?\n/g, '&#10;') + '"').join('');
const tag = (name: string, a: Record<string, string | number>, children?: string): string =>
  '<' + name + attrs(a) + (children === undefined ? '/>' : '>' + children + '</' + name + '>');
const geometry = (x: number, y: number, width: number, height: number) =>
  tag('mxGeometry', { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height), as: 'geometry' });
const vertex = (id: string, label: string, x: number, y: number, width: number, height: number, style: string) =>
  tag('mxCell', { id, value: label, style, vertex: 1, parent: 1 }, geometry(x, y, width, height));
const anchoredEdge = (id: string, label: string, source: string, target: string, style: string) =>
  tag('mxCell', { id, value: label, style, edge: 1, parent: 1, source, target },
    tag('mxGeometry', { relative: 1, as: 'geometry' }));
const freeEdge = (id: string, label: string, x1: number, y1: number, x2: number, y2: number, style: string) =>
  tag('mxCell', { id, value: label, style, edge: 1, parent: 1 },
    tag('mxGeometry', { relative: 1, as: 'geometry' },
      tag('mxPoint', { x: Math.round(x1), y: Math.round(y1), as: 'sourcePoint' }) +
      tag('mxPoint', { x: Math.round(x2), y: Math.round(y2), as: 'targetPoint' })));
function page(id: string, title: string, width: number, height: number, cells: string[]): string {
  const model = tag('mxGraphModel', {
    dx: Math.max(960, width), dy: Math.max(720, height), grid: 1, gridSize: 10, guides: 1, tooltips: 1,
    connect: 1, arrows: 1, fold: 1, page: 1, pageScale: 1,
    pageWidth: Math.ceil(width), pageHeight: Math.ceil(height),
  }, tag('root', {}, tag('mxCell', { id: 0 }) + tag('mxCell', { id: 1, parent: 0 }) + cells.join('')));
  return tag('diagram', { id, name: title }, model);
}
const document = (pages: string[]) =>
  '<?xml version="1.0" encoding="UTF-8"?>\n' + tag('mxfile', { host: 'app.diagrams.net', agent: 'SOLAR AI AGENT' }, pages.join('')) + '\n';
const fills: Record<string, string> = {
  business: '#FFF0C4', application: '#D9EEFF', technology: '#DDF3DD', physical: '#E9F1D7',
  motivation: '#F1E4F9', strategy: '#FBE3E7', implementation: '#FDE6D5', other: '#F2F2F2',
};
/** Every ArchiMate view becomes a page with independently editable shapes and connectors. */
export function toDrawioArchimate(
  model: NormalizedArchimateModel,
  layouts: Map<string, ViewLayout>,
  routesByView?: Map<string, Map<string, RoutedRelationship>>,
): string {
  const pages: string[] = [];
  for (const [index, view] of model.views.entries()) {
    const layout = layouts.get(view.id);
    if (!layout) continue;
    const cells: string[] = [];
    const ids = new Map<string, string>();
    cells.push(vertex('title-' + index, model.name + ' — ' + view.name, 28, 15, layout.width - 56, 50,
      'text;html=0;align=left;verticalAlign=middle;fontSize=19;fontStyle=1;strokeColor=none;fillColor=none;'));
    layout.bands.forEach((band, i) => {
      cells.push(vertex('band-' + index + '-' + i, band.layer.toUpperCase(), band.x, band.y, band.w, band.h,
        'rounded=1;arcSize=5;html=0;align=left;verticalAlign=top;spacingLeft=7;spacingTop=7;fontSize=11;fontStyle=1;strokeColor=#CBD5E1;fillColor=#F7F9FC;fillOpacity=65;'));
    });
    view.elements.forEach((elementId, i) => {
      const n = layout.nodes.get(elementId);
      if (!n) return;
      const id = 'el-' + index + '-' + i;
      ids.set(elementId, id);
      const info = ELEMENT_INFO[n.element.type];
      const label = isJunction(n.element.type) ? (n.element.type === 'AndJunction' ? 'AND' : 'OR') :
        n.element.name + '\n«' + info.label + '»';
      const style = (isJunction(n.element.type) ? 'ellipse=1;' : 'rounded=1;arcSize=8;') +
        'whiteSpace=wrap;html=0;align=center;verticalAlign=middle;strokeColor=#48556A;fillColor=' +
        (fills[info.layer] ?? fills.other) + ';fontColor=#172333;fontSize=12;';
      cells.push(vertex(id, label, n.x, n.y, n.w, n.h, style));
    });
    const rels = view.relationships.map((id) => model.relationships.find((r) => r.id === id)!).filter(Boolean);
    const routes = routesByView?.get(view.id) ?? routeArchiMateEdges(layout, rels);
    const labels = layoutArchiMateLabels(layout, rels, routes);
    view.relationships.forEach((rid, i) => {
      const r = model.relationships.find((candidate) => candidate.id === rid);
      if (!r) return;
      const source = ids.get(r.source), target = ids.get(r.target);
      if (!source || !target) return;
      const points = routes.get(r.id)?.points;
      if (!points || points.length < 2) return;
      const dashed = ['Association', 'Influence', 'Realization'].includes(r.type);
      const src = layout.nodes.get(r.source)!, dst = layout.nodes.get(r.target)!;
      const start = points[0]!, end = points[points.length - 1]!;
      const normalized = (n: number) => Math.max(0, Math.min(1, n)).toFixed(4);
      const style = 'edgeStyle=none;orthogonal=1;rounded=0;html=0;strokeColor=#56647A;strokeWidth=1.5;' +
        (dashed ? 'dashed=1;' : '') + 'endArrow=' + (r.isDirected === false ? 'none' : 'block') +
        ';endFill=1;exitX=' + normalized((start.x - src.x) / src.w) +
        ';exitY=' + normalized((start.y - src.y) / src.h) +
        ';entryX=' + normalized((end.x - dst.x) / dst.w) +
        ';entryY=' + normalized((end.y - dst.y) / dst.h) +
        ';exitDx=0;exitDy=0;entryDx=0;entryDy=0;exitPerimeter=1;entryPerimeter=1;';
      // Editable mxGeometry waypoints preserve the bends computed by the shared router.
      const routePoints = points.slice(1, -1).map((p) =>
        tag('mxPoint', { x: Math.round(p.x), y: Math.round(p.y) })).join('');
      cells.push(tag('mxCell', {
        id: 'rel-' + index + '-' + i, value: '', style, edge: 1, parent: 1, source, target,
      }, tag('mxGeometry', { relative: 1, as: 'geometry' },
        tag('Array', { as: 'points' }, routePoints))));
      const label = labels.get(r.id);
      if (label) {
        const box = label.box;
        cells.push(vertex('rel-label-' + index + '-' + i, label.lines.join('\n'),
          box.x, box.y, box.w, box.h,
          'text;html=0;whiteSpace=wrap;align=center;verticalAlign=middle;strokeColor=none;fillColor=#FFFFFF;opacity=95;fontSize=10.5;'));
      }
    });
    pages.push(page('solar-archimate-' + index, view.name, layout.width + 20, layout.height + 40, cells));
  }
  return document(pages);
}
const SEQ_STYLE = 'rounded=1;whiteSpace=wrap;html=0;align=center;verticalAlign=middle;strokeColor=#69778A;fillColor=#E7EDF7;fontColor=#15243B;fontSize=12;';
/** Sequence participants/lifelines, messages, notes, and frames remain editable mxGraph cells. */
export function toDrawioSequence(diagram: SequenceDiagram): string {
  const timeline = computeSequenceTimeline(diagram);
  const cols = timeline.columns;
  const xs = new Map(cols.map((c) => [c.p.id, c.x]));
  const position = (id: string) => xs.get(id)!;
  const first = cols[0]!, last = cols[cols.length - 1]!;
  const left = Math.max(8, first.x - Math.max(82, first.w / 2 + 16));
  const labelLines = (value: string) => wrapText(value, 260, 12);
  const labelWidth = (value: string) => Math.max(88, Math.min(280,
    Math.max(...labelLines(value).map((line) => textWidth(line, 12))) + 18));
  // Reserve room for labels on self-messages and notes, not only participant heads.
  const rightNeed = diagram.steps.reduce((max, step) => {
    if (step.type === 'message' && step.from === step.to)
      return Math.max(max, position(step.from) + 46 + labelWidth(step.text) + 12);
    if (step.type === 'note')
      return Math.max(max, Math.max(...step.over.map(position)) + 142);
    return max;
  }, last.x + Math.max(82, last.w / 2 + 16));
  const right = rightNeed + 12;
  const width = Math.max(490, Math.ceil(right + 26), Math.ceil(textWidth(diagram.title, 20) + 85));
  const headH = timeline.headHeight;
  const headTop = timeline.headTop;
  let y = timeline.startY, counter = 0, frameIndex = 0;
  const body: string[] = [], frames: string[] = [], activations: string[] = [];
  const stack: Array<{ kind: string; label: string; start: number; index: number }> = [];
  const active = new Map<string, number[]>();
  const activationX = (id: string, depth: number) => position(id) + (depth - 1) * 5 - 5;
  const edgeX = (id: string, towardRight: boolean) => {
    const depth = active.get(id)?.length ?? 0;
    const half = 5 + (depth - 1) * 5;
    return depth === 0 ? position(id) : position(id) + (towardRight ? half : -half);
  };
  const closeActivation = (id: string, at: number) => {
    const values = active.get(id);
    if (!values?.length) return; // semantic validation remains in validateSequence
    const from = values.pop()!;
    activations.push(vertex('activation-' + id + '-' + activations.length, '',
      activationX(id, values.length + 1), from, 10, Math.max(8, at - from),
      'rounded=0;strokeColor=#5B76A1;fillColor=#BDD4F4;'));
  };
  timeline.steps.forEach((placement, i) => {
    const step = placement.step;
    y = placement.top;
    const id = 'step-' + i;
    switch (step.type) {
      case 'message': {
        counter++;
        const lines = placement.messageLines!;
        const label = (diagram.autonumber ? String(counter) + '. ' : '') + step.text;
        const labelH = lines.length * 15 + 1;
        const labelW = labelWidth(label);
        const x1 = position(step.from), x2 = position(step.to);
        const color = step.style === 'reply' ? 'dashed=1;' : '';
        const arrow = step.style === 'async' ? 'open' : 'block';
        const style = 'endArrow=' + arrow + ';endFill=' + (step.style === 'reply' ? '0' : '1') + ';' +
          color + 'strokeWidth=1.5;strokeColor=#40536B;html=0;';
        const labelStyle = 'text;html=0;whiteSpace=wrap;overflow=hidden;align=center;verticalAlign=middle;rounded=1;strokeColor=none;fillColor=#FFFFFF;fontColor=#15243B;fontSize=12;';
        const arrowY = placement.arrowY!;
        if (x1 === x2) {
          const startX = edgeX(step.from, true);
          body.push(vertex(id + '-label', label, startX + 41, y, labelW, labelH,
            labelStyle + 'align=left;spacingLeft=5;'));
          // A real three-sided loop; the legacy single short segment was not a self-message.
          if (step.deactivate) closeActivation(step.from, arrowY + 22);
          if (step.activate) active.set(step.to, [...(active.get(step.to) ?? []), arrowY + 22]);
          const returnX = edgeX(step.to, true);
          body.push(freeEdge(id, '', startX, arrowY, startX + 36, arrowY,
            'endArrow=none;strokeColor=#40536B;' + color));
          body.push(freeEdge(id + '-bend', '', startX + 36, arrowY, startX + 36, arrowY + 22,
            'endArrow=none;strokeColor=#40536B;' + color));
          body.push(freeEdge(id + '-return', '', startX + 36, arrowY + 22, returnX, arrowY + 22, style));
          y = placement.bottom;
        } else {
          body.push(vertex(id + '-label', label, (x1 + x2 - labelW) / 2, y, labelW, labelH, labelStyle));
          const towardRight = x2 > x1;
          const startX = edgeX(step.from, towardRight);
          if (step.deactivate) closeActivation(step.from, arrowY);
          if (step.activate) active.set(step.to, [...(active.get(step.to) ?? []), arrowY]);
          body.push(freeEdge(id, '', startX, arrowY, edgeX(step.to, !towardRight), arrowY, style));
          y = placement.bottom;
        }
        break;
      }
      case 'note': {
        const note = placement.note!;
        body.push(vertex(id, step.text, Math.max(5, note.x), y, note.width, note.height,
          'shape=note;whiteSpace=wrap;html=0;overflow=hidden;spacingTop=5;spacingBottom=5;strokeColor=#BEA446;fillColor=#FFF5C8;fontColor=#3F3724;fontSize=11.5;'));
        y = placement.bottom;
        break;
      }
      case 'divider':
        body.push(vertex(id, step.text, left, y, right - left, 32,
          'text;html=0;whiteSpace=wrap;align=center;fontStyle=1;strokeColor=#B2BCCA;fillColor=#F2F5FA;'));
        y = placement.bottom;
        break;
      case 'fragment_start': {
        stack.push({ kind: step.kind, label: step.label, start: y, index: frameIndex++ });
        y = placement.bottom;
        break;
      }
      case 'fragment_else': {
        const branch = (stack.at(-1)?.kind === 'par' ? 'and' : 'else') +
          (step.label ? ' ' + step.label : '');
        const branchH = Math.max(27, placement.bottom - placement.top - 6);
        body.push(vertex(id + '-branch', branch, left + 5, y, right - left - 10, branchH,
          'text;html=0;whiteSpace=wrap;align=left;verticalAlign=middle;spacingLeft=10;strokeColor=#9BA8BC;dashed=1;fillColor=#F7F9FD;'));
        y = placement.bottom;
        break;
      }
      case 'fragment_end': {
        const frame = stack.pop();
        if (frame) frames.push(vertex('frame-' + frame.index,
          frame.kind + (frame.label ? ' ' + frame.label : ''),
          left, frame.start, right - left, Math.max(65, y - frame.start + 2),
          'swimlane;html=0;whiteSpace=wrap;startSize=35;horizontal=1;rounded=0;strokeColor=#6F84A5;fillColor=#F4F7FC;fillOpacity=15;fontStyle=1;align=left;spacingLeft=10;'));
        y = placement.bottom;
        break;
      }
    }
  });
  const footTop = timeline.endY + 16;
  const height = footTop + headH + 24;
  for (const [id, values] of active) while (values.length) closeActivation(id, timeline.endY + 6);
  const cells = [
    vertex('seq-title', diagram.title, 34, 14, width - 68, 33,
      'text;html=0;whiteSpace=wrap;fontSize=17;fontStyle=1;align=left;strokeColor=none;fillColor=none;'),
    ...timeline.descriptionLines.map((line, i) =>
      vertex('seq-description-' + i, line, 34, 43 + i * 15, width - 68, 15,
        'text;html=0;whiteSpace=wrap;fontSize=11.5;align=left;strokeColor=none;fillColor=none;')),
    ...frames,
  ];
  cols.forEach((c, i) => {
    cells.push(vertex('participant-' + i, c.p.label, c.x - c.w / 2, headTop, c.w, headH, SEQ_STYLE));
    cells.push(vertex('participant-footer-' + i, c.p.label, c.x - c.w / 2, footTop, c.w, headH, SEQ_STYLE));
    cells.push(freeEdge('lifeline-' + i, '', c.x, headTop + headH, c.x, footTop,
      'dashed=1;dashPattern=5 5;strokeColor=#9BA8BC;endArrow=none;'));
  });
  cells.push(...activations, ...body);
  return document([page('solar-sequence', diagram.title, width, height, cells)]);
}
