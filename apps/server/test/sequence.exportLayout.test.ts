import { describe, expect, it } from 'vitest';
import { buildSequence, SequenceDiagramSchema } from '../src/generators/sequence/index.js';
import { computeSequenceTimeline } from '../src/generators/sequence/timeline.js';
import { sampleSequence } from './fixtures.js';

function rectangle(xml: string, id: string) {
  const m = xml.match(new RegExp('<mxCell id="' + id + '"[^>]*><mxGeometry x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"'));
  expect(m, 'missing native mxGraph vertex ' + id).not.toBeNull();
  return { x: Number(m![1]), y: Number(m![2]), w: Number(m![3]), h: Number(m![4]) };
}
function edgeSourceY(xml: string, id: string): number {
  const edge = xml.match(new RegExp('<mxCell id="' + id + '"[^>]*>([\\s\\S]*?)</mxCell>'));
  expect(edge, 'missing native mxGraph edge ' + id).not.toBeNull();
  const p = edge![1].match(/<mxPoint x="[^"]+" y="([^"]+)" as="sourcePoint"/);
  expect(p).not.toBeNull();
  return Number(p![1]);
}

describe('Sequence SVG and editable XML use identical timeline coordinates — phase C', () => {
  it('aligns participants, message arrows, notes and fragment boundaries including a self message', () => {
    const input = {
      ...sampleSequence,
      description: 'A validation and order-routing sequence that demonstrates shared layout positioning.',
      steps: [
        ...sampleSequence.steps.slice(0, 1),
        { type: 'message', from: 'Web', to: 'Web', text: 'Validate user session details, confirm tax rules and check cart discounts again' },
        ...sampleSequence.steps.slice(1),
      ],
    };
    const diagram = SequenceDiagramSchema.parse(input);
    const timeline = computeSequenceTimeline(diagram);
    const res = buildSequence(diagram);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { svg, drawio } = res.output;
    expect(timeline.descriptionLines.length).toBeGreaterThan(0);
    expect(drawio).toContain('seq-description-0');
    const first = rectangle(drawio, 'participant-0');
    expect(first.y).toBe(Math.round(timeline.headTop));
    expect(first.h).toBe(Math.round(timeline.headHeight));
    for (const [i, placement] of timeline.steps.entries()) {
      if (placement.step.type === 'message') {
        expect(edgeSourceY(drawio, 'step-' + i)).toBe(Math.round(placement.arrowY!));
        expect(svg).toMatch(new RegExp('M[0-9.]+ ' + placement.arrowY! + 'H[0-9.]+'));
        const label = rectangle(drawio, 'step-' + i + '-label');
        expect(label.y).toBe(Math.round(placement.top));
        // The arrow must stay beneath the label background.
        expect(label.y + label.h).toBeLessThan(placement.arrowY!);
      }
      if (placement.step.type === 'note') {
        const note = rectangle(drawio, 'step-' + i);
        expect(note.y).toBe(Math.round(placement.top));
        expect(note.h).toBe(Math.round(placement.note!.height));
      }
    }
    // The self-loop is still three editable segments.
    expect(drawio).toContain('id="step-1-bend"');
    expect(drawio).toContain('id="step-1-return"');
    expect(svg).toContain('class="message-label-bg"');
    expect(drawio).toContain('id="frame-0"');
  });

  it('is deterministic and does not change Mermaid / PlantUML source', () => {
    const input = SequenceDiagramSchema.parse(sampleSequence);
    const a = buildSequence(input), b = buildSequence(input);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.output.svg).toBe(b.output.svg);
    expect(a.output.drawio).toBe(b.output.drawio);
    expect(a.output.mermaid).toBe(b.output.mermaid);
    expect(a.output.plantuml).toBe(b.output.plantuml);
  });
});
