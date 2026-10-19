import type { NormalizedArchimateModel } from './archimate/model.js';
import type { ViewLayout } from './archimate/layout.js';
import { ELEMENT_INFO, isJunction } from './archimate/metamodel.js';
import type { SequenceDiagram } from './sequence/model.js';
import { escapeXml } from './validation.js';

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
export function toDrawioArchimate(model: NormalizedArchimateModel, layouts: Map<string, ViewLayout>): string {
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
    view.relationships.forEach((rid, i) => {
      const r = model.relationships.find((candidate) => candidate.id === rid);
      if (!r) return;
      const source = ids.get(r.source), target = ids.get(r.target);
      if (!source || !target) return;
      const dashed = ['Association', 'Influence', 'Realization'].includes(r.type);
      const style = 'edgeStyle=orthogonalEdgeStyle;rounded=0;html=0;strokeColor=#56647A;strokeWidth=1.5;' +
        (dashed ? 'dashed=1;' : '') + 'endArrow=' + (r.isDirected === false ? 'none' : 'block') +
        ';endFill=1;labelBackgroundColor=#FFFFFF;fontSize=10;';
      cells.push(anchoredEdge('rel-' + index + '-' + i, r.name || r.type, source, target, style));
    });
    pages.push(page('solar-archimate-' + index, view.name, layout.width + 20, layout.height + 40, cells));
  }
  return document(pages);
}
const SEQ_STYLE = 'rounded=1;whiteSpace=wrap;html=0;align=center;verticalAlign=middle;strokeColor=#69778A;fillColor=#E7EDF7;fontColor=#15243B;fontSize=12;';
/** Sequence participants/lifelines, messages, notes, and frames remain editable mxGraph cells. */
export function toDrawioSequence(diagram: SequenceDiagram): string {
  const xs = new Map(diagram.participants.map((p, i) => [p.id, 120 + i * 225]));
  const width = Math.max(490, 240 + (diagram.participants.length - 1) * 225);
  const position = (id: string) => xs.get(id)!;
  const left = position(diagram.participants[0]!.id) - 82;
  const right = position(diagram.participants[diagram.participants.length - 1]!.id) + 82;
  let y = 142, counter = 0, frameIndex = 0;
  const body: string[] = [], frames: string[] = [];
  const stack: Array<{ kind: string; label: string; start: number; index: number }> = [];
  diagram.steps.forEach((step, i) => {
    const id = 'step-' + i;
    switch (step.type) {
      case 'message': {
        counter++;
        const label = (diagram.autonumber ? String(counter) + '. ' : '') + step.text;
        const x1 = position(step.from), x2 = position(step.to);
        const style = 'endArrow=' + (step.style === 'async' ? 'open' : 'block') +
          ';endFill=' + (step.style === 'reply' ? '0' : '1') +
          ';' + (step.style === 'reply' ? 'dashed=1;' : '') +
          'strokeWidth=1.5;strokeColor=#40536B;html=0;labelBackgroundColor=#FFFFFF;fontSize=12;';
        if (x1 === x2) {
          body.push(vertex(id + '-self', label, x1 + 14, y, 140, 32, SEQ_STYLE));
          body.push(freeEdge(id, '', x1, y + 16, x1 + 14, y + 16, style));
        } else body.push(freeEdge(id, label, x1, y, x2, y, style));
        if (step.activate) body.push(vertex(id + '-active', '', x2 - 5, y + 2, 10, 34,
          'rounded=0;strokeColor=#5B76A1;fillColor=#BDD4F4;'));
        y += 68;
        break;
      }
      case 'note': {
        const coords = step.over.map(position);
        const minX = Math.min(...coords), maxX = Math.max(...coords);
        body.push(vertex(id, step.text, minX - 78, y, maxX - minX + 156, 55,
          'shape=note;whiteSpace=wrap;html=0;strokeColor=#BEA446;fillColor=#FFF5C8;fontColor=#3F3724;fontSize=12;'));
        y += 74;
        break;
      }
      case 'divider':
        body.push(vertex(id, step.text, left, y, right - left, 30,
          'text;html=0;align=center;fontStyle=1;strokeColor=#B2BCCA;fillColor=#F2F5FA;'));
        y += 48;
        break;
      case 'fragment_start':
        stack.push({ kind: step.kind, label: step.label, start: y, index: frameIndex++ });
        y += 43;
        break;
      case 'fragment_else':
        body.push(vertex(id, (stack.at(-1)?.kind === 'par' ? 'and' : 'else') +
          (step.label ? ' ' + step.label : ''), left + 4, y, right - left - 8, 29,
          'text;html=0;align=left;spacingLeft=10;strokeColor=#9BA8BC;dashed=1;fillColor=#F7F9FD;'));
        y += 38;
        break;
      case 'fragment_end': {
        const frame = stack.pop();
        if (frame) frames.push(vertex('frame-' + frame.index,
          frame.kind + (frame.label ? ' ' + frame.label : ''),
          left, frame.start, right - left, Math.max(60, y - frame.start + 13),
          'swimlane;html=0;startSize=27;horizontal=1;rounded=0;strokeColor=#6F84A5;fillColor=#F4F7FC;fillOpacity=15;fontStyle=1;align=left;spacingLeft=9;'));
        y += 22;
        break;
      }
    }
  });
  const height = Math.max(350, y + 55);
  const cells = [vertex('seq-title', diagram.title, 35, 15, width - 70, 48,
    'text;html=0;fontSize=20;fontStyle=1;align=left;strokeColor=none;fillColor=none;'), ...frames];
  diagram.participants.forEach((p, i) => {
    const x = position(p.id);
    cells.push(vertex('participant-' + i, p.label, x - 83, 78, 166, 48, SEQ_STYLE));
    cells.push(freeEdge('lifeline-' + i, '', x, 126, x, height - 28,
      'dashed=1;dashPattern=5 5;strokeColor=#9BA8BC;endArrow=none;'));
  });
  return document([page('solar-sequence', diagram.title, width, height, [...cells, ...body])]);
}
