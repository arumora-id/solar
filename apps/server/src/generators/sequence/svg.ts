import { escapeXml, textWidth, wrapText } from '../validation.js';
import type { FragmentKind, Participant, SequenceDiagram } from './model.js';

const FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const INK = '#24292f';
const LINE = '#57606a';
const MARGIN = 24;
const HEAD_H = 48;
const MSG_FONT = 12;
const MAX_MSG_W = 260;
const NOTE_W = 200;
const ACT_W = 10;
const HEAD_LABEL_W = 200;
const HEAD_FONT = 12.5;
const LINE_H = 15;

const f = (n: number) => Math.round(n * 10) / 10;

interface Column {
  p: Participant;
  x: number;
  w: number;
  /** Participant label wrapped to the head box (max 3 lines). */
  lines: string[];
}

interface FragmentBox {
  kind: FragmentKind;
  label: string;
  y0: number;
  y1: number;
  x0: number;
  x1: number;
  elses: Array<{ y: number; label: string }>;
  depth: number;
}

function headLines(p: Participant): string[] {
  return wrapText(p.label, HEAD_LABEL_W - 16, HEAD_FONT, 3);
}

function headWidth(p: Participant): number {
  const widest = Math.max(...headLines(p).map((l) => textWidth(l, HEAD_FONT)));
  return Math.max(96, Math.min(HEAD_LABEL_W, widest + 28));
}

/** Column centres: minimum spacing, then widened until every message / note label fits. */
function computeColumns(d: SequenceDiagram): Column[] {
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
      const w = Math.min(MAX_MSG_W, textWidth(step.text, MSG_FONT)) + 44;
      if (a === b) {
        if (a < xs.length - 1) constraints.push({ a, b: a + 1, need: w + 30 });
      } else constraints.push({ a: Math.min(a, b), b: Math.max(a, b), need: w });
    } else if (step.type === 'note') {
      const ids = step.over.map((o) => index.get(o)!);
      const a = Math.min(...ids);
      const b = Math.max(...ids);
      const w = Math.min(NOTE_W, textWidth(step.text, 11.5)) + 24;
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

/** `headH` grows with the longest wrapped participant label so every head has the same height. */
function participantHead(c: Column, y: number, headH: number): string {
  const { p, x, w, lines } = c;
  // icon heads put the label below the icon (first line at `ty`); box heads centre it around `ty`
  const label = (ty: number, centred: boolean) => {
    const first = centred ? ty - ((lines.length - 1) * LINE_H) / 2 : ty;
    return lines
      .map((l, i) => `<text x="${f(x)}" y="${f(first + i * LINE_H)}" text-anchor="middle" font-size="${HEAD_FONT}" font-weight="600" fill="${INK}">${escapeXml(l)}</text>`)
      .join('');
  };
  const text = (ty: number) => label(ty, false);
  const boxText = (ty: number) => label(ty, true);
  const stroke = `stroke="${LINE}" stroke-width="1.2"`;
  switch (p.kind) {
    case 'actor':
      return (
        `<g fill="none" ${stroke}><circle cx="${f(x)}" cy="${y + 7}" r="6"/><path d="M${f(x)} ${y + 13}V${y + 26}M${f(x - 10)} ${y + 18}H${f(x + 10)}M${f(x)} ${y + 26}L${f(x - 8)} ${y + 35}M${f(x)} ${y + 26}L${f(x + 8)} ${y + 35}"/></g>` +
        text(y + 47)
      );
    case 'database':
      return (
        `<path d="M${f(x - w / 2)} ${y + 8}V${y + headH - 8}A${w / 2} 8 0 0 0 ${f(x + w / 2)} ${y + headH - 8}V${y + 8}" fill="#f6f8fa" ${stroke}/>` +
        `<ellipse cx="${f(x)}" cy="${y + 8}" rx="${f(w / 2)}" ry="8" fill="#f6f8fa" ${stroke}/>` +
        boxText(y + headH / 2 + 8)
      );
    case 'queue':
      return (
        `<path d="M${f(x - w / 2 + 8)} ${y + 6}H${f(x + w / 2 - 8)}A8 ${(headH - 12) / 2} 0 0 1 ${f(x + w / 2 - 8)} ${y + headH - 6}H${f(x - w / 2 + 8)}A8 ${(headH - 12) / 2} 0 0 1 ${f(x - w / 2 + 8)} ${y + 6}Z" fill="#f6f8fa" ${stroke}/>` +
        `<ellipse cx="${f(x + w / 2 - 8)}" cy="${y + headH / 2}" rx="8" ry="${(headH - 12) / 2}" fill="none" ${stroke}/>` +
        boxText(y + headH / 2 + 4)
      );
    case 'collections':
      return (
        `<rect x="${f(x - w / 2 + 6)}" y="${y + 2}" width="${f(w - 6)}" height="${headH - 10}" rx="4" fill="#f6f8fa" ${stroke}/>` +
        `<rect x="${f(x - w / 2)}" y="${y + 8}" width="${f(w - 6)}" height="${headH - 10}" rx="4" fill="#f6f8fa" ${stroke}/>` +
        boxText(y + headH / 2 + 7)
      );
    case 'boundary':
      return `<g fill="none" ${stroke}><circle cx="${f(x + 5)}" cy="${y + 14}" r="11"/><path d="M${f(x - 14)} ${y + 3}V${y + 25}M${f(x - 14)} ${y + 14}H${f(x - 6)}"/></g>${text(y + 44)}`;
    case 'control':
      return `<g fill="none" ${stroke}><circle cx="${f(x)}" cy="${y + 15}" r="11"/><path d="M${f(x + 1)} ${y + 1}L${f(x - 4)} ${y + 4}L${f(x + 1)} ${y + 8}"/></g>${text(y + 44)}`;
    case 'entity':
      return `<g fill="none" ${stroke}><circle cx="${f(x)}" cy="${y + 13}" r="11"/><path d="M${f(x - 11)} ${y + 27}H${f(x + 11)}"/></g>${text(y + 44)}`;
    case 'external':
      return `<rect x="${f(x - w / 2)}" y="${y + 6}" width="${f(w)}" height="${headH - 12}" rx="6" fill="#ffffff" stroke="${LINE}" stroke-width="1.2" stroke-dasharray="5 3"/>${boxText(y + headH / 2 + 4)}`;
    case 'participant':
    default:
      return `<rect x="${f(x - w / 2)}" y="${y + 6}" width="${f(w)}" height="${headH - 12}" rx="6" fill="#f6f8fa" stroke="${LINE}" stroke-width="1.2"/>${boxText(y + headH / 2 + 4)}`;
  }
}

const FRAGMENT_TITLE: Record<FragmentKind, string> = {
  alt: 'alt',
  opt: 'opt',
  loop: 'loop',
  par: 'par',
  critical: 'critical',
  break: 'break',
  group: 'group',
};

/** Renders a UML-style sequence diagram as a standalone SVG. */
export function toSequenceSvg(d: SequenceDiagram): string {
  const cols = computeColumns(d);
  const col = new Map(cols.map((c) => [c.p.id, c]));
  const minX = Math.min(...cols.map((c) => c.x - c.w / 2));
  const maxX = Math.max(...cols.map((c) => c.x + c.w / 2));

  const headH = HEAD_H + (Math.max(...cols.map((c) => c.lines.length)) - 1) * LINE_H;
  const descLines = d.description ? wrapText(d.description, Math.max(400, maxX - MARGIN), 11.5, 3) : [];
  const headTop = MARGIN + 30 + descLines.length * 15 + 8;
  let y = headTop + headH + 26;
  // text outside the participant columns that the canvas must still fit
  let textRight = MARGIN + textWidth(d.title, 17) * 1.08;
  for (const l of descLines) textRight = Math.max(textRight, MARGIN + textWidth(l, 11.5));
  const dividers: Array<{ y: number; text: string; tw: number }> = [];

  const body: string[] = [];
  const overlays: string[] = [];
  const fragments: FragmentBox[] = [];
  const open: Array<FragmentBox & { touched: Set<string>; extraRight: number }> = [];
  const activeStack = new Map<string, number[]>();
  const bars: Array<{ x: number; y0: number; y1: number; level: number }> = [];
  let number = 0;
  let rightmost = maxX;

  const touch = (...ids: string[]) => open.forEach((fr) => ids.forEach((id) => fr.touched.add(id)));
  const level = (id: string) => activeStack.get(id)?.length ?? 0;
  const edgeX = (id: string, towardRight: boolean) => {
    const c = col.get(id)!;
    const l = level(id);
    if (l === 0) return c.x;
    const half = ACT_W / 2 + (l - 1) * 5;
    return towardRight ? c.x + half : c.x - half;
  };

  for (const step of d.steps) {
    switch (step.type) {
      case 'message': {
        number += 1;
        touch(step.from, step.to);
        const label = wrapText(step.text, MAX_MSG_W, MSG_FONT);
        const self = step.from === step.to;
        const dashed = step.style === 'reply';
        const marker = step.style === 'sync' ? 'seq-filled' : 'seq-open';
        const fromC = col.get(step.from)!;
        const toC = col.get(step.to)!;
        if (self) {
          const x0 = edgeX(step.from, true);
          const textX = x0 + 46;
          const top = y;
          label.forEach((l, i) =>
            body.push(`<text x="${f(textX)}" y="${f(top + 12 + i * 15)}" font-size="${MSG_FONT}" fill="${INK}">${escapeXml(l)}</text>`),
          );
          const loopY = top + Math.max(8, label.length * 15 - 4);
          if (step.deactivate) closeBar(step.from, loopY + 22);
          if (step.activate) openBar(step.to, loopY + 22);
          const x1 = edgeX(step.to, true);
          body.push(
            `<path d="M${f(x0)} ${f(loopY)}H${f(x0 + 36)}V${f(loopY + 22)}H${f(x1)}" fill="none" stroke="${LINE}" stroke-width="1.3"${dashed ? ' stroke-dasharray="5 4"' : ''} marker-end="url(#${marker})"/>`,
          );
          if (d.autonumber) body.push(numberBadge(x0 + 18, loopY, number));
          rightmost = Math.max(rightmost, textX + Math.max(...label.map((l) => textWidth(l, MSG_FONT))));
          open.forEach((fr) => (fr.extraRight = Math.max(fr.extraRight, textX + Math.max(...label.map((l) => textWidth(l, MSG_FONT))) + 10)));
          y = loopY + 22 + 18;
        } else {
          const right = toC.x > fromC.x;
          const textTop = y;
          const midX = (fromC.x + toC.x) / 2;
          label.forEach((l, i) =>
            body.push(`<text x="${f(midX)}" y="${f(textTop + 12 + i * 15)}" text-anchor="middle" font-size="${MSG_FONT}" fill="${INK}">${escapeXml(l)}</text>`),
          );
          const arrowY = textTop + label.length * 15 + 4;
          const x0 = edgeX(step.from, right);
          if (step.deactivate) closeBar(step.from, arrowY);
          if (step.activate) openBar(step.to, arrowY);
          const x1 = edgeX(step.to, !right);
          body.push(
            `<path d="M${f(x0)} ${f(arrowY)}H${f(x1)}" fill="none" stroke="${LINE}" stroke-width="1.3"${dashed ? ' stroke-dasharray="5 4"' : ''} marker-end="url(#${marker})"/>`,
          );
          if (d.autonumber) body.push(numberBadge(x0 + (right ? 12 : -12), arrowY, number));
          y = arrowY + 22;
        }
        break;
      }
      case 'note': {
        touch(...step.over);
        const xs = step.over.map((id) => col.get(id)!.x);
        const span = step.over.length === 2;
        const width = span ? Math.max(Math.abs(xs[1]! - xs[0]!) + 60, Math.min(NOTE_W, textWidth(step.text, 11.5)) + 24) : Math.min(NOTE_W, textWidth(step.text, 11.5)) + 24;
        const lines = wrapText(step.text, width - 20, 11.5);
        const h = lines.length * 15 + 12;
        const cx = span ? (xs[0]! + xs[1]!) / 2 : xs[0]!;
        const x0 = cx - width / 2;
        rightmost = Math.max(rightmost, x0 + width);
        overlays.push(
          `<path d="M${f(x0)} ${f(y)}H${f(x0 + width - 10)}L${f(x0 + width)} ${f(y + 10)}V${f(y + h)}H${f(x0)}Z" fill="#fff8c5" stroke="#d4a72c" stroke-width="1"/>` +
            `<path d="M${f(x0 + width - 10)} ${f(y)}V${f(y + 10)}H${f(x0 + width)}" fill="none" stroke="#d4a72c" stroke-width="1"/>` +
            lines.map((l, i) => `<text x="${f(x0 + 10)}" y="${f(y + 18 + i * 15)}" font-size="11.5" fill="${INK}">${escapeXml(l)}</text>`).join(''),
        );
        y += h + 16;
        break;
      }
      case 'divider': {
        // drawn once the canvas width is known (see below)
        const tw = textWidth(step.text, 11.5) * 1.08 + 24;
        dividers.push({ y, text: step.text, tw });
        overlays.push(`{DIVIDER:${dividers.length - 1}}`);
        textRight = Math.max(textRight, MARGIN + tw);
        y += 40;
        break;
      }
      case 'fragment_start': {
        const box = { kind: step.kind, label: step.label, y0: y, y1: y, x0: 0, x1: 0, elses: [], depth: open.length, touched: new Set<string>(), extraRight: 0 };
        open.push(box);
        y += 34;
        break;
      }
      case 'fragment_else': {
        const top = open[open.length - 1];
        if (top) top.elses.push({ y: y + 2, label: step.label });
        y += 30;
        break;
      }
      case 'fragment_end': {
        const box = open.pop();
        if (!box) break;
        box.y1 = y + 2;
        const touchedCols = [...box.touched].map((id) => col.get(id)!).filter(Boolean);
        const xs = touchedCols.length ? touchedCols.map((c) => c.x) : cols.map((c) => c.x);
        const inner = fragments.filter((fr) => fr.depth > box.depth && fr.y0 >= box.y0 && fr.y1 <= box.y1);
        let x0 = Math.min(...xs) - 70;
        let x1 = Math.max(Math.max(...xs) + 70, box.extraRight);
        for (const fr of inner) {
          x0 = Math.min(x0, fr.x0 - 10);
          x1 = Math.max(x1, fr.x1 + 10);
        }
        const tagW = textWidth(FRAGMENT_TITLE[box.kind], 11) + 22;
        x1 = Math.max(x1, x0 + tagW + textWidth(box.label, 11.5) + 40);
        box.x0 = Math.max(6, x0);
        box.x1 = x1;
        rightmost = Math.max(rightmost, x1);
        fragments.push(box);
        y += 18;
        break;
      }
    }
  }

  function openBar(id: string, at: number) {
    const stack = activeStack.get(id) ?? [];
    stack.push(at);
    activeStack.set(id, stack);
  }
  function closeBar(id: string, at: number) {
    const stack = activeStack.get(id);
    if (!stack?.length) return;
    const lvl = stack.length;
    const start = stack.pop()!;
    bars.push({ x: col.get(id)!.x, y0: start, y1: at, level: lvl });
  }

  const lifelineEnd = y + 10;
  for (const [id, stack] of activeStack) {
    while (stack.length) closeBar(id, lifelineEnd - 4);
  }

  const width = Math.ceil(Math.max(rightmost, maxX, textRight) + MARGIN + 10);
  const footTop = lifelineEnd + 6;
  const height = footTop + headH + MARGIN;
  const midX = (minX + maxX) / 2;
  const dividerSvg = (i: number) => {
    const dv = dividers[i]!;
    // centred on the participants, but never past either canvas edge
    const cx = Math.min(Math.max(midX, MARGIN + dv.tw / 2), width - MARGIN - dv.tw / 2);
    return (
      `<path d="M${MARGIN} ${f(dv.y + 10)}H${width - MARGIN}M${MARGIN} ${f(dv.y + 14)}H${width - MARGIN}" stroke="${LINE}" stroke-width="1"/>` +
      `<rect x="${f(cx - dv.tw / 2)}" y="${f(dv.y)}" width="${f(dv.tw)}" height="24" rx="4" fill="#eaeef2" stroke="${LINE}" stroke-width="1"/>` +
      `<text x="${f(cx)}" y="${f(dv.y + 16)}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${INK}">${escapeXml(dv.text)}</text>`
    );
  };

  const sortedFragments = [...fragments].sort((a, b) => a.depth - b.depth);
  const fragmentBg = sortedFragments
    .map((fr) => {
      const parts = [
        `<rect x="${f(fr.x0)}" y="${f(fr.y0)}" width="${f(fr.x1 - fr.x0)}" height="${f(fr.y1 - fr.y0)}" rx="3" fill="${fr.kind === 'group' ? 'none' : 'rgba(9,105,218,0.035)'}" stroke="#8c959f" stroke-width="1"/>`,
      ];
      for (const e of fr.elses) parts.push(`<path d="M${f(fr.x0)} ${f(e.y)}H${f(fr.x1)}" stroke="#8c959f" stroke-width="1" stroke-dasharray="6 4"/>`);
      return parts.join('');
    })
    .join('');
  const labelChip = (x: number, y: number, text: string) => {
    const w = textWidth(text, 11.5) + 8;
    return (
      `<rect x="${f(x - 4)}" y="${f(y - 12)}" width="${f(w)}" height="16" rx="3" fill="#ffffff" fill-opacity="0.92"/>` +
      `<text x="${f(x)}" y="${f(y)}" font-size="11.5" fill="${INK}">${escapeXml(text)}</text>`
    );
  };
  const fragmentFg = sortedFragments
    .map((fr) => {
      const title = FRAGMENT_TITLE[fr.kind];
      const tagW = textWidth(title, 11) + 22;
      const parts = [
        `<path d="M${f(fr.x0)} ${f(fr.y0)}H${f(fr.x0 + tagW)}V${f(fr.y0 + 14)}L${f(fr.x0 + tagW - 8)} ${f(fr.y0 + 22)}H${f(fr.x0)}Z" fill="#eaeef2" stroke="#8c959f" stroke-width="1"/>`,
        `<text x="${f(fr.x0 + 7)}" y="${f(fr.y0 + 15)}" font-size="11" font-weight="700" fill="${INK}">${title}</text>`,
      ];
      if (fr.label) parts.push(labelChip(fr.x0 + tagW + 10, fr.y0 + 15, `[${fr.label}]`));
      for (const e of fr.elses) if (e.label) parts.push(labelChip(fr.x0 + 10, e.y + 16, `[${e.label}]`));
      return `<g class="fragment">${parts.join('')}</g>`;
    })
    .join('');

  const lifelines = cols
    .map((c) => `<path d="M${f(c.x)} ${headTop + headH}V${footTop}" stroke="#afb8c1" stroke-width="1.2" stroke-dasharray="6 5"/>`)
    .join('');
  const barSvg = bars
    .sort((a, b) => a.level - b.level)
    .map((b) => `<rect x="${f(b.x - ACT_W / 2 + (b.level - 1) * 5)}" y="${f(b.y0)}" width="${ACT_W}" height="${f(Math.max(6, b.y1 - b.y0))}" fill="#ddf4ff" stroke="#0969da" stroke-width="1"/>`)
    .join('');
  const heads = cols.map((c) => participantHead(c, headTop, headH) + participantHead(c, footTop, headH)).join('');
  const overlaySvg = overlays.map((o) => o.replace(/^\{DIVIDER:(\d+)\}$/, (_, i: string) => dividerSvg(Number(i)))).join('');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}">`,
    `<title>${escapeXml(d.title)}</title>`,
    '<defs>',
    `<marker id="seq-filled" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L10 5L0 10Z" fill="${LINE}"/></marker>`,
    `<marker id="seq-open" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L10 5L0 10" fill="none" stroke="${LINE}" stroke-width="1.3"/></marker>`,
    '</defs>',
    '<rect width="100%" height="100%" fill="#ffffff"/>',
    `<text x="${MARGIN}" y="${MARGIN + 16}" font-size="17" font-weight="700" fill="#1f2328">${escapeXml(d.title)}</text>`,
    descLines.map((l, i) => `<text x="${MARGIN}" y="${MARGIN + 36 + i * 15}" font-size="11.5" fill="#57606a">${escapeXml(l)}</text>`).join(''),
    `<g class="fragments">${fragmentBg}</g>`,
    `<g class="lifelines">${lifelines}</g>`,
    `<g class="activations">${barSvg}</g>`,
    `<g class="participants">${heads}</g>`,
    `<g class="messages">${body.join('')}</g>`,
    `<g class="fragment-labels">${fragmentFg}</g>`,
    `<g class="notes">${overlaySvg}</g>`,
    '</svg>',
  ].join('\n');
}

function numberBadge(x: number, y: number, n: number): string {
  return `<g class="num"><circle cx="${f(x)}" cy="${f(y)}" r="8" fill="#0969da"/><text x="${f(x)}" y="${f(y + 3.5)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#ffffff">${n}</text></g>`;
}
