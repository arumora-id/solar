import { describe, expect, it } from 'vitest';
import { buildSequence, SequenceDiagramSchema } from '../src/generators/sequence/index.js';
import { computeSequenceTimeline } from '../src/generators/sequence/timeline.js';
import { sampleSequence } from './fixtures.js';

const input = {
  title: 'Message and activation parity',
  participants: sampleSequence.participants,
  steps: [
    { type: 'message', from: 'Web', to: 'Web', text: 'Check customer session', activate: true },
    { type: 'fragment_start', kind: 'alt', label: 'Successful request' },
    { type: 'message', from: 'Web', to: 'OrderSvc', text: 'POST order', deactivate: true, activate: true },
    { type: 'note', over: ['OrderSvc'], text: 'Processing a validated order with customer discounts.' },
    { type: 'fragment_else', label: 'Fallback' },
    { type: 'message', from: 'OrderSvc', to: 'Web', text: 'Reply with order status', style: 'reply', deactivate: true },
    { type: 'fragment_end' },
  ],
};

type Rect = { x: number; y: number; w: number; h: number };
const nums = (m: RegExpMatchArray) => m.slice(1).map(Number);
function vertex(xml: string, id: string): Rect {
  const match = xml.match(new RegExp('<mxCell id="' + id + '"[^>]*><mxGeometry x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"'));
  expect(match, 'mxGraph cell missing: ' + id).not.toBeNull();
  const [x, y, w, h] = nums(match!);
  return { x: x!, y: y!, w: w!, h: h! };
}
function point(xml: string, id: string, kind: 'sourcePoint' | 'targetPoint'): { x: number; y: number } {
  const body = xml.match(new RegExp('<mxCell id="' + id + '"[^>]*>([\\s\\S]*?)</mxCell>'));
  expect(body, 'mxGraph edge missing: ' + id).not.toBeNull();
  const match = body![1]!.match(new RegExp('<mxPoint x="([^"]+)" y="([^"]+)" as="' + kind + '"'));
  expect(match, kind + ' missing: ' + id).not.toBeNull();
  return { x: Number(match![1]), y: Number(match![2]) };
}
function annotatedRect(svg: string, attr: string, value: string): Rect {
  const match = svg.match(new RegExp('<rect ' + attr + '="' + value + '" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"'));
  expect(match, 'SVG shape missing: ' + attr + '=' + value).not.toBeNull();
  const [x, y, w, h] = nums(match!);
  return { x: x!, y: y!, w: w!, h: h! };
}

describe('Sequence SVG and draw.io precise shared geometry — C2', () => {
  it('matches loop legs, activation bar, participant lifeline and nested branch frame', () => {
    const diagram = SequenceDiagramSchema.parse(input);
    const timeline = computeSequenceTimeline(diagram);
    const result = buildSequence(diagram);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { svg, drawio } = result.output;
    const self = timeline.steps[0]!;
    const selfPath = svg.match(/<path data-step="0" d="M([0-9.]+) ([0-9.]+)H([0-9.]+)V([0-9.]+)H([0-9.]+)"/);
    expect(selfPath).not.toBeNull();
    const [x1, y1, bendX, returnY, x2] = nums(selfPath!);
    expect(y1).toBe(self.arrowY);
    expect(returnY).toBe(self.arrowY! + 22);
    expect(point(drawio, 'step-0', 'sourcePoint')).toEqual({ x: Math.round(x1!), y: y1 });
    expect(point(drawio, 'step-0', 'targetPoint')).toEqual({ x: Math.round(bendX!), y: y1 });
    expect(point(drawio, 'step-0-bend', 'targetPoint')).toEqual({ x: Math.round(bendX!), y: returnY });
    expect(point(drawio, 'step-0-return', 'sourcePoint')).toEqual({ x: Math.round(bendX!), y: returnY });
    expect(point(drawio, 'step-0-return', 'targetPoint')).toEqual({ x: Math.round(x2!), y: returnY });

    for (const id of ['Web', 'OrderSvc']) {
      const expected = annotatedRect(svg, 'data-activation', id);
      const actual = vertex(drawio, 'activation-' + id + '-' + (id === 'Web' ? '0' : '1'));
      expect(actual).toEqual({ x: Math.round(expected.x), y: Math.round(expected.y), w: Math.round(expected.w), h: Math.round(expected.h) });
    }
    const frame = annotatedRect(svg, 'data-fragment-index', '0');
    const xmlFrame = vertex(drawio, 'frame-0');
    // Editors may extend combined fragments horizontally, but their timeline spans must match.
    expect(xmlFrame.y).toBe(Math.round(frame.y));
    expect(xmlFrame.h).toBe(Math.round(frame.h));
    const note = timeline.steps[3]!;
    const svgNote = svg.match(/<path data-note-step="3" d="M([0-9.]+) ([0-9.]+)H/);
    expect(svgNote).not.toBeNull();
    expect(Number(svgNote![1])).toBeCloseTo(note.note!.x);
    expect(Number(svgNote![2])).toBe(note.top);
    const xmlNote = vertex(drawio, 'step-3');
    expect(xmlNote.y).toBe(note.top);
    expect(xmlNote.h).toBe(note.note!.height);

    const columns = timeline.columns;
    const footTop = timeline.endY + 16;
    const svgLifeline = '<path d="M' + (Math.round(columns[0]!.x * 10) / 10) + ' ' +
      (timeline.headTop + timeline.headHeight) + 'V' + footTop + '"';
    expect(svg).toContain(svgLifeline);
    expect(point(drawio, 'lifeline-0', 'targetPoint').y).toBe(footTop);
  });

  it('matches message endpoints after activating/deactivating participant bars', () => {
    const result = buildSequence(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { svg, drawio } = result.output;
    for (const index of [2, 5]) {
      const match = svg.match(new RegExp('<path data-step="' + index + '" d="M([0-9.]+) ([0-9.]+)H([0-9.]+)"'));
      expect(match).not.toBeNull();
      const [fromX, y, toX] = nums(match!);
      expect(point(drawio, 'step-' + index, 'sourcePoint')).toEqual({ x: Math.round(fromX!), y });
      expect(point(drawio, 'step-' + index, 'targetPoint')).toEqual({ x: Math.round(toX!), y });
    }
  });
});
