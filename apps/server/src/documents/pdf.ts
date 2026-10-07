/** PDF → Markdown with unpdf (serverless pdf.js): per-page text with line reconstruction and a heading heuristic. */
import { fmtInt, withTimeout, yieldToLoop } from './limits.js';
import { DocumentError, documentError, type ParseContext, type ParsedDocument } from './types.js';

interface TextItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

export interface Line {
  text: string;
  /** Position in the line's own reading direction (rotated pages are turned upright). */
  x: number;
  y: number;
  xEnd: number;
  /** Size of most of the line's characters (one larger word does not make a body line a heading). */
  size: number;
  /** Largest size on the line, for the spacing tolerances. */
  maxSize: number;
  sizeChars: Map<number, number>;
  /** Multiple of 90° the text runs in. */
  quarter: number;
  /** Text at an angle (watermarks such as a diagonal "DRAFT"). */
  diagonal: boolean;
  eol: boolean;
}

const LIGATURES: Record<string, string> = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };
const roundSize = (size: number) => Math.round(size * 2) / 2;
const SCAN_PLACEHOLDER = '_(tidak ada teks yang bisa dibaca di halaman ini — gambar/hasil scan?)_';
const BROKEN_PLACEHOLDER = '_(halaman ini rusak dan tidak bisa dibaca)_';
/** Pages with less text than this are checked for a full-page image (a scan with a stamped footer). */
const LOW_TEXT_CHARS = 200;

/**
 * Joins pdf.js text items into lines, using their geometry for spacing (wide gaps, e.g. table columns, stay visible).
 * Each item is measured in its own text direction, so pages drawn rotated by 90° read as normal lines.
 */
export function pageItemsToLines(items: TextItem[]): Line[] {
  const lines: Line[] = [];
  let cur: Line | null = null;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const tr = it.transform ?? [1, 0, 0, 1, 0, 0];
    const size = Math.hypot(tr[2]!, tr[3]!) || Math.hypot(tr[0]!, tr[1]!) || it.height || 10;
    const angle = Math.atan2(tr[1]!, tr[0]!);
    const quarter = Math.round(angle / (Math.PI / 2));
    const diagonal = Math.abs(angle - quarter * (Math.PI / 2)) > 0.05;
    const cos = Math.cos(quarter * (Math.PI / 2));
    const sin = Math.sin(quarter * (Math.PI / 2));
    const x = tr[4]! * cos + tr[5]! * sin;
    const y = -tr[4]! * sin + tr[5]! * cos;
    const s = it.str;
    const width = it.width ?? 0;
    if (!s) {
      if (it.hasEOL && cur) cur.eol = true;
      continue;
    }
    const sameDirection = cur !== null && cur.quarter === quarter && cur.diagonal === diagonal;
    const tolerance = cur ? Math.max(size, cur.maxSize) : size;
    if (!s.trim() && cur && sameDirection && !cur.eol && Math.abs(y - cur.y) <= tolerance * 0.45) {
      // pdf.js emits explicit whitespace items spanning column gaps; keep wide gaps visible
      if (!/\s$/.test(cur.text)) cur.text += width > tolerance * 1.5 ? '   ' : ' ';
      cur.xEnd = x + width;
      if (it.hasEOL) cur.eol = true;
      continue;
    }
    const add = (line: Line) => {
      line.sizeChars.set(roundSize(size), (line.sizeChars.get(roundSize(size)) ?? 0) + s.length);
      line.maxSize = Math.max(line.maxSize, size);
    };
    if (cur && sameDirection && !cur.eol && Math.abs(y - cur.y) <= tolerance * 0.45) {
      if (x < cur.xEnd - Math.max(width * 0.5, 0.5) && cur.text.endsWith(s)) {
        // the same run drawn again over itself (fake bold, shadow): keep it once
        if (it.hasEOL) cur.eol = true;
        continue;
      }
      const gap = x - cur.xEnd;
      const needsSpace = !/\s$/.test(cur.text) && !/^\s/.test(s);
      if (gap > tolerance * 1.5 && needsSpace) cur.text += '   ';
      else if (gap > tolerance * 0.12 && needsSpace) cur.text += ' ';
      cur.text += s;
      cur.xEnd = x + width;
      add(cur);
    } else if (cur && sameDirection && cur.eol && Math.abs(y - cur.y) <= tolerance * 0.1 && x >= cur.xEnd - 1) {
      // pdf.js flagged an end of line but the geometry says same baseline (e.g. table cell runs): keep one line
      cur.eol = false;
      if (!/\s$/.test(cur.text) && !/^\s/.test(s)) cur.text += x - cur.xEnd > tolerance * 1.5 ? '   ' : ' ';
      cur.text += s;
      cur.xEnd = x + width;
      add(cur);
    } else {
      cur = { text: s, x, y, xEnd: x + width, size, maxSize: size, sizeChars: new Map(), quarter, diagonal, eol: false };
      add(cur);
      lines.push(cur);
    }
    if (it.hasEOL) cur.eol = true;
  }
  for (const l of lines) {
    let best = -1;
    for (const [size, chars] of l.sizeChars) if (chars > best) [best, l.size] = [chars, size];
    l.text = l.text
      .replace(/[ﬀ-ﬆ]/g, (c) => LIGATURES[c] ?? c)
      .replace(/\u0000/g, '')
      .replace(/[ \t]+$/g, '');
  }
  return lines.filter((l) => l.text.trim());
}

/** A short line clearly larger than the body text (diagonal watermarks never count). */
function isHeadingCandidate(l: Line, bodySize: number): boolean {
  const t = l.text.trim();
  return !l.diagonal && bodySize > 0 && l.size >= bodySize * 1.25 && t.length <= 120 && /\p{L}/u.test(t);
}

/** Heading levels by rank of the document's own heading sizes: the largest is #, the next ##, the rest ###. */
function headingLevels(pages: Line[][], bodySize: number): (size: number) => string {
  const sizes = new Set<number>();
  for (const lines of pages) for (const l of lines) if (isHeadingCandidate(l, bodySize)) sizes.add(l.size);
  const ranked = [...sizes].sort((a, b) => b - a);
  return (size) => '#'.repeat(Math.min(3, ranked.indexOf(size) + 1 || 3));
}

/** b directly follows a as the next line of the same paragraph (same size, normal line spacing). */
function continues(a: Line, b: Line): boolean {
  const sameSize = Math.abs(a.size - b.size) <= Math.max(a.size, b.size) * 0.05;
  const dy = a.y - b.y;
  return sameSize && a.quarter === b.quarter && dy > 0 && dy <= a.size * 1.6;
}

/**
 * Renders the lines of one page. Short lines clearly larger than the body text become headings, unless they belong
 * to a paragraph of such lines (large print, a cover page); a heading wrapped onto two lines stays one heading.
 */
export function renderPage(lines: Line[], bodySize: number, levelOf: (size: number) => string): string {
  const out: string[] = [];
  let prev: Line | null = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (prev) {
      const gap = Math.max(prev.size, l.size);
      const dy = prev.y - l.y;
      if (dy > gap * 1.75 || dy < -gap * 2) out.push('');
    }
    let t = l.text.trim();
    let heading = isHeadingCandidate(l, bodySize);
    let consumed = 0;
    if (heading) {
      let first = i;
      while (first > 0 && continues(lines[first - 1]!, lines[first]!)) first -= 1;
      let last = i;
      while (last + 1 < lines.length && continues(lines[last]!, lines[last + 1]!)) last += 1;
      const run = lines.slice(first, last + 1);
      if (run.length > 2 || (run.length === 2 && run.some((r) => r.text.trim().length > 60))) heading = false;
      else if (run.length === 2 && first === i) {
        t = `${t} ${run[1]!.text.trim()}`;
        consumed = 1;
      }
    }
    if (heading) {
      const level = levelOf(l.size);
      if (prev && out.length && out[out.length - 1] !== '') out.push('');
      out.push(`${level} ${t}`, '');
    } else {
      out.push(t);
    }
    prev = lines[i + consumed]!;
    i += consumed;
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function listPages(pages: number[]): string {
  return pages.length > 10 ? `${pages.slice(0, 10).join(', ')} dan ${pages.length - 10} lainnya` : pages.join(', ');
}

/** Every permission a PDF can grant (pdf.js PermissionFlag values). */
const ALL_PERMISSIONS = [4, 8, 16, 32, 256, 512, 1024, 2048];

export async function extractPdf(ctx: ParseContext): Promise<ParsedDocument> {
  const { bytes, limits, deadline, warnings, maxChars } = ctx;
  const { getDocumentProxy, getResolvedPDFJS } = await import('unpdf');
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await withTimeout(
      getDocumentProxy(new Uint8Array(bytes), {
        disableFontFace: true,
        useSystemFonts: false,
        stopAtErrors: false,
        verbosity: 0,
        enableXfa: false,
      }),
      deadline,
    );
  } catch (err) {
    if (err instanceof DocumentError) throw err;
    const name = (err as { name?: string } | null)?.name ?? '';
    const message = err instanceof Error ? err.message : String(err);
    if (name === 'PasswordException') {
      throw documentError('ENCRYPTED', 'PDF ini dilindungi kata sandi (terenkripsi). Lampirkan salinan tanpa kata sandi.');
    }
    if (/unknown encryption method|unsupported encryption algorithm/i.test(message)) {
      throw documentError('ENCRYPTED', 'PDF ini dilindungi sertifikat/enkripsi khusus. Lampirkan salinan tanpa perlindungan.');
    }
    throw documentError('CORRUPT', `File rusak atau bukan PDF yang valid (${message.slice(0, 200)}).`);
  }

  try {
    const { OPS } = await getResolvedPDFJS();
    const imageOps = new Set<number>([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat]);
    const numPages = pdf.numPages;
    try {
      const perms = await pdf.getPermissions();
      if (perms && ALL_PERMISSIONS.some((flag) => !perms.includes(flag))) {
        warnings.push('PDF ini memiliki pembatasan penggunaan (owner password); teksnya tetap dibaca untuk analisis.');
      }
    } catch {
      // permissions are informational only
    }

    const pageLimit = Math.min(numPages, limits.maxPages);
    const pageLines: Line[][] = [];
    const brokenPages = new Set<number>();
    const imagePages = new Set<number>();
    let chars = 0;
    let privateUseChars = 0;
    let allChars = 0;
    for (let i = 1; i <= pageLimit; i++) {
      deadline.check();
      let lines: Line[] = [];
      try {
        const page = await withTimeout(pdf.getPage(i), deadline);
        const content = await withTimeout(page.getTextContent({ includeMarkedContent: false }), deadline);
        lines = pageItemsToLines(content.items as TextItem[]);
        // a page with a full-page image and only a little text (signature footer, page number) is a scan
        if (lines.length && lines.reduce((n, l) => n + l.text.replace(/\s/g, '').length, 0) < LOW_TEXT_CHARS) {
          const ops = await withTimeout(page.getOperatorList(), deadline);
          if (ops.fnArray.some((fn: number) => imageOps.has(fn))) imagePages.add(i);
        }
        page.cleanup();
      } catch (err) {
        if (err instanceof DocumentError) throw err;
        brokenPages.add(i);
      }
      pageLines.push(lines);
      for (const l of lines) {
        for (const ch of l.text) {
          allChars += 1;
          const c = ch.codePointAt(0)!;
          if (c >= 0xe000 && c <= 0xf8ff) privateUseChars += 1;
        }
        chars += l.text.length + 1;
      }
      if (chars > maxChars) break;
      if (i % 10 === 0) await yieldToLoop();
    }
    if (pageLines.length && brokenPages.size === pageLines.length) {
      throw documentError('CORRUPT', 'File rusak: tidak ada halaman PDF yang bisa dibaca.');
    }

    // the dominant text size (by characters) is the body size
    const sizes = new Map<number, number>();
    for (const lines of pageLines) {
      for (const l of lines) {
        if (l.diagonal) continue;
        for (const [size, n] of l.sizeChars) sizes.set(size, (sizes.get(size) ?? 0) + n);
      }
    }
    let bodySize = 0;
    let best = -1;
    for (const [k, v] of sizes) {
      if (v > best) [best, bodySize] = [v, k];
    }

    const levelOf = headingLevels(pageLines, bodySize);
    // whole pages up to the character budget (room left for the truncation note), so every page named is complete
    const budget = maxChars - 100;
    const parts: string[] = [];
    const emptyPages: number[] = [];
    let rendered = 0;
    let lastPage = 0;
    for (let idx = 0; idx < pageLines.length; idx++) {
      const n = idx + 1;
      const lines = pageLines[idx]!;
      let body: string;
      if (brokenPages.has(n)) body = BROKEN_PLACEHOLDER;
      else if (!lines.length) body = SCAN_PLACEHOLDER;
      else if (imagePages.has(n)) body = `${renderPage(lines, bodySize, levelOf)}\n\n${SCAN_PLACEHOLDER}`;
      else body = renderPage(lines, bodySize, levelOf);
      const block = `<!-- page ${n} -->\n\n${body}`;
      if (idx > 0 && rendered + 2 + block.length > budget) break;
      rendered += (idx > 0 ? 2 : 0) + block.length;
      parts.push(block);
      lastPage = n;
      if (!brokenPages.has(n) && (!lines.length || imagePages.has(n))) emptyPages.push(n);
    }

    if (lastPage > 0 && emptyPages.length === lastPage) {
      warnings.push('PDF tidak memiliki lapisan teks (hasil scan/gambar?); OCR belum didukung. Lampirkan PDF dengan teks atau versi Word-nya.');
    } else if (emptyPages.length) {
      warnings.push(`Halaman ${listPages(emptyPages)} tidak memiliki lapisan teks (gambar/hasil scan?); OCR belum didukung.`);
    }
    const broken = [...brokenPages].filter((p) => p <= lastPage);
    if (broken.length) warnings.push(`Halaman ${listPages(broken)} rusak dan dilewati.`);
    if (allChars > 50 && privateUseChars / allChars > 0.1) {
      warnings.push('Sebagian teks mungkin tidak terbaca dengan benar: PDF memakai font tanpa pemetaan Unicode.');
    }
    if (lastPage < numPages) {
      const reason = lastPage < pageLimit ? `batas ${fmtInt(maxChars)} karakter` : `batas ${fmtInt(limits.maxPages)} halaman`;
      warnings.push(`PDF dipotong setelah halaman ${lastPage} dari ${numPages} (${reason}).`);
      parts.push(`<!-- truncated: pages ${lastPage + 1}-${numPages} not included -->`);
    }
    return { kind: 'pdf', markdown: parts.join('\n\n'), parts: numPages };
  } finally {
    try {
      await pdf.loadingTask.destroy();
    } catch {
      // already gone
    }
  }
}
