import { textWidth, wrapText } from '../validation.js';
import { computeSequenceColumns, type SequenceColumn } from './layout.js';
import type { SequenceDiagram, Step } from './model.js';

/**
 * Shared vertical timeline and participant positions for SVG and draw.io.
 * Renderers are free to choose styling, but must not independently change
 * the coordinates of messages, notes or combined-fragment boundaries.
 */
export interface PlannedStep {
  step: Step;
  top: number;
  bottom: number;
  arrowY?: number;
  messageLines?: string[];
  note?: { x: number; width: number; height: number; lines: string[] };
}
export interface SequenceTimeline {
  columns: SequenceColumn[];
  descriptionLines: string[];
  headTop: number;
  headHeight: number;
  startY: number;
  endY: number;
  steps: PlannedStep[];
}
export function computeSequenceTimeline(diagram: SequenceDiagram): SequenceTimeline {
  const columns = computeSequenceColumns(diagram);
  const centers = new Map(columns.map((c) => [c.p.id, c.x]));
  const maxX = Math.max(...columns.map((c) => c.x + c.w / 2));
  const descriptionLines = diagram.description
    ? wrapText(diagram.description, Math.max(400, maxX - 24), 11.5, 3) : [];
  const headHeight = 48 + (Math.max(...columns.map((c) => c.lines.length)) - 1) * 15;
  const headTop = 62 + descriptionLines.length * 15;
  const startY = headTop + headHeight + 26;
  const steps: PlannedStep[] = [];
  let y = startY;
  for (const step of diagram.steps) {
    const placement: PlannedStep = { step, top: y, bottom: y };
    switch (step.type) {
      case 'message': {
        const lines = wrapText(step.text, 260, 12);
        placement.messageLines = lines;
        if (step.from === step.to) {
          // The self-message arrow must sit BELOW every label line and its white background.
          placement.arrowY = y + Math.max(18, lines.length * 15 + 9);
          placement.bottom = placement.arrowY + 22 + 18;
        } else {
          placement.arrowY = y + lines.length * 15 + 4;
          placement.bottom = placement.arrowY + 22;
        }
        break;
      }
      case 'note': {
        const xs = step.over.map((id) => centers.get(id)!);
        const span = step.over.length === 2;
        const width = span
          ? Math.max(Math.abs(xs[1]! - xs[0]!) + 60, Math.min(200, textWidth(step.text, 11.5)) + 24)
          : Math.min(200, textWidth(step.text, 11.5)) + 24;
        const lines = wrapText(step.text, width - 20, 11.5);
        const height = lines.length * 15 + 12;
        const cx = span ? (xs[0]! + xs[1]!) / 2 : xs[0]!;
        placement.note = { x: cx - width / 2, width, height, lines };
        placement.bottom = y + height + 16;
        break;
      }
      case 'divider':
        placement.bottom = y + 40;
        break;
      case 'fragment_start':
        placement.bottom = y + Math.max(34, wrapText(step.label, 260, 11.5).length * 15 + 18);
        break;
      case 'fragment_else':
        placement.bottom = y + Math.max(30, wrapText(step.label, 260, 11.5).length * 15 + 18);
        break;
      case 'fragment_end':
        placement.bottom = y + 18;
        break;
    }
    y = placement.bottom;
    steps.push(placement);
  }
  return { columns, descriptionLines, headTop, headHeight, startY, endY: y, steps };
}
