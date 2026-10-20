import { describe, expect, it } from 'vitest';
import { buildSequence, SequenceDiagramSchema } from '../src/generators/sequence/index.js';
import { computeSequenceColumns } from '../src/generators/sequence/layout.js';

const complex = {
  title: 'Order request with long labels and several alternative validation paths',
  autonumber: true,
  participants: [
    { id: 'A', label: 'Customer Browser Application with an Extended Display Name' },
    { id: 'B', label: 'Order Gateway and Integration Service' },
    { id: 'C', label: 'Order Storage and Integration Database' },
  ],
  steps: [
    { type: 'fragment_start', kind: 'alt', label: 'Customer cart validates successfully and the order can be processed without a manual approval from another service' },
    { type: 'message', from: 'A', to: 'A', text: 'Validate all line items in the customer cart, re-read the discounted total, and calculate the final amount again', activate: true },
    { type: 'note', over: ['A'], text: 'Keep the response consistent when the same validation operation is repeated with a very long customer session identifier and discounts.' },
    { type: 'message', from: 'A', to: 'B', text: 'POST /orders with a complete request including idempotency, discount, delivery, and nested tax detail', deactivate: true },
    { type: 'fragment_else', label: 'Approval is still pending because downstream validation reports an unusual cart or item quantity' },
    { type: 'fragment_start', kind: 'loop', label: 'Wait until downstream approval is confirmed or the retry budget is exhausted by several consecutive attempts' },
    { type: 'message', from: 'B', to: 'C', text: 'Reserve new order with a unique transaction key and return the generated identifier', style: 'async' },
    { type: 'message', from: 'C', to: 'B', text: 'Transaction reservation acknowledged', style: 'reply' },
    { type: 'fragment_end' },
    { type: 'fragment_end' },
  ],
};

function cellRect(xml: string, id: string): { x: number; y: number; w: number; h: number } {
  const match = xml.match(new RegExp('<mxCell id="' + id + '"[^>]*><mxGeometry x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"'));
  expect(match, 'missing diagram vertex ' + id).not.toBeNull();
  return { x: Number(match![1]), y: Number(match![2]), w: Number(match![3]), h: Number(match![4]) };
}

describe('Sequence adaptive layout — phase B', () => {
  it('shares non-overlapping adaptive participant positions across SVG and editable draw.io XML', () => {
    const parsed = SequenceDiagramSchema.parse(complex);
    const cols = computeSequenceColumns(parsed);
    expect(cols).toHaveLength(3);
    for (let i = 1; i < cols.length; i++) {
      expect(cols[i]!.x - cols[i]!.w / 2).toBeGreaterThan(cols[i - 1]!.x + cols[i - 1]!.w / 2 + 20);
    }
    // A long self message needs more horizontal space than the old hard-coded 225px.
    expect(cols[1]!.x - cols[0]!.x).toBeGreaterThan(225);

    const result = buildSequence(complex);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { drawio, svg, mermaid, plantuml } = result.output;
    const a = cellRect(drawio, 'participant-0'), b = cellRect(drawio, 'participant-1');
    expect(a.x + a.w).toBeLessThan(b.x);
    expect(Math.abs(a.x + a.w / 2 - cols[0]!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.x + b.w / 2 - cols[1]!.x)).toBeLessThanOrEqual(1);
    expect(svg).toContain('class="message-label-bg"');
    expect(mermaid).toContain('sequenceDiagram');
    expect(plantuml).toContain('@startuml');
  });

  it('keeps self-messages editable as complete orthogonal loops, with growing note and fragment heights', () => {
    const result = buildSequence(complex);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const xml = result.output.drawio;
    expect(xml).toContain('id="step-1-label"');
    expect(xml).toContain('id="step-1-bend"');
    expect(xml).toContain('id="step-1-return"');
    expect(xml).toContain('id="activation-A-0"');
    expect(xml).toContain('id="frame-0"');
    expect(xml).toContain('id="frame-1"');
    expect(xml).toContain('id="step-4-branch"');
    const note = cellRect(xml, 'step-2');
    expect(note.h).toBeGreaterThan(55);
    const frame = cellRect(xml, 'frame-0');
    expect(frame.h).toBeGreaterThan(150);
    expect(xml).toContain('whiteSpace=wrap');
    expect(xml).not.toContain('<image');
  });

  it('maintains valid XML escaping with special characters in message and participant text', () => {
    const input = {
      ...complex,
      participants: [{ id: 'A', label: 'Client & <browser>' }, ...complex.participants.slice(1)],
      steps: [
        { type: 'message', from: 'A', to: 'B', text: 'Submit <JSON> & "quoted" request' },
      ],
    };
    const result = buildSequence(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.drawio).toContain('Client &amp; &lt;browser&gt;');
    expect(result.output.drawio).toContain('Submit &lt;JSON&gt; &amp; &quot;quoted&quot; request');
    expect(result.output.drawio).not.toContain('<JSON>');
  });
});
