export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T; errors: ValidationIssue[]; warnings: ValidationIssue[] }
  | { ok: false; errors: ValidationIssue[]; warnings: ValidationIssue[] };

export function formatIssues(title: string, issues: ValidationIssue[]): string {
  if (issues.length === 0) return '';
  return `${title}:\n${issues.map((i, n) => `${n + 1}. [${i.path}] ${i.message}`).join('\n')}`;
}

/** Escapes text for XML / SVG content and attribute values. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // characters that are not allowed in XML 1.0 documents
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
}

/** Rough text width for the default sans-serif font used in generated SVGs. */
export function textWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of text) {
    if (/[ilj.,:;'|!]/.test(ch)) units += 0.3;
    else if (/[mwMW@]/.test(ch)) units += 0.85;
    else if (/[A-Z0-9]/.test(ch)) units += 0.65;
    else if (ch === ' ') units += 0.3;
    else if (ch.charCodeAt(0) > 0x2e80) units += 1;
    else units += 0.55;
  }
  return units * fontSize;
}

/** Greedy word wrap by estimated pixel width; words longer than the line are hard-split. */
export function wrapText(text: string, maxWidth: number, fontSize: number, maxLines = Infinity): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const rawWord of paragraph.split(/\s+/).filter(Boolean)) {
      let word = rawWord;
      while (textWidth(word, fontSize) > maxWidth && word.length > 1) {
        let cut = word.length - 1;
        while (cut > 1 && textWidth(word.slice(0, cut), fontSize) > maxWidth) cut -= 1;
        if (line) {
          lines.push(line);
          line = '';
        }
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, fontSize) <= maxWidth) line = candidate;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1] ?? '';
    while (last.length > 1 && textWidth(`${last}…`, fontSize) > maxWidth) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return lines;
}
