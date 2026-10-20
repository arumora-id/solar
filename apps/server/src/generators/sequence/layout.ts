import { textWidth, wrapText } from '../validation.js';
import type { Participant, SequenceDiagram } from './model.js';

// Phase B: one adaptive participant/label spacing plan shared by SVG and draw.io.
const MARGIN = 24;
const HEAD_LABEL_W = 200;
const HEAD_FONT = 12.5;
const MSG_FONT = 12;
const MAX_MSG_W = 260;
const NOTE_W = 200;

export interface SequenceColumn {
  p: Participant;
  x: number;
  w: number;
  /** Participant label wrapped to the head box (max 3 lines). */
  lines: string[];
}

function headLines(p: Participant): string[] {
  return wrapText(p.label, HEAD_LABEL_W - 16, HEAD_FONT, 3);
}

function headWidth(p: Participant): number {
  const widest = Math.max(...headLines(p).map((l) => textWidth(l, HEAD_FONT)));
  return Math.max(96, Math.min(HEAD_LABEL_W, widest + 28));
}

/** Column centres: minimum spacing, then widened until every message / note label fits. */
export function computeSequenceColumns(d: SequenceDiagram): SequenceColumn[] {
  const index = new Map(d.participants.map((p, i) => [p.id, i]));
  const widths = d.participants.map(headWidth);
  const xs: number[] = [];
  let x = MARGIN + 40 + widths[0]! / 2;
  widths.forEach((w, i) => {
    if (i > 0) x += widths[i - 1]! / 2 + w / 2 + 36;
    xs.push(x);
  });

  const constraints: Array<{ a: number; b: number; need: number }> = [];
  for (const step of d.steps) {
    if (step.type === 'message') {
      const a = index.get(step.from)!;
      const b = index.get(step.to)!;
      const label = wrapText(step.text, MAX_MSG_W, MSG_FONT);
      const w = Math.max(...label.map((line) => textWidth(line, MSG_FONT))) + 44;
      if (a === b) {
        if (a < xs.length - 1) {
          // The loop label is to the RIGHT of its own lifeline; reserve room
          // before the next participant (also when this lifeline is activated).
          constraints.push({ a, b: a + 1, need: 46 + (w - 44) + widths[a + 1]! / 2 + 38 });
        }
      } else constraints.push({ a: Math.min(a, b), b: Math.max(a, b), need: w });
    } else if (step.type === 'note') {
      const ids = step.over.map((o) => index.get(o)!);
      const a = Math.min(...ids);
      const b = Math.max(...ids);
      const w = Math.min(NOTE_W, Math.max(...wrapText(step.text, NOTE_W - 20, 11.5).map((line) => textWidth(line, 11.5))) + 24);
      if (a === b) {
        if (a > 0) constraints.push({ a: a - 1, b: a, need: w / 2 + widths[a - 1]! / 2 + 12 });
        if (a < xs.length - 1) constraints.push({ a, b: a + 1, need: w / 2 + widths[a + 1]! / 2 + 12 });
      } else constraints.push({ a, b, need: Math.min(w, 420) - 40 });
    }
  }
  // notes over the first participant must not leave the canvas on the left
  let leftNeed = 0;
  for (const step of d.steps) {
    if (step.type !== 'note' || step.over.length !== 1 || index.get(step.over[0]!) !== 0) continue;
    leftNeed = Math.max(leftNeed, (Math.min(NOTE_W, textWidth(step.text, 11.5)) + 24) / 2);
  }
  if (xs[0]! - leftNeed < MARGIN) {
    const shift = MARGIN - (xs[0]! - leftNeed);
    for (let i = 0; i < xs.length; i++) xs[i]! += shift;
  }
  constraints.sort((p, q) => p.b - p.a - (q.b - q.a));
  for (let pass = 0; pass < 3; pass++) {
    for (const c of constraints) {
      const gap = xs[c.b]! - xs[c.a]!;
      if (gap < c.need) {
        const shift = c.need - gap;
        for (let i = c.b; i < xs.length; i++) xs[i]! += shift;
      }
    }
  }
  return d.participants.map((p, i) => ({ p, x: xs[i]!, w: widths[i]!, lines: headLines(p) }));
}

