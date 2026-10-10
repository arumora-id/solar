import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  HeightRule,
  ImageRun,
  ImportedXmlComponent,
  InternalHyperlink,
  LevelFormat,
  LineRuleType,
  Packer,
  PageOrientation,
  PageNumber,
  Paragraph,
  ShadingType,
  Tab,
  TableOfContents,
  TabStopType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  UnderlineType,
  VerticalAlignTable,
  WidthType,
  type FileChild,
  type ILevelsOptions,
  type IRunOptions,
  type PageNumberEstimator,
  type ParagraphChild,
} from 'docx';
import { estimatePageNumbers } from 'docx/layout';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { Lexer, type Token, type Tokens } from 'marked';
import { t as message, type Lang } from '../../i18n.js';
import { markdownToPlain } from '../../util/markdown.js';
import { placeholderPng, rasterizeSvg, svgSize } from '../svgRaster.js';
import type { Block, BuiltDocument } from './document.js';
import { t, type StringKey } from './i18n.js';

/**
 * Word (.docx) delivery document from the same BuiltDocument as the Markdown and HTML renderers.
 *
 * Everything is formatted through named styles (Word's built-in Title, Heading 1-6, Caption, TOC 1, Quote, List Paragraph,
 * Header, Footer, Table Grid, plus a few SOLAR styles), so a client can re-skin the document with their own template.
 */

export interface DocxRenderResult {
  buffer: Buffer;
  /** Problems that did not stop the document, e.g. a diagram whose PNG fallback could not be drawn. */
  warnings: string[];
}

export interface DocxRenderOptions {
  /**
   * Write the page numbers of the table of contents (and the page count) into the file by laying the pages out as Word
   * does (docx/layout). Default true; tests turn it off for speed.
   */
  pageNumbers?: boolean;
  /**
   * Language of the warnings: English by default (the TSD tool hands them to the model); the Word export of the API
   * passes the language of the request, since the user reads them.
   */
  warningLanguage?: Lang;
}

// ---- page & look ---------------------------------------------------------------------

/** A4 with 2.5 cm margins, in twips. */
const PAGE = { width: 11906, height: 16838, margin: 1418, header: 709, footer: 709 };
const TEXT_WIDTH = PAGE.width - 2 * PAGE.margin;
/** The text width of a landscape page (wide diagrams get one of their own). */
const LANDSCAPE_TEXT_WIDTH = PAGE.height - 2 * PAGE.margin;
const TWIPS_PER_PX = 15;
/**
 * Largest image in CSS pixels (96 dpi) on a portrait and on a landscape page: the text width, and a height that leaves
 * room on the page for the heading kept with it (portrait), the caption and a note below it.
 */
const MAX_IMAGE = {
  portrait: { width: Math.floor(TEXT_WIDTH / TWIPS_PER_PX), height: 840 },
  landscape: { width: Math.floor(LANDSCAPE_TEXT_WIDTH / TWIPS_PER_PX), height: 560 },
};
/** Room a heading moved onto a diagram's landscape page takes, in CSS pixels. */
const HEADING_PX = 70;
/** Room the closing "made with SOLAR" note takes when it ends up below the last diagram, in CSS pixels. */
const CLOSING_NOTE_PX = 70;
/** A diagram gets a landscape page of its own when that shows it (and its text) at least this much larger. */
const LANDSCAPE_GAIN = 1.2;
/** Below this size (in points, as printed) diagram text is hard to read and the result says so. */
const MIN_PRINTED_TEXT_PT = 5;
/** The PNG fallback is drawn at twice the size it is shown at (about 190 dpi on paper). */
const RASTER_SCALE = 2;

const FONT = 'Calibri';
const MONO = 'Consolas';
const C = {
  text: '262626',
  muted: '595959',
  primary: '1F4E79',
  accent: '2E74B5',
  link: '0563C1',
  border: 'BFBFBF',
  headerFill: '1F4E79',
  labelFill: 'DEEAF6',
  band: 'F3F7FB',
  codeFill: 'F6F8FA',
  codeBorder: 'D0D7DE',
  inlineCodeFill: 'EFF1F3',
};

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

/** Characters XML 1.0 does not allow (control characters, lone surrogates, U+FFFE/U+FFFF). */
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function xmlSafe(text: string): string {
  return text.replace(INVALID_XML, '');
}

/** Strips characters XML cannot carry from every string of the document (Word refuses to open a file that has them). */
function cleanDeep<T>(value: T): T {
  if (typeof value === 'string') return xmlSafe(value) as T;
  if (Array.isArray(value)) return value.map(cleanDeep) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanDeep(v)])) as T;
  return value;
}

const solid = (fill: string) => ({ type: ShadingType.CLEAR, color: 'auto', fill });
const line = (color: string, size = 4, space = 0) => ({ style: BorderStyle.SINGLE, size, color, space });
const NONE = { style: BorderStyle.NONE, size: 0, color: 'auto' };

// ---- diagrams ------------------------------------------------------------------------------

interface FigureImage {
  svg: Buffer;
  png: Buffer;
  width: number;
  height: number;
  /** Shown on a landscape page of its own (with its caption), because it is much wider than tall. */
  landscape: boolean;
}

/** Where a figure sits among the blocks, which decides how much of a page it can take. */
interface FigureContext {
  /** Headings right before it, which move onto its landscape page with it. */
  headingsBefore: number;
  /** Pixels of what follows it on the same page (the note pointing to its Mermaid source, the closing note). */
  trailingPx: number;
}

/** Office's SVG renderer is safest with fill/stroke + *-opacity than with rgba() colours. */
function svgForWord(svg: string): string {
  const hex = (v: string) => Math.max(0, Math.min(255, Number(v))).toString(16).padStart(2, '0');
  return svg.replace(
    /\b(fill|stroke)="rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)"/g,
    (_m, prop: string, r: string, g: string, b: string, a: string) => `${prop}="#${hex(r)}${hex(g)}${hex(b)}" ${prop}-opacity="${a}"`,
  );
}

/** The usual text size of an SVG in CSS pixels (the median of its font-size declarations), or null when it declares none. */
export function svgTextSize(svg: string, width: number): number | null {
  const sizes = [...svg.matchAll(/font-size\s*(?:=\s*["']|:)\s*([0-9]*\.?[0-9]+)\s*(px)?\s*["';]/gi)].map((m) => Number(m[1])).filter((n) => n > 0);
  if (!sizes.length) return null;
  sizes.sort((a, b) => a - b);
  // font sizes are in user units: scale them when the viewBox is not the drawn size
  const box = /<svg\b[^>]*\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)/i.exec(svg)?.[1];
  const unit = box && Number(box) > 0 ? width / Number(box) : 1;
  return sizes[Math.floor((sizes.length - 1) / 2)]! * unit;
}

function fit(size: { width: number; height: number }, box: { width: number; height: number }): number {
  return Math.min(1, box.width / size.width, box.height / size.height);
}

async function prepareFigure(
  block: Extract<Block, { kind: 'figure' }>,
  context: FigureContext,
  warnings: string[],
  lang: Lang,
): Promise<FigureImage> {
  const svg = svgForWord(block.diagram.svg.replace(/^\uFEFF/, ''));
  const natural = svgSize(svg);
  const file = block.diagram.fileName;
  if (!natural) warnings.push(message(lang, 'docx.warning.noSize', { file }));
  const size = natural ?? { width: 800, height: 600 };
  // a wide diagram is shown larger on a landscape page of its own (with the headings right before it)
  const portrait = fit(size, { width: MAX_IMAGE.portrait.width, height: MAX_IMAGE.portrait.height - context.trailingPx });
  const landscapeHeight = MAX_IMAGE.landscape.height - context.headingsBefore * HEADING_PX - context.trailingPx;
  const landscapeScale = landscapeHeight >= 200 ? fit(size, { width: MAX_IMAGE.landscape.width, height: landscapeHeight }) : 0;
  const landscape = landscapeScale >= portrait * LANDSCAPE_GAIN;
  const scale = landscape ? landscapeScale : portrait;
  const width = Math.max(1, Math.round(size.width * scale));
  const height = Math.max(1, Math.round(size.height * scale));
  const textPx = svgTextSize(svg, size.width);
  // CSS pixels at 96 dpi -> points at 72 dpi
  const printed = textPx === null ? null : textPx * scale * 0.75;
  if (printed !== null && printed < MIN_PRINTED_TEXT_PT) {
    const points = printed.toLocaleString(lang === 'id' ? 'id-ID' : 'en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    warnings.push(message(lang, 'docx.warning.smallText', { file, scale: Math.round(scale * 100), points }));
  }
  let png: Buffer;
  try {
    png = (await rasterizeSvg(svg, width * RASTER_SCALE)).png;
  } catch (err) {
    warnings.push(message(lang, 'docx.warning.noPng', { file, error: err instanceof Error ? err.message : String(err) }));
    png = placeholderPng(Math.min(width, 480), Math.min(height, 480));
  }
  return { svg: Buffer.from(svg, 'utf8'), png, width, height, landscape };
}

/** How each figure sits among the blocks (see FigureContext). */
function figureContexts(blocks: Block[]): Map<Block, FigureContext> {
  const out = new Map<Block, FigureContext>();
  blocks.forEach((b, i) => {
    if (b.kind !== 'figure') return;
    let headingsBefore = 0;
    for (let j = i - 1; j >= 0 && blocks[j]!.kind === 'heading'; j--) headingsBefore++;
    const note = blocks[i + 1]?.kind === 'mermaid';
    const last = i + (note ? 1 : 0) === blocks.length - 1;
    out.set(b, { headingsBefore, trailingPx: (note ? 30 : 0) + (last ? CLOSING_NOTE_PX : 0) });
  });
  return out;
}

// ---- small helpers ---------------------------------------------------------------------------

function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? xmlSafe(String.fromCodePoint(code)) : m;
    }
    return named[body.toLowerCase()] ?? m;
  });
}

/**
 * A Markdown link destination as the URI Word stores it (an OPC relationship target must be a valid URI): HTML entities
 * decoded as CommonMark does ("&amp;" is "&"), then spaces, quotes, "|" and other characters RFC 3986 does not allow
 * percent-encoded. null for anything but http(s) and mailto links, which stay plain text.
 */
export function externalHref(destination: string): string | null {
  const decoded = decodeEntities(destination.trim());
  if (!/^(https?:|mailto:)/i.test(decoded)) return null;
  let href: string;
  try {
    href = new URL(decoded).href;
  } catch {
    try {
      href = encodeURI(decoded);
    } catch {
      return null;
    }
  }
  return href
    .replace(/%(?![0-9A-Fa-f]{2})/g, '%25')
    .replace(/[^A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]/gu, (c) => encodeURIComponent(c));
}

/** Word bookmark names: letters, digits and "_", at most 40 characters; a leading "_" hides them from the Bookmark dialog. */
function bookmarkName(anchor: string, used: Set<string>): string {
  const base = `_Tsd_${anchor.normalize('NFKD').replace(/[^A-Za-z0-9_]+/g, '_')}`.slice(0, 40);
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 40 - String(n).length - 1)}_${n}`;
  used.add(name.toLowerCase());
  return name;
}

function longDate(iso: string, lang: 'id' | 'en'): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  try {
    return new Intl.DateTimeFormat(lang === 'id' ? 'id-ID' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))),
    );
  } catch {
    return iso;
  }
}

/** Advance widths (1/1000 em) of the printable ASCII characters in Calibri (and Carlito, made to the same widths). */
const CALIBRI_WIDTHS = {
  regular:
    '226,326,401,498,507,715,682,221,303,303,498,498,250,306,252,386,507,507,507,507,507,507,507,507,507,507,268,268,498,498,498,463,894,579,544,533,615,488,459,631,623,252,319,520,420,855,646,662,517,673,543,459,487,642,567,890,519,487,468,307,386,307,498,498,291,479,525,423,525,498,305,471,525,229,239,455,229,799,525,527,525,525,349,391,335,525,452,715,433,453,395,314,460,314,498',
  bold: '226,326,438,498,507,729,705,233,312,312,498,498,258,306,267,430,507,507,507,507,507,507,507,507,507,507,276,276,498,498,498,463,898,606,561,529,630,488,459,637,631,267,331,547,423,874,659,676,532,686,563,473,495,653,591,906,551,520,478,325,430,325,498,498,300,494,537,418,537,503,316,474,537,246,255,480,246,813,537,538,537,537,355,399,347,537,473,745,459,474,397,344,475,344,498',
};
const WIDTHS = { regular: CALIBRI_WIDTHS.regular.split(',').map(Number), bold: CALIBRI_WIDTHS.bold.split(',').map(Number) };

/** Width of a text on one line in twips, in Calibri at `size` points. */
export function textTwips(text: string, size: number, bold = false): number {
  const table = bold ? WIDTHS.bold : WIDTHS.regular;
  let em = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    // other Latin letters about as wide as the average letter, CJK and emoji a full em
    em += c >= 32 && c <= 126 ? table[c - 32]! : c >= 0x2e80 ? 1000 : 560;
  }
  return (em / 1000) * size * 20;
}

/** Where a line may break: at spaces, and after "/" ("Request/Response"). Hyphens are kept: "INT-01" is one token. */
const breakTokens = (text: string) => text.split(/\s+|(?<=\/)/).filter(Boolean);
const clip = (word: string, chars: number) => [...word].slice(0, chars).join('');

/**
 * Each column's four widths (twips), each at least the one before: room for its header words and short tokens (ids such
 * as "INT-01", "500m", ordinary words: never broken); for its long tokens up to 18 characters; up to 40 characters; and
 * for its typical text. Measured with Calibri's character widths at the table's font `size` (header words bold);
 * `padding` is the cell's left + right margin.
 */
function columnLevels(columns: string[][], size: number, padding: number): Array<readonly [number, number, number, number]> {
  // a little more than the margins: rounding, cell borders
  const pad = padding + 30;
  const measure = (text: string, bold = false) => textTwips(text, size, bold);
  return columns.map((cells) => {
    const [header = '', ...body] = cells.map((c) => c.replace(/\s+/g, ' ').trim());
    const words = body.flatMap(breakTokens);
    const headerWord = Math.max(0, ...breakTokens(header).map((w) => measure(w, true)));
    const shortWord = Math.max(0, ...words.filter((w) => [...w].length <= 12).map((w) => measure(w)));
    const capped = Math.max(0, ...words.map((w) => measure(clip(w, 18))));
    const longest = Math.max(0, ...words.map((w) => measure(clip(w, 40))));
    const lengths = body.map((c) => measure(c)).sort((x, y) => x - y);
    const typical = lengths.length ? lengths[Math.min(lengths.length - 1, Math.ceil((lengths.length - 1) * 0.8))]! : measure(header, true);
    const l0 = Math.max(headerWord, shortWord, measure('MM')) + pad;
    const l1 = Math.max(l0, capped + pad);
    const l2 = Math.max(l1, longest + pad);
    const l3 = Math.max(l2, Math.min(typical, measure('n'.repeat(60))) + pad);
    return [l0, l1, l2, l3] as const;
  });
}

/**
 * Column widths (twips) from the content (see columnLevels). The table gets the largest of the four widths that fits
 * `total`, plus a share of what is left toward the next, so when space is short it is taken from the columns with long
 * words and much text, not from the id and code columns. Only when even the first does not fit are all columns scaled
 * down.
 */
export function columnWidths(columns: string[][], total = TEXT_WIDTH, size = 9.5, padding = 2 * 90): number[] {
  const levels = columnLevels(columns, size, padding);
  const sum = (k: number) => levels.reduce((a, l) => a + l[k]!, 0);
  let widths: number[];
  if (sum(3) <= total) widths = levels.map((l) => (l[3] / sum(3)) * total);
  else if (sum(0) >= total) widths = levels.map((l) => (l[0] / sum(0)) * total);
  else {
    let k = 0;
    while (k < 2 && sum(k + 1) <= total) k++;
    const span = sum(k + 1) - sum(k) || 1;
    widths = levels.map((l) => l[k]! + ((l[k + 1]! - l[k]!) / span) * (total - sum(k)));
  }
  const rounded = widths.map((w) => Math.floor(w));
  rounded[rounded.indexOf(Math.max(...rounded))]! += total - rounded.reduce((a, w) => a + w, 0);
  return rounded;
}

/** Whether every word of the columns (up to 40 characters; longer ones always break) fits its column in `total` twips. */
export function wordsFit(columns: string[][], total: number, size: number, padding: number): boolean {
  return columnLevels(columns, size, padding).reduce((a, l) => a + l[2], 0) <= total;
}

/** How a table is set: on a portrait or landscape page, at what text width, font size and cell margin. */
export interface TableLayout {
  landscape: boolean;
  width: number;
  /** The smaller table font (Table Text Small) and narrower cell margins. */
  small: boolean;
  size: number;
  margin: number;
}

const tableLayoutOf = (landscape: boolean, small: boolean): TableLayout => ({
  landscape,
  width: landscape ? LANDSCAPE_TEXT_WIDTH : TEXT_WIDTH,
  small,
  size: small ? 8.5 : 9.5,
  margin: small ? 45 : 90,
});

/**
 * The layout of a table of the document. Tables of 7 or more columns (e.g. the integration catalogue) use a smaller
 * font and narrower cell margins so they fit portrait A4. When even so a column is narrower than one of its words (an
 * identifier such as "MerchantNotificationGateway" would break mid-word), and `landscapeAllowed`, the table gets a
 * landscape page instead, where it is set at the normal size if its words fit at that size.
 */
export function tableLayout(columns: string[][], landscapeAllowed = true): TableLayout {
  const portrait = tableLayoutOf(false, columns.length >= 7);
  const candidates = landscapeAllowed ? [portrait, tableLayoutOf(true, false), tableLayoutOf(true, true)] : [portrait];
  const fitting = candidates.find((l) => wordsFit(columns, l.width, l.size, 2 * l.margin));
  return fitting ?? candidates[candidates.length - 1]!;
}

const MARKED = { gfm: true, breaks: false };

/** The text inline Markdown shows (as the runs Writer.inline makes of it), to measure table cells with. */
function displayedText(markdown: string): string {
  const plain = (tokens: Token[] | undefined): string =>
    (tokens ?? [])
      .map((t) => {
        if (t.type === 'br') return ' ';
        if (t.type === 'image') return t.text ? `[${t.text}]` : '';
        if ('tokens' in t && Array.isArray(t.tokens) && t.tokens.length) return plain(t.tokens as Token[]);
        return 'text' in t && typeof t.text === 'string' ? decodeEntities(t.text) : '';
      })
      .join('');
  return markdown
    .split(/\r?\n/)
    .map((line) => plain(Lexer.lexInline(line, MARKED)))
    .join(' ');
}

/** A table's text column by column (header first), as shown, to size the columns with. */
function tableColumns(headers: string[], rows: string[][]): string[][] {
  return headers.map((h, i) => [displayedText(h), ...rows.map((r) => displayedText(r[i] ?? ''))]);
}

type Align = 'left' | 'center' | 'right' | null;
const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT } as const;

interface Fmt {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  link?: boolean;
}

// ---- the writer ------------------------------------------------------------------------------

/** Builds the document's paragraphs and tables; one instance per packing (docx objects are not reused). */
class Writer {
  readonly L: (key: StringKey) => string;
  /** Each heading's Word bookmark (unique even when two headings share a text and so an anchor) */
  private readonly headingBookmarks = new Map<Block, string>();
  /** block.anchor -> bookmark of its first heading, so Markdown links to "#anchor" work inside the document */
  private readonly bookmarks = new Map<string, string>();
  private readonly numbering = new Map<string, ILevelsOptions[]>();
  private listInstance = 0;

  constructor(
    private readonly doc: BuiltDocument,
    private readonly figures: Map<Block, FigureImage>,
  ) {
    this.L = (key) => t(doc.lang, key);
    const used = new Set<string>();
    for (const b of doc.blocks) {
      if (b.kind !== 'heading') continue;
      const name = bookmarkName(b.anchor, used);
      this.headingBookmarks.set(b, name);
      if (!this.bookmarks.has(b.anchor)) this.bookmarks.set(b.anchor, name);
    }
    this.numbering.set('tsd-bullet', bulletLevels());
  }

  /** Bookmarks of the headings the table of contents lists. */
  tocBookmarks(): string[] {
    return this.doc.blocks.flatMap((b) => (b.kind === 'heading' && b.toc ? [this.headingBookmarks.get(b)!] : []));
  }

  numberingConfig() {
    return { config: [...this.numbering].map(([reference, levels]) => ({ reference, levels })) };
  }

  // ---- inline Markdown ----

  private run(text: string, fmt: Fmt, extra: IRunOptions = {}): TextRun {
    return new TextRun({
      text,
      bold: fmt.bold || undefined,
      italics: fmt.italics || undefined,
      strike: fmt.strike || undefined,
      style: fmt.link ? 'Hyperlink' : undefined,
      ...extra,
    });
  }

  /** Inline tokens -> runs. Raw HTML is kept as literal text, never interpreted. */
  inline(tokens: Token[] | undefined, fmt: Fmt = {}): ParagraphChild[] {
    const out: ParagraphChild[] = [];
    for (const token of tokens ?? []) {
      switch (token.type) {
        case 'text': {
          const tok = token as Tokens.Text;
          if (tok.tokens?.length) out.push(...this.inline(tok.tokens, fmt));
          else out.push(this.run(decodeEntities(tok.text).replace(/\s*\n\s*/g, ' '), fmt));
          break;
        }
        case 'escape':
          out.push(this.run((token as Tokens.Escape).text, fmt));
          break;
        case 'strong':
          out.push(...this.inline((token as Tokens.Strong).tokens, { ...fmt, bold: true }));
          break;
        case 'em':
          out.push(...this.inline((token as Tokens.Em).tokens, { ...fmt, italics: true }));
          break;
        case 'del':
          out.push(...this.inline((token as Tokens.Del).tokens, { ...fmt, strike: true }));
          break;
        case 'codespan':
          out.push(new TextRun({ text: (token as Tokens.Codespan).text, style: 'InlineCode', bold: fmt.bold || undefined, italics: fmt.italics || undefined }));
          break;
        case 'br':
          out.push(new TextRun({ break: 1 }));
          break;
        case 'link': {
          const tok = token as Tokens.Link;
          const href = tok.href.trim();
          const external = externalHref(href);
          if (external) {
            out.push(new ExternalHyperlink({ link: external, children: this.inline(tok.tokens, { ...fmt, link: true }) }));
          } else if (href.startsWith('#') && this.bookmarks.has(safeDecode(href.slice(1)))) {
            out.push(new InternalHyperlink({ anchor: this.bookmarks.get(safeDecode(href.slice(1)))!, children: this.inline(tok.tokens, { ...fmt, link: true }) }));
          } else {
            out.push(...this.inline(tok.tokens, fmt));
          }
          break;
        }
        case 'image': {
          const tok = token as Tokens.Image;
          if (tok.text) out.push(this.run(`[${tok.text}]`, { ...fmt, italics: true }));
          break;
        }
        case 'html':
          out.push(this.run((token as Tokens.HTML).text, fmt));
          break;
        case 'checkbox':
          out.push(this.run((token as Tokens.Checkbox).checked ? '\u2612 ' : '\u2610 ', fmt));
          break;
        default:
          if ('tokens' in token && Array.isArray(token.tokens)) out.push(...this.inline(token.tokens as Token[], fmt));
          else if ('text' in token && typeof token.text === 'string') out.push(this.run(token.text, fmt));
      }
    }
    return out;
  }

  /** One line of inline Markdown (table cells, list items); "\n" becomes a line break. */
  inlineText(text: string, fmt: Fmt = {}): ParagraphChild[] {
    const out: ParagraphChild[] = [];
    text.split(/\r?\n/).forEach((part, i) => {
      if (i > 0) out.push(new TextRun({ break: 1 }));
      out.push(...this.inline(Lexer.lexInline(part, MARKED), fmt));
    });
    return out;
  }

  // ---- block Markdown ----

  /**
   * Block Markdown. `keepWithNext` keeps its last paragraph on the page of what follows: a label such as "Example
   * Response:" or "Acceptance Criteria:" is never left alone at the bottom of a page, away from its code block or list.
   */
  markdown(text: string, keepWithNext = false): FileChild[] {
    const tokens = Lexer.lex(text, MARKED);
    let last = tokens.length - 1;
    while (last >= 0 && tokens[last]!.type === 'space') last--;
    return this.blocks(tokens, { depth: 0 }, keepWithNext ? tokens[last] : undefined);
  }

  private blocks(tokens: Token[], ctx: { depth: number; quote?: boolean }, keepWithNext?: Token): FileChild[] {
    const out: FileChild[] = [];
    for (const token of tokens) {
      switch (token.type) {
        case 'paragraph':
        case 'text': {
          const tok = token as Tokens.Paragraph | Tokens.Text;
          out.push(
            new Paragraph({
              style: ctx.quote ? 'Quote' : undefined,
              keepNext: token === keepWithNext || undefined,
              children: tok.tokens ? this.inline(tok.tokens) : this.inlineText(tok.text),
            }),
          );
          break;
        }
        case 'heading': {
          // headings inside Markdown sit below the document's own levels (Heading 1 sections, Heading 2 sub-sections) and
          // stay out of the table of contents: #, ## and ### are Heading 3, #### Heading 4, and so on
          const tok = token as Tokens.Heading;
          out.push(new Paragraph({ heading: HEADINGS[Math.min(Math.max(tok.depth, 3), 6) - 1], children: this.inline(tok.tokens) }));
          break;
        }
        case 'code':
          out.push(this.code((token as Tokens.Code).text));
          break;
        case 'blockquote':
          out.push(...this.blocks((token as Tokens.Blockquote).tokens, { ...ctx, quote: true }));
          break;
        case 'list':
          out.push(...this.list(token as Tokens.List, ctx.depth));
          break;
        case 'table': {
          const tok = token as Tokens.Table;
          out.push(
            this.table(
              tok.header.map((h) => ({ text: h.text, children: this.inline(h.tokens) })),
              tok.rows.map((r) => r.map((c) => ({ text: c.text, children: this.inline(c.tokens) }))),
              tok.align,
            ),
            new Paragraph({ style: 'AfterTable' }),
          );
          break;
        }
        case 'hr':
          out.push(new Paragraph({ border: { bottom: line(C.border, 6, 1) }, spacing: { after: 200 } }));
          break;
        case 'html': {
          // raw HTML is shown as written, never interpreted
          const text = (token as Tokens.HTML).text.replace(/\s+$/, '');
          if (text) out.push(new Paragraph({ children: this.plainLines(text) }));
          break;
        }
        default:
          break; // space, def
      }
    }
    return out;
  }

  private plainLines(text: string, extra: IRunOptions = {}): ParagraphChild[] {
    return text.split(/\r?\n/).map((part, i) => new TextRun({ text: part, break: i > 0 ? 1 : undefined, ...extra }));
  }

  // ---- lists ----

  private orderedReference(depth: number, start: number): string {
    const reference = `tsd-ol-${depth}-${start}`;
    if (!this.numbering.has(reference)) {
      const format = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][depth % 3]!;
      this.numbering.set(reference, [
        { level: 0, format, text: '%1.', start, alignment: AlignmentType.LEFT, style: { paragraph: { indent: listIndent(depth) } } },
      ]);
    }
    return reference;
  }

  /** Each list gets its own numbering instance, so every ordered list restarts at its first number. */
  private listParagraphs(items: Array<{ head: ParagraphChild[]; rest: FileChild[] }>, ordered: boolean, depth: number, start = 1): FileChild[] {
    const instance = ++this.listInstance;
    const numbering = ordered
      ? { reference: this.orderedReference(depth, start), level: 0, instance }
      : { reference: 'tsd-bullet', level: Math.min(depth, 8), instance };
    const out: FileChild[] = [];
    for (const item of items) {
      out.push(new Paragraph({ numbering, children: item.head }));
      out.push(...item.rest);
    }
    return out;
  }

  private list(tok: Tokens.List, depth: number): FileChild[] {
    const items = tok.items.map((item) => {
      const head: ParagraphChild[] = [];
      const rest: FileChild[] = [];
      let headDone = false;
      for (const t of item.tokens) {
        if (t.type === 'checkbox' && !headDone) head.push(...this.inline([t]));
        else if ((t.type === 'text' || t.type === 'paragraph') && !headDone) {
          const p = t as Tokens.Text | Tokens.Paragraph;
          head.push(...(p.tokens ? this.inline(p.tokens) : this.inlineText(p.text)));
          headDone = true;
        } else if (t.type === 'list') rest.push(...this.list(t as Tokens.List, depth + 1));
        else if (t.type === 'text' || t.type === 'paragraph') {
          const p = t as Tokens.Text | Tokens.Paragraph;
          rest.push(new Paragraph({ style: 'ListParagraph', indent: { left: listIndent(depth).left }, children: p.tokens ? this.inline(p.tokens) : this.inlineText(p.text) }));
        } else rest.push(...this.blocks([t], { depth: depth + 1 }));
      }
      return { head, rest };
    });
    const start = typeof tok.start === 'number' && tok.start > 0 ? tok.start : 1;
    return this.listParagraphs(items, tok.ordered, depth, start);
  }

  simpleList(items: string[], ordered: boolean): FileChild[] {
    return this.listParagraphs(
      items.map((item) => ({ head: this.inlineText(item), rest: [] })),
      ordered,
      0,
    );
  }

  // ---- code ----

  code(text: string): Paragraph {
    const lines = text.replace(/\t/g, '    ').replace(/\s+$/, '').split(/\r?\n/);
    return new Paragraph({
      style: 'CodeBlock',
      keepLines: lines.length <= 30 || undefined,
      children: lines.map((l, i) => new TextRun({ text: l, break: i > 0 ? 1 : undefined })),
    });
  }

  // ---- tables ----

  /** A table; `layout` defaults to the portrait one (tables inside Markdown text always stay on the portrait page). */
  table(
    headers: Array<{ text: string; children: ParagraphChild[] }>,
    rows: Array<Array<{ text: string; children: ParagraphChild[] }>>,
    align: Align[] = [],
    layout?: TableLayout,
  ): Table {
    const cols = headers.length;
    const columns = tableColumns(
      headers.map((h) => h.text),
      rows.map((r) => r.map((c) => c.text)),
    );
    const { width, small, size, margin } = layout ?? tableLayout(columns, false);
    const widths = columnWidths(columns, width, size, 2 * margin);
    const cell = (children: ParagraphChild[], col: number, opts: { header?: boolean; fill?: string }) =>
      new TableCell({
        width: { size: widths[col]!, type: WidthType.DXA },
        shading: opts.fill ? solid(opts.fill) : undefined,
        verticalAlign: opts.header ? VerticalAlignTable.CENTER : VerticalAlignTable.TOP,
        children: [
          new Paragraph({
            style: `${opts.header ? 'TableHeading' : 'TableText'}${small ? 'Small' : ''}`,
            alignment: align[col] ? ALIGN[align[col]!] : undefined,
            children: children.length ? children : [new TextRun('')],
          }),
        ],
      });
    return new Table({
      style: 'TableGrid',
      width: { size: width, type: WidthType.DXA },
      columnWidths: widths,
      layout: TableLayoutType.FIXED,
      borders: gridBorders(),
      margins: { top: 40, bottom: 40, left: margin, right: margin },
      rows: [
        new TableRow({ tableHeader: true, cantSplit: true, children: headers.map((h, i) => cell(h.children, i, { header: true, fill: C.headerFill })) }),
        ...rows.map(
          (r, n) =>
            new TableRow({
              cantSplit: true,
              children: Array.from({ length: cols }, (_, i) => cell(r[i]?.children ?? [], i, { fill: n % 2 === 1 ? C.band : undefined })),
            }),
        ),
      ],
    });
  }

  textTable(headers: string[], rows: string[][], layout?: TableLayout): Table {
    return this.table(
      headers.map((h) => ({ text: h, children: [new TextRun(h)] })),
      rows.map((r) => r.map((c) => ({ text: c, children: this.inlineText(c) }))),
      [],
      layout,
    );
  }

  // ---- front matter ----

  cover(): FileChild[] {
    const { info, lang } = this.doc;
    const rows: Array<[string, string]> = [
      [this.L('documentId'), info.documentId ?? '-'],
      [this.L('version'), info.version],
      [this.L('status'), info.status],
      [this.L('date'), longDate(info.date, lang)],
      [this.L('authors'), info.authors.join(', ')],
    ];
    const widths = [2600, TEXT_WIDTH - 2600];
    return [
      new Paragraph({ style: 'Title', spacing: { before: 2400 }, border: { top: line(C.accent, 36, 18) }, children: [new TextRun(this.doc.title)] }),
      new Paragraph({ style: 'Subtitle', children: [new TextRun(this.L('documentSubtitle'))] }),
      new Table({
        width: { size: TEXT_WIDTH, type: WidthType.DXA },
        columnWidths: widths,
        layout: TableLayoutType.FIXED,
        borders: { top: line(C.border), bottom: line(C.border), insideHorizontal: line('D9D9D9'), left: NONE, right: NONE, insideVertical: NONE },
        margins: { top: 90, bottom: 90, left: 0, right: 90 },
        rows: rows.map(
          ([label, value]) =>
            new TableRow({
              children: [
                new TableCell({ width: { size: widths[0]!, type: WidthType.DXA }, children: [new Paragraph({ style: 'CoverLabel', children: [new TextRun(label)] })] }),
                new TableCell({ width: { size: widths[1]!, type: WidthType.DXA }, children: [new Paragraph({ style: 'CoverValue', children: [new TextRun(value)] })] }),
              ],
            }),
        ),
      }),
    ];
  }

  documentControl(): FileChild[] {
    const { info, lang } = this.doc;
    const out: FileChild[] = [];
    // as on the cover: the date written out, and one name per line (a name such as "Lead Security, Bank X" is one person)
    const values = new Map<string, string>([
      [this.L('date'), longDate(info.date, lang)],
      [this.L('authors'), info.authors.join('\n')],
      [this.L('reviewers'), info.reviewers.join('\n')],
      [this.L('approvers'), info.approvers.join('\n')],
    ]);
    out.push(new Paragraph({ style: 'FrontHeading', pageBreakBefore: true, children: [new TextRun(this.L('documentControl'))] }));
    const widths = [2700, TEXT_WIDTH - 2700];
    out.push(
      new Table({
        style: 'TableGrid',
        width: { size: TEXT_WIDTH, type: WidthType.DXA },
        columnWidths: widths,
        layout: TableLayoutType.FIXED,
        borders: gridBorders(),
        margins: { top: 50, bottom: 50, left: 90, right: 90 },
        rows: this.doc.meta.map(
          ([label, value]) =>
            new TableRow({
              cantSplit: true,
              children: [
                new TableCell({
                  width: { size: widths[0]!, type: WidthType.DXA },
                  shading: solid(C.labelFill),
                  children: [new Paragraph({ style: 'TableText', children: [new TextRun({ text: label, bold: true, color: C.primary })] })],
                }),
                new TableCell({
                  width: { size: widths[1]!, type: WidthType.DXA },
                  children: [new Paragraph({ style: 'TableText', children: this.inlineText(values.get(label) || value) })],
                }),
              ],
            }),
        ),
      }),
    );
    out.push(new Paragraph({ style: 'FrontSubheading', children: [new TextRun(this.L('revisionHistory'))] }));
    out.push(this.textTable(this.doc.revisionHeaders, this.doc.revisions));

    const signers = [
      ...info.reviewers.map((name) => [name, this.L('reviewerRole')] as const),
      ...info.approvers.map((name) => [name, this.L('approverRole')] as const),
    ];
    if (signers.length) {
      out.push(new Paragraph({ style: 'FrontSubheading', children: [new TextRun(this.L('approval'))] }));
      const w = [Math.round(TEXT_WIDTH * 0.32), Math.round(TEXT_WIDTH * 0.18), Math.round(TEXT_WIDTH * 0.3)];
      const sign = [...w, TEXT_WIDTH - w[0]! - w[1]! - w[2]!];
      const cell = (text: string, col: number, header = false) =>
        new TableCell({
          width: { size: sign[col]!, type: WidthType.DXA },
          shading: header ? solid(C.headerFill) : undefined,
          verticalAlign: VerticalAlignTable.CENTER,
          children: [new Paragraph({ style: header ? 'TableHeading' : 'TableText', children: [new TextRun(text)] })],
        });
      out.push(
        new Table({
          style: 'TableGrid',
          width: { size: TEXT_WIDTH, type: WidthType.DXA },
          columnWidths: sign,
          layout: TableLayoutType.FIXED,
          borders: gridBorders(),
          margins: { top: 40, bottom: 40, left: 90, right: 90 },
          rows: [
            new TableRow({
              tableHeader: true,
              cantSplit: true,
              children: [this.L('name'), this.L('role'), this.L('signature'), this.L('date')].map((h, i) => cell(h, i, true)),
            }),
            // empty signature and date cells, tall enough to sign in
            ...signers.map(
              ([name, role]) =>
                new TableRow({ cantSplit: true, height: { value: 850, rule: HeightRule.ATLEAST }, children: [cell(name, 0), cell(role, 1), cell('', 2), cell('', 3)] }),
            ),
          ],
        }),
      );
    }
    return out;
  }

  tableOfContents(): FileChild[] {
    const levels = this.doc.blocks.flatMap((b) => (b.kind === 'heading' && b.toc ? [b.level - 1] : []));
    const range = levels.length ? `${Math.min(...levels)}-${Math.max(...levels)}` : '1-1';
    return [
      new Paragraph({ style: 'TOCHeading', pageBreakBefore: true, children: [new TextRun(this.L('toc'))] }),
      new TableOfContents(this.L('toc'), { hyperlink: true, headingStyleRange: range }),
    ];
  }

  // ---- body ----

  /**
   * Blocks that go on a landscape page: wide figures, tables whose words do not fit portrait A4 (tableLayout), the
   * headings right before them and the notes right after the figures.
   */
  private landscapeBlocks(tables: Map<Block, TableLayout>): Set<Block> {
    const blocks = this.doc.blocks;
    const out = new Set<Block>();
    blocks.forEach((b, i) => {
      const wide = b.kind === 'figure' ? this.figures.get(b)?.landscape : b.kind === 'table' ? tables.get(b)?.landscape : false;
      if (!wide) return;
      out.add(b);
      for (let j = i - 1; j >= 0 && blocks[j]!.kind === 'heading'; j--) out.add(blocks[j]!);
      if (b.kind === 'figure' && blocks[i + 1]?.kind === 'mermaid') out.add(blocks[i + 1]!);
    });
    return out;
  }

  /**
   * The numbered sections, as runs of portrait and landscape pages: each becomes a Word section (a section break starts
   * a new page), so a wide diagram is printed larger, and a wide table without broken words, on a landscape page. The
   * first run is always portrait (the front matter goes before it), even when it has no blocks.
   */
  body(): Array<{ landscape: boolean; children: FileChild[] }> {
    const tables = new Map<Block, TableLayout>();
    for (const b of this.doc.blocks) if (b.kind === 'table') tables.set(b, tableLayout(tableColumns(b.headers, b.rows)));
    const landscape = this.landscapeBlocks(tables);
    let out: FileChild[] = [];
    const parts: Array<{ landscape: boolean; children: FileChild[] }> = [{ landscape: false, children: out }];
    let first = true;
    this.doc.blocks.forEach((b, i) => {
      const wide = landscape.has(b);
      if (parts[parts.length - 1]!.landscape !== wide) {
        out = [];
        parts.push({ landscape: wide, children: out });
      }
      const next = this.doc.blocks[i + 1];
      switch (b.kind) {
        case 'heading':
          out.push(
            new Paragraph({
              heading: HEADINGS[b.level - 2],
              // the first section starts on a new page (after the table of contents); a landscape page is a new page anyway
              pageBreakBefore: (first && !wide) || undefined,
              children: [new Bookmark({ id: this.headingBookmarks.get(b)!, children: [new TextRun(b.text)] })],
            }),
          );
          first = false;
          break;
        case 'markdown':
          // a label ("Contoh Response:") stays with the code block, list or table it introduces
          out.push(...this.markdown(b.text, next?.kind === 'code' || next?.kind === 'list' || next?.kind === 'table'));
          break;
        case 'list':
          out.push(...this.simpleList(b.items, Boolean(b.ordered)));
          break;
        case 'table':
          out.push(this.textTable(b.headers, b.rows, tables.get(b)), new Paragraph({ style: 'AfterTable' }));
          break;
        case 'figure': {
          const image = this.figures.get(b)!;
          out.push(
            new Paragraph({
              style: 'Figure',
              children: [
                new ImageRun({
                  type: 'svg',
                  data: image.svg,
                  fallback: { type: 'png', data: image.png },
                  transformation: { width: image.width, height: image.height },
                  altText: { name: b.diagram.fileName, title: b.caption, description: `${this.L('figure')} ${b.number}: ${b.caption}` },
                }),
              ],
            }),
            new Paragraph({
              style: 'Caption',
              children: [
                new TextRun(`${this.L('figure')} `),
                fieldRun(`SEQ ${this.L('figure')} \\* ARABIC`, String(b.number)),
                new TextRun(`: ${b.caption}`),
              ],
            }),
          );
          break;
        }
        case 'code':
          out.push(this.code(b.text));
          break;
        case 'mermaid':
          // the diagram itself is the figure above; Word gets a pointer to the source instead of the source
          out.push(new Paragraph({ style: 'Note', children: [new TextRun(`${b.summary}: ${this.L('mermaidElsewhere')}.`)] }));
          break;
      }
    });
    out.push(new Paragraph({ style: 'Note', alignment: AlignmentType.CENTER, border: { top: line(C.border, 4, 8) }, spacing: { before: 480 }, children: [new TextRun(this.L('generatedBy'))] }));
    return parts;
  }

  // ---- header & footer ----

  header(width = TEXT_WIDTH): Header {
    const title = this.doc.title.length > 90 ? `${this.doc.title.slice(0, 87)}...` : this.doc.title;
    return new Header({
      children: [
        new Paragraph({
          style: 'Header',
          tabStops: [{ type: TabStopType.RIGHT, position: width }],
          children: [new TextRun(title), new TextRun({ children: [new Tab(), this.doc.info.documentId ?? ''] })],
        }),
      ],
    });
  }

  footer(width = TEXT_WIDTH): Footer {
    const parts = this.L('pageOf')
      .split(/(\{page\}|\{pages\})/)
      .filter(Boolean)
      .map((p) => (p === '{page}' ? PageNumber.CURRENT : p === '{pages}' ? PageNumber.TOTAL_PAGES : p));
    return new Footer({
      children: [
        new Paragraph({
          style: 'Footer',
          tabStops: [{ type: TabStopType.RIGHT, position: width }],
          children: [
            new TextRun(`${this.L('version')} ${this.doc.info.version} \u00b7 ${this.doc.info.status}`),
            new TextRun({ children: [new Tab(), ...parts] }),
          ],
        }),
      ],
    });
  }
}

/**
 * A field with its result already written, such as the caption number `SEQ Gambar \* ARABIC` -> "1": Word can renumber
 * it (and build a table of figures from it), while LibreOffice and readers that ignore fields still show the number.
 */
function fieldRun(instruction: string, result: string): ParagraphChild {
  const el = (name: string, attrs?: Record<string, string>, text?: string) => {
    const c = new ImportedXmlComponent(name, attrs);
    if (text !== undefined) c.push(text);
    return c;
  };
  const run = el('w:r');
  run.push(el('w:fldChar', { 'w:fldCharType': 'begin' }));
  run.push(el('w:instrText', { 'xml:space': 'preserve' }, ` ${instruction} `));
  run.push(el('w:fldChar', { 'w:fldCharType': 'separate' }));
  run.push(el('w:t', { 'xml:space': 'preserve' }, result));
  run.push(el('w:fldChar', { 'w:fldCharType': 'end' }));
  // a plain run element; docx's ParagraphChild union does not list imported XML
  return run as unknown as ParagraphChild;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function listIndent(depth: number) {
  return { left: 360 * (depth + 1), hanging: 360 };
}

function bulletLevels(): ILevelsOptions[] {
  return Array.from({ length: 9 }, (_, level) => ({
    level,
    format: LevelFormat.BULLET,
    text: level % 2 === 0 ? '\u2022' : '\u2013',
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: listIndent(level) } },
  }));
}

function gridBorders() {
  const l = line(C.border);
  return { top: l, bottom: l, left: l, right: l, insideHorizontal: l, insideVertical: l };
}

// ---- styles ----------------------------------------------------------------------------------

/**
 * Word's own "Table Grid" table style, so the tables carry a familiar style name a client's template can redefine.
 * docx has no table styles, and giving it `importedStyles` would drop its default Title/Heading styles, so the style is
 * added to styles.xml after packing.
 */
const TABLE_GRID_STYLE =
  '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/>' +
  '<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`).join('') +
  '</w:tblBorders></w:tblPr></w:style>';

const APP_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
  '<Application>SOLAR AI AGENT</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><LinksUpToDate>false</LinksUpToDate>' +
  '<SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged></Properties>';

/** Adds what docx cannot write: the Table Grid style and the application name (docProps/app.xml). */
function finishPackage(buffer: Buffer): Buffer {
  const files = unzipSync(new Uint8Array(buffer));
  const styles = files['word/styles.xml'];
  if (styles) files['word/styles.xml'] = strToU8(strFromU8(styles).replace('</w:styles>', `${TABLE_GRID_STYLE}</w:styles>`));
  files['docProps/app.xml'] = strToU8(APP_XML);
  return Buffer.from(zipSync(files, { level: 6 }));
}

function styles(lang: 'id' | 'en') {
  const keep = { keepNext: true, keepLines: true };
  return {
    default: {
      document: {
        run: { font: FONT, size: 22, color: C.text, language: { value: lang === 'id' ? 'id-ID' : 'en-US' } },
        paragraph: { spacing: { after: 120, line: 276, lineRule: LineRuleType.AUTO } },
      },
      title: { run: { font: FONT, size: 52, bold: true, color: C.primary }, paragraph: { spacing: { after: 120, line: 240, lineRule: LineRuleType.AUTO } } },
      heading1: {
        run: { font: FONT, size: 32, bold: true, color: C.primary },
        paragraph: { ...keep, spacing: { before: 480, after: 160, line: 240, lineRule: LineRuleType.AUTO }, border: { bottom: line(C.primary, 6, 4) } },
      },
      heading2: { run: { font: FONT, size: 26, bold: true, color: C.accent }, paragraph: { ...keep, spacing: { before: 320, after: 120, line: 240, lineRule: LineRuleType.AUTO } } },
      heading3: { run: { font: FONT, size: 23, bold: true, color: C.primary }, paragraph: { ...keep, spacing: { before: 240, after: 80, line: 240, lineRule: LineRuleType.AUTO } } },
      heading4: { run: { font: FONT, size: 22, bold: true, italics: true, color: C.text }, paragraph: { ...keep, spacing: { before: 200, after: 60 } } },
      heading5: { run: { font: FONT, size: 22, bold: true, color: C.muted }, paragraph: { ...keep, spacing: { before: 160, after: 60 } } },
      heading6: { run: { font: FONT, size: 22, italics: true, color: C.muted }, paragraph: { ...keep, spacing: { before: 160, after: 60 } } },
      listParagraph: { paragraph: { spacing: { after: 60 } } },
      hyperlink: { run: { color: C.link, underline: { type: UnderlineType.SINGLE } } },
    },
    paragraphStyles: [
      { id: 'Subtitle', name: 'Subtitle', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 30, color: C.accent }, paragraph: { spacing: { after: 1200 } } },
      { id: 'CoverLabel', name: 'Cover Label', basedOn: 'Normal', run: { size: 20, color: C.muted }, paragraph: { spacing: { after: 0, line: 240, lineRule: LineRuleType.AUTO } } },
      { id: 'CoverValue', name: 'Cover Value', basedOn: 'Normal', run: { size: 22, bold: true, color: C.text }, paragraph: { spacing: { after: 0, line: 240, lineRule: LineRuleType.AUTO } } },
      {
        id: 'FrontHeading',
        name: 'Front Matter Heading',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { size: 32, bold: true, color: C.primary },
        paragraph: { keepNext: true, spacing: { before: 0, after: 200, line: 240, lineRule: LineRuleType.AUTO }, border: { bottom: line(C.primary, 6, 4) } },
      },
      { id: 'FrontSubheading', name: 'Front Matter Subheading', basedOn: 'Normal', next: 'Normal', run: { size: 24, bold: true, color: C.primary }, paragraph: { keepNext: true, spacing: { before: 360, after: 120 } } },
      { id: 'TOCHeading', name: 'TOC Heading', basedOn: 'FrontHeading', next: 'Normal', uiPriority: 39 },
      { id: 'TOC1', name: 'toc 1', basedOn: 'Normal', next: 'Normal', uiPriority: 39, run: { size: 22 }, paragraph: { spacing: { before: 60, after: 60 } } },
      { id: 'TOC2', name: 'toc 2', basedOn: 'Normal', next: 'Normal', uiPriority: 39, paragraph: { indent: { left: 220 }, spacing: { after: 40 } } },
      { id: 'TOC3', name: 'toc 3', basedOn: 'Normal', next: 'Normal', uiPriority: 39, paragraph: { indent: { left: 440 }, spacing: { after: 40 } } },
      { id: 'Caption', name: 'caption', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 18, italics: true, color: C.muted }, paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 60, after: 240 } } },
      { id: 'Figure', name: 'Figure', basedOn: 'Normal', next: 'Caption', paragraph: { alignment: AlignmentType.CENTER, keepNext: true, keepLines: true, spacing: { before: 160, after: 0, line: 240, lineRule: LineRuleType.AUTO } } },
      {
        id: 'Quote',
        name: 'Quote',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { italics: true, color: '404040' },
        paragraph: { indent: { left: 284 }, border: { left: line(C.accent, 18, 8) } },
      },
      {
        id: 'CodeBlock',
        name: 'Code Block',
        basedOn: 'Normal',
        next: 'Normal',
        // code is not prose: no spelling or grammar marks on keys and commands
        run: { font: MONO, size: 17, color: '24292F', noProof: true },
        paragraph: {
          spacing: { before: 60, after: 200, line: 240, lineRule: LineRuleType.AUTO },
          indent: { left: 113, right: 113 },
          shading: solid(C.codeFill),
          border: { top: line(C.codeBorder, 4, 4), bottom: line(C.codeBorder, 4, 4), left: line(C.codeBorder, 4, 4), right: line(C.codeBorder, 4, 4) },
        },
      },
      { id: 'TableText', name: 'Table Text', basedOn: 'Normal', run: { size: 19 }, paragraph: { spacing: { before: 0, after: 0, line: 252, lineRule: LineRuleType.AUTO } } },
      { id: 'TableHeading', name: 'Table Heading', basedOn: 'TableText', run: { bold: true, color: 'FFFFFF' }, paragraph: { keepNext: true } },
      { id: 'TableTextSmall', name: 'Table Text Small', basedOn: 'TableText', run: { size: 17 } },
      { id: 'TableHeadingSmall', name: 'Table Heading Small', basedOn: 'TableHeading', run: { size: 17 } },
      { id: 'AfterTable', name: 'After Table', basedOn: 'Normal', next: 'Normal', run: { size: 8 }, paragraph: { spacing: { before: 0, after: 120, line: 240, lineRule: LineRuleType.AUTO } } },
      { id: 'Header', name: 'header', basedOn: 'Normal', run: { size: 17, color: C.muted }, paragraph: { spacing: { after: 0, line: 240, lineRule: LineRuleType.AUTO }, border: { bottom: line(C.border, 4, 4) } } },
      { id: 'Footer', name: 'footer', basedOn: 'Normal', run: { size: 17, color: C.muted }, paragraph: { spacing: { after: 0, line: 240, lineRule: LineRuleType.AUTO }, border: { top: line(C.border, 4, 4) } } },
      { id: 'Note', name: 'Note', basedOn: 'Normal', next: 'Normal', run: { size: 18, italics: true, color: C.muted }, paragraph: { spacing: { after: 160 } } },
    ],
    characterStyles: [
      { id: 'InlineCode', name: 'Inline Code', basedOn: 'DefaultParagraphFont', run: { font: MONO, size: 19, color: '24292F', shading: solid(C.inlineCodeFill), noProof: true } },
    ],
  };
}

// ---- entry point -----------------------------------------------------------------------------

/**
 * Text the page layout (docx/layout) would take too long on: it measures an unbroken run of characters (a long token,
 * URL or base64 line) about one character at a time, so a few thousand of them take seconds, and very long documents
 * take seconds too. Such a document is written with the page numbers left to Word instead.
 */
export const LAYOUT_LIMITS = { longestRun: 400, characters: 400_000 };

function blockTexts(doc: BuiltDocument): string[] {
  const texts = [doc.title, ...doc.meta.flat(), ...doc.revisions.flat()];
  for (const b of doc.blocks) {
    if (b.kind === 'heading' || b.kind === 'markdown' || b.kind === 'code' || b.kind === 'mermaid') texts.push(b.text);
    else if (b.kind === 'list') texts.push(...b.items);
    else if (b.kind === 'table') texts.push(...b.headers, ...b.rows.flat());
    else texts.push(b.caption);
  }
  return texts;
}

/** Whether laying the pages out is affordable (see LAYOUT_LIMITS). */
export function layoutAffordable(doc: BuiltDocument): boolean {
  let characters = 0;
  for (const text of blockTexts(doc)) {
    characters += text.length;
    if (characters > LAYOUT_LIMITS.characters) return false;
    for (const run of text.matchAll(/\S+/g)) if (run[0].length > LAYOUT_LIMITS.longestRun) return false;
  }
  return true;
}

/**
 * Renders the Word delivery document. Diagrams are embedded as SVG (vector, Word 2016+/365) with a PNG fallback drawn
 * by resvg (older Word, LibreOffice, Google Docs, WPS); a wide diagram gets a landscape page of its own.
 *
 * Table of contents: a real TOC field with one hyperlinked entry per numbered section. Its page numbers (and the page
 * count of the footer) are estimated by laying the pages out as Word does (docx/layout) and written into the file, so it
 * is complete when the file opens and Word does not ask to update fields. They are an estimate: on long documents a
 * heading can land one page off where a block only just fits at the bottom of a page; Word's "Update Table" (and the
 * footer's own PAGE/NUMPAGES fields) give the exact numbers. When that layout cannot place every section, or the
 * document is too long for it (layoutAffordable), the file is written with `updateFields` on instead, so Word fills
 * the page numbers in when it opens the file.
 *
 * This is synchronous, CPU-heavy work (about 2 s for 80 requirements): the server runs it in a worker thread
 * (renderTechSpecDocxIsolated).
 */
export async function renderTechSpecDocx(input: BuiltDocument, options: DocxRenderOptions = {}): Promise<DocxRenderResult> {
  const doc = cleanDeep(input);
  const warnings: string[] = [];
  const figures = new Map<Block, FigureImage>();
  const contexts = figureContexts(doc.blocks);
  for (const b of doc.blocks) if (b.kind === 'figure') figures.set(b, await prepareFigure(b, contexts.get(b)!, warnings, options.warningLanguage ?? 'en'));

  const L = (key: StringKey) => t(doc.lang, key);
  const summary = markdownToPlain(doc.info.summary);
  const margin = { top: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, right: PAGE.margin, header: PAGE.header, footer: PAGE.footer };
  const build = (features: { pageNumbers?: PageNumberEstimator; updateFields: boolean }) => {
    const w = new Writer(doc, figures);
    const front = [...w.cover(), ...w.documentControl(), ...w.tableOfContents()];
    const sections = w.body().map((part, i) => {
      const width = part.landscape ? LANDSCAPE_TEXT_WIDTH : TEXT_WIDTH;
      const orientation = part.landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT;
      return {
        // the first section starts with the cover page, which has neither header nor footer (a header part still needs
        // one, empty, paragraph); the page numbers run on through the sections
        properties: { titlePage: i === 0, page: { size: { width: PAGE.width, height: PAGE.height, orientation }, margin } },
        headers: i === 0 ? { default: w.header(width), first: new Header({ children: [new Paragraph({})] }) } : { default: w.header(width) },
        footers: i === 0 ? { default: w.footer(width), first: new Footer({ children: [new Paragraph({})] }) } : { default: w.footer(width) },
        children: i === 0 ? [...front, ...part.children] : part.children,
      };
    });
    return {
      writer: w,
      document: new Document({
        title: doc.title,
        subject: L('documentSubtitle'),
        creator: doc.info.authors.join('; '),
        lastModifiedBy: doc.info.authors[0] ?? 'SOLAR AI AGENT',
        description: summary.length > 1000 ? `${summary.slice(0, 997)}...` : summary,
        keywords: ['TSD', L('documentSubtitle'), doc.info.documentId, `${L('version')} ${doc.info.version}`, doc.info.status].filter(Boolean).join('; '),
        revision: 1,
        customProperties: [
          { name: 'Document ID', value: doc.info.documentId ?? '' },
          { name: 'Version', value: doc.info.version },
          { name: 'Status', value: doc.info.status },
        ],
        features: { updateFields: features.updateFields },
        pageNumbers: features.pageNumbers,
        styles: styles(doc.lang),
        numbering: w.numberingConfig(),
        sections,
      }),
    };
  };

  if (options.pageNumbers !== false && layoutAffordable(doc)) {
    let complete = true;
    let wanted: string[] = [];
    const estimator: PageNumberEstimator = (body, context) => {
      try {
        const result = estimatePageNumbers(body, context);
        if (result.pageCount === undefined || wanted.some((b) => !result.bookmarks.has(b))) complete = false;
        return result;
      } catch {
        complete = false;
        return { bookmarks: new Map() };
      }
    };
    try {
      const { writer, document } = build({ pageNumbers: estimator, updateFields: false });
      wanted = writer.tocBookmarks();
      const buffer = await Packer.toBuffer(document);
      if (complete) return { buffer: finishPackage(buffer), warnings };
    } catch {
      // written again below without the page layout
    }
  }
  const buffer = await Packer.toBuffer(build({ updateFields: true }).document);
  return { buffer: finishPackage(buffer), warnings };
}
