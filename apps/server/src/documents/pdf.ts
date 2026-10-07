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

interface Line {
  text: string;
  x: number;
  y: number;
  xEnd: number;
  size: number;
  chars: number;
  eol: boolean;
}

const LIGATURES: Record<string, string> = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };

/** Joins pdf.js text items into lines, using their geometry for spacing (wide gaps, e.g. table columns, stay visible). */
export function pageItemsToLines(items: TextItem[]): Line[] {
  const lines: Line[] = [];
  let cur: Line | null = null;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const tr = it.transform ?? [1, 0, 0, 1, 0, 0];
    const size = Math.hypot(tr[2]!, tr[3]!) || Math.hypot(tr[0]!, tr[1]!) || it.height || 10;
    const x = tr[4]!;
    const y = tr[5]!;
    const s = it.str;
    const width = it.width ?? 0;
    if (!s) {
      if (it.hasEOL && cur) cur.eol = true;
      continue;
    }
    if (!s.trim() && cur && !cur.eol && Math.abs(y - cur.y) <= Math.max(size, cur.size) * 0.45) {
      // pdf.js emits explicit whitespace items spanning column gaps; keep wide gaps visible
      if (!/\s$/.test(cur.text)) cur.text += width > Math.max(size, cur.size) * 1.5 ? '   ' : ' ';
      cur.xEnd = x + width;
      if (it.hasEOL) cur.eol = true;
      continue;
    }
    if (cur && !cur.eol && Math.abs(y - cur.y) <= Math.max(size, cur.size) * 0.45) {
      const gap = x - cur.xEnd;
      const needsSpace = !/\s$/.test(cur.text) && !/^\s/.test(s);
      if (gap > Math.max(size, cur.size) * 1.5 && needsSpace) cur.text += '   ';
      else if (gap > Math.max(size, cur.size) * 0.12 && needsSpace) cur.text += ' ';
      cur.text += s;
      cur.xEnd = x + width;
      cur.size = Math.max(cur.size, size);
      cur.chars += s.length;
    } else if (cur && cur.eol && Math.abs(y - cur.y) <= Math.max(size, cur.size) * 0.1 && x >= cur.xEnd - 1) {
      // pdf.js flagged an end of line but the geometry says same baseline (e.g. table cell runs): keep one line
      cur.eol = false;
      if (!/\s$/.test(cur.text) && !/^\s/.test(s)) cur.text += x - cur.xEnd > Math.max(size, cur.size) * 1.5 ? '   ' : ' ';
      cur.text += s;
      cur.xEnd = x + width;
      cur.chars += s.length;
    } else {
      cur = { text: s, x, y, xEnd: x + width, size, chars: s.length, eol: false };
      lines.push(cur);
    }
    if (it.hasEOL) cur.eol = true;
  }
  for (const l of lines) {
    l.text = l.text
      .replace(/[ﬀ-ﬆ]/g, (c) => LIGATURES[c] ?? c)
      .replace(/\u0000/g, '')
      .replace(/[ \t]+$/g, '');
  }
  return lines.filter((l) => l.text.trim());
}

/** Renders the lines of one page; lines clearly larger than the body text become headings. */
function renderPage(lines: Line[], bodySize: number): string {
  const out: string[] = [];
  let prev: Line | null = null;
  for (const l of lines) {
    if (prev) {
      const dy = prev.y - l.y;
      if (dy > Math.max(prev.size, l.size) * 1.75 || dy < -Math.max(prev.size, l.size) * 2) out.push('');
    }
    const t = l.text.trim();
    if (bodySize && l.size >= bodySize * 1.25 && t.length <= 120 && /\p{L}/u.test(t)) {
      const level = l.size >= bodySize * 1.6 ? '#' : l.size >= bodySize * 1.35 ? '##' : '###';
      if (prev && out.length && out[out.length - 1] !== '') out.push('');
      out.push(`${level} ${t}`, '');
    } else {
      out.push(t);
    }
    prev = l;
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function listPages(pages: number[]): string {
  return pages.length > 10 ? `${pages.slice(0, 10).join(', ')} dan ${pages.length - 10} lainnya` : pages.join(', ');
}

export async function extractPdf(ctx: ParseContext): Promise<ParsedDocument> {
  const { bytes, limits, deadline, warnings, maxChars } = ctx;
  const { getDocumentProxy } = await import('unpdf');
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
    throw documentError('CORRUPT', `File rusak atau bukan PDF yang valid (${message.slice(0, 200)}).`);
  }

  try {
    const numPages = pdf.numPages;
    try {
      if (await pdf.getPermissions()) warnings.push('PDF ini memiliki pembatasan penggunaan (owner password); teksnya tetap dibaca untuk analisis.');
    } catch {
      // permissions are informational only
    }

    const pageLimit = Math.min(numPages, limits.maxPages);
    const pageLines: Line[][] = [];
    let chars = 0;
    let lastPage = 0;
    let stoppedForChars = false;
    let privateUseChars = 0;
    let allChars = 0;
    for (let i = 1; i <= pageLimit; i++) {
      deadline.check();
      const page = await withTimeout(pdf.getPage(i), deadline);
      const content = await withTimeout(page.getTextContent({ includeMarkedContent: false }), deadline);
      const lines = pageItemsToLines(content.items as TextItem[]);
      page.cleanup();
      pageLines.push(lines);
      for (const l of lines) {
        for (const ch of l.text) {
          allChars += 1;
          const c = ch.codePointAt(0)!;
          if (c >= 0xe000 && c <= 0xf8ff) privateUseChars += 1;
        }
        chars += l.text.length + 1;
      }
      lastPage = i;
      if (chars > maxChars) {
        stoppedForChars = i < numPages;
        break;
      }
      if (i % 10 === 0) await yieldToLoop();
    }

    // the dominant text size (by characters) is the body size
    const sizes = new Map<number, number>();
    for (const lines of pageLines) {
      for (const l of lines) {
        const k = Math.round(l.size * 2) / 2;
        sizes.set(k, (sizes.get(k) ?? 0) + l.chars);
      }
    }
    let bodySize = 0;
    let best = -1;
    for (const [k, v] of sizes) {
      if (v > best) [best, bodySize] = [v, k];
    }

    const parts: string[] = [];
    const emptyPages: number[] = [];
    pageLines.forEach((lines, idx) => {
      const n = idx + 1;
      parts.push(`<!-- page ${n} -->`);
      if (!lines.length) {
        emptyPages.push(n);
        parts.push('_(tidak ada teks yang bisa dibaca di halaman ini — gambar/hasil scan?)_');
      } else {
        parts.push(renderPage(lines, bodySize));
      }
    });

    if (lastPage > 0 && emptyPages.length === lastPage) {
      warnings.push('PDF tidak memiliki lapisan teks (hasil scan/gambar?); OCR belum didukung. Lampirkan PDF dengan teks atau versi Word-nya.');
    } else if (emptyPages.length) {
      warnings.push(`Halaman ${listPages(emptyPages)} tidak memiliki lapisan teks (gambar/hasil scan?); OCR belum didukung.`);
    }
    if (allChars > 50 && privateUseChars / allChars > 0.1) {
      warnings.push('Sebagian teks mungkin tidak terbaca dengan benar: PDF memakai font tanpa pemetaan Unicode.');
    }
    if (stoppedForChars) {
      warnings.push(`PDF dipotong setelah halaman ${lastPage} dari ${numPages} (batas ${fmtInt(maxChars)} karakter).`);
    } else if (numPages > limits.maxPages) {
      warnings.push(`PDF dipotong setelah halaman ${lastPage} dari ${numPages} (batas ${fmtInt(limits.maxPages)} halaman).`);
    }
    if (lastPage < numPages) parts.push(`<!-- truncated: pages ${lastPage + 1}-${numPages} not included -->`);
    return { kind: 'pdf', markdown: parts.join('\n\n'), parts: numPages };
  } finally {
    try {
      await pdf.loadingTask.destroy();
    } catch {
      // already gone
    }
  }
}
