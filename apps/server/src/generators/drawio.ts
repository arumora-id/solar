import type { NormalizedArchimateModel } from './archimate/model.js';
import type { ViewLayout } from './archimate/layout.js';
import { ELEMENT_INFO, isJunction } from './archimate/metamodel.js';
import type { SequenceDiagram } from './sequence/model.js';
import { escapeXml, textWidth, wrapText } from './validation.js';
import { computeSequenceColumns } from './sequence/layout.js';

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
  const cols = computeSequenceColumns(diagram);
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
  const headH = 48 + 15 * (Math.max(...cols.map((c) => c.lines.length)) - 1);
  const headTop = 78;
  let y = headTop + headH + 24, counter = 0, frameIndex = 0;
  const body: string[] = [], frames: string[] = [], activations: string[] = [];
  const stack: Array<{ kind: string; label: string; start: number; index: number }> = [];
  const active = new Map<string, number[]>();
  const activationX = (id: string, depth: number) => position(id) + (depth - 1) * 5 - 5;
  const closeActivation = (id: string, at: number) => {
    const values = active.get(id);
    if (!values?.length) return; // semantic validation remains in validateSequence
    const from = values.pop()!;
    activations.push(vertex('activation-' + id + '-' + activations.length, '',
      activationX(id, values.length + 1), from, 10, Math.max(8, at - from),
      'rounded=0;strokeColor=#5B76A1;fillColor=#BDD4F4;'));
  };
  diagram.steps.forEach((step, i) => {
    const id = 'step-' + i;
    switch (step.type) {
      case 'message': {
        counter++;
        const lines = labelLines(step.text);
        const label = (diagram.autonumber ? String(counter) + '. ' : '') + step.text;
        const labelH = lines.length * 17 + 12;
        const labelW = labelWidth(label);
        const x1 = position(step.from), x2 = position(step.to);
        const color = step.style === 'reply' ? 'dashed=1;' : '';
        const arrow = step.style === 'async' ? 'open' : 'block';
        const style = 'endArrow=' + arrow + ';endFill=' + (step.style === 'reply' ? '0' : '1') + ';' +
          color + 'strokeWidth=1.5;strokeColor=#40536B;html=0;';
        const labelStyle = 'text;html=0;whiteSpace=wrap;overflow=hidden;align=center;verticalAlign=middle;rounded=1;strokeColor=none;fillColor=#FFFFFF;fontColor=#15243B;fontSize=12;';
        const arrowY = y + labelH + 3;
        if (x1 === x2) {
          body.push(vertex(id + '-label', label, x1 + 41, y, labelW, labelH, labelStyle));
          // A real three-sided loop; the legacy single short segment was not a self-message.
          body.push(freeEdge(id, '', x1, arrowY, x1 + 42, arrowY,
            'endArrow=none;strokeColor=#40536B;' + color));
          body.push(freeEdge(id + '-bend', '', x1 + 42, arrowY, x1 + 42, arrowY + 26,
            'endArrow=none;strokeColor=#40536B;' + color));
          body.push(freeEdge(id + '-return', '', x1 + 42, arrowY + 26, x1, arrowY + 26, style));
          if (step.deactivate) closeActivation(step.from, arrowY + 26);
          if (step.activate) active.set(step.to, [...(active.get(step.to) ?? []), arrowY + 26]);
          y = arrowY + 58;
        } else {
          body.push(vertex(id + '-label', label, (x1 + x2 - labelW) / 2, y, labelW, labelH, labelStyle));
          body.push(freeEdge(id, '', x1, arrowY, x2, arrowY, style));
          if (step.deactivate) closeActivation(step.from, arrowY);
          if (step.activate) active.set(step.to, [...(active.get(step.to) ?? []), arrowY]);
          y = arrowY + 35;
        }
        break;
      }
      case 'note': {
        const coords = step.over.map(position);
        const minX = Math.min(...coords), maxX = Math.max(...coords);
        const noteW = step.over.length > 1 ? maxX - minX + 156 : 214;
        const lines = wrapText(step.text, Math.max(130, noteW - 24), 12);
        const noteH = Math.max(55, lines.length * 17 + 19);
        const noteX = step.over.length > 1 ? minX - 78 : minX - noteW / 2;
        body.push(vertex(id, step.text, Math.max(5, noteX), y, noteW, noteH,
          'shape=note;whiteSpace=wrap;html=0;overflow=hidden;strokeColor=#BEA446;fillColor=#FFF5C8;fontColor=#3F3724;fontSize=12;'));
        y += noteH + 21;
        break;
      }
      case 'divider':
        body.push(vertex(id, step.text, left, y, right - left, 32,
          'text;html=0;whiteSpace=wrap;align=center;fontStyle=1;strokeColor=#B2BCCA;fillColor=#F2F5FA;'));
        y += 51;
        break;
      case 'fragment_start': {
        stack.push({ kind: step.kind, label: step.label, start: y, index: frameIndex++ });
        y += Math.max(47, wrapText(step.label, 260, 12).length * 18 + 26);
        break;
      }
      case 'fragment_else': {
        const branch = (stack.at(-1)?.kind === 'par' ? 'and' : 'else') +
          (step.label ? ' ' + step.label : '');
        const branchH = Math.max(31, wrapText(branch, 260, 12).length * 17 + 17);
        body.push(vertex(id + '-branch', branch, left + 5, y, right - left - 10, branchH,
          'text;html=0;whiteSpace=wrap;align=left;verticalAlign=middle;spacingLeft=10;strokeColor=#9BA8BC;dashed=1;fillColor=#F7F9FD;'));
        y += branchH + 12;
        break;
      }
      case 'fragment_end': {
        const frame = stack.pop();
        if (frame) frames.push(vertex('frame-' + frame.index,
          frame.kind + (frame.label ? ' ' + frame.label : ''),
          left, frame.start, right - left, Math.max(65, y - frame.start + 17),
          'swimlane;html=0;whiteSpace=wrap;startSize=35;horizontal=1;rounded=0;strokeColor=#6F84A5;fillColor=#F4F7FC;fillOpacity=15;fontStyle=1;align=left;spacingLeft=10;'));
        y += 24;
        break;
      }
    }
  });
  const height = Math.max(350, y + 64);
  for (const [id, values] of active) while (values.length) closeActivation(id, height - 44);
  const cells = [
    vertex('seq-title', diagram.title, 34, 16, width - 68, 47,
      'text;html=0;whiteSpace=wrap;fontSize=20;fontStyle=1;align=left;strokeColor=none;fillColor=none;'),
    ...frames,
  ];
  cols.forEach((c, i) => {
    cells.push(vertex('participant-' + i, c.p.label, c.x - c.w / 2, headTop, c.w, headH, SEQ_STYLE));
    cells.push(freeEdge('lifeline-' + i, '', c.x, headTop + headH, c.x, height - 28,
      'dashed=1;dashPattern=5 5;strokeColor=#9BA8BC;endArrow=none;'));
  });
  cells.push(...activations, ...body);
  return document([page('solar-sequence', diagram.title, width, height, cells)]);
}
