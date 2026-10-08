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
}

// ---- page & look ---------------------------------------------------------------------

/** A4 with 2.5 cm margins, in twips. */
const PAGE = { width: 11906, height: 16838, margin: 1418, header: 709, footer: 709 };
const TEXT_WIDTH = PAGE.width - 2 * PAGE.margin;
const TWIPS_PER_PX = 15;
/** Largest image on the page in CSS pixels (96 dpi): the text width, and a height that leaves room for the caption. */
const MAX_IMAGE_WIDTH = Math.floor(TEXT_WIDTH / TWIPS_PER_PX);
const MAX_IMAGE_HEIGHT = 820;
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
}

/** Office's SVG renderer is safest with fill/stroke + *-opacity than with rgba() colours. */
function svgForWord(svg: string): string {
  const hex = (v: string) => Math.max(0, Math.min(255, Number(v))).toString(16).padStart(2, '0');
  return svg.replace(
    /\b(fill|stroke)="rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)"/g,
    (_m, prop: string, r: string, g: string, b: string, a: string) => `${prop}="#${hex(r)}${hex(g)}${hex(b)}" ${prop}-opacity="${a}"`,
  );
}

async function prepareFigure(block: Extract<Block, { kind: 'figure' }>, warnings: string[]): Promise<FigureImage> {
  const svg = svgForWord(block.diagram.svg.replace(/^\uFEFF/, ''));
  const natural = svgSize(svg);
  if (!natural) warnings.push(`Diagram ${block.diagram.fileName}: the SVG has no width/height, it is shown at 800x600`);
  const size = natural ?? { width: 800, height: 600 };
  const scale = Math.min(1, MAX_IMAGE_WIDTH / size.width, MAX_IMAGE_HEIGHT / size.height);
  const width = Math.max(1, Math.round(size.width * scale));
  const height = Math.max(1, Math.round(size.height * scale));
  let png: Buffer;
  try {
    png = (await rasterizeSvg(svg, width * RASTER_SCALE)).png;
  } catch (err) {
    warnings.push(
      `Diagram ${block.diagram.fileName}: the PNG fallback could not be drawn (${err instanceof Error ? err.message : String(err)}); Word 2016+ shows the SVG, older viewers a grey placeholder`,
    );
    png = placeholderPng(Math.min(width, 480), Math.min(height, 480));
  }
  return { svg: Buffer.from(svg, 'utf8'), png, width, height };
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

/**
 * Column widths (twips) from the content: every column gets room for its longest word (header words are bold), the rest
 * of the width goes to the columns with more text, so id columns stay narrow and prose columns get the room.
 * `charWidth` is the average width of a character of the table text in twips.
 */
export function columnWidths(columns: string[][], total = TEXT_WIDTH, charWidth = 100): number[] {
  const PADDING = 2 * 90 + 40;
  const words = (text: string) => text.split(/[\s/]+/).map((w) => w.length);
  const needs = columns.map((cells) => {
    const [header = '', ...body] = cells.map((c) => c.replace(/\s+/g, ' ').trim());
    const longestWord = Math.min(18, Math.max(1, ...words(header).map((n) => n * 1.1), ...body.flatMap(words)));
    const lengths = body.map((c) => c.length).sort((x, y) => x - y);
    const typical = lengths.length ? lengths[Math.min(lengths.length - 1, Math.ceil((lengths.length - 1) * 0.8))]! : header.length;
    const min = Math.ceil(longestWord * charWidth + PADDING);
    return { min, preferred: Math.max(min, Math.min(typical, 60) * charWidth + PADDING) };
  });
  const minSum = needs.reduce((a, n) => a + n.min, 0);
  const prefSum = needs.reduce((a, n) => a + n.preferred, 0);
  let widths: number[];
  if (prefSum <= total) widths = needs.map((n) => (n.preferred / prefSum) * total);
  else if (minSum >= total) widths = needs.map((n) => (n.min / minSum) * total);
  else {
    const extra = prefSum - minSum || 1;
    widths = needs.map((n) => n.min + ((n.preferred - n.min) / extra) * (total - minSum));
  }
  const rounded = widths.map((w) => Math.floor(w));
  rounded[rounded.indexOf(Math.max(...rounded))]! += total - rounded.reduce((a, w) => a + w, 0);
  return rounded;
}

const MARKED = { gfm: true, breaks: false };

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
          if (/^(https?:|mailto:)/i.test(href)) {
            out.push(new ExternalHyperlink({ link: href, children: this.inline(tok.tokens, { ...fmt, link: true }) }));
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

  markdown(text: string): FileChild[] {
    return this.blocks(Lexer.lex(text, MARKED), { depth: 0 });
  }

  private blocks(tokens: Token[], ctx: { depth: number; quote?: boolean }): FileChild[] {
    const out: FileChild[] = [];
    for (const token of tokens) {
      switch (token.type) {
        case 'paragraph':
        case 'text': {
          const tok = token as Tokens.Paragraph | Tokens.Text;
          out.push(new Paragraph({ style: ctx.quote ? 'Quote' : undefined, children: tok.tokens ? this.inline(tok.tokens) : this.inlineText(tok.text) }));
          break;
        }
        case 'heading': {
          // headings inside Markdown sit below the document's own three levels and stay out of the table of contents
          const tok = token as Tokens.Heading;
          out.push(new Paragraph({ heading: HEADINGS[Math.min(3 + tok.depth, 6) - 1], children: this.inline(tok.tokens) }));
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

  table(
    headers: Array<{ text: string; children: ParagraphChild[] }>,
    rows: Array<Array<{ text: string; children: ParagraphChild[] }>>,
    align: Align[] = [],
  ): Table {
    const cols = headers.length;
    // wide tables (e.g. the integration catalogue) use a smaller table font so the columns fit portrait A4
    const small = cols >= 7;
    const widths = columnWidths(
      headers.map((h, i) => [h.text, ...rows.map((r) => markdownToPlain(r[i]?.text ?? ''))]),
      TEXT_WIDTH,
      small ? 88 : 100,
    );
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
      width: { size: TEXT_WIDTH, type: WidthType.DXA },
      columnWidths: widths,
      layout: TableLayoutType.FIXED,
      borders: gridBorders(),
      margins: { top: 40, bottom: 40, left: 90, right: 90 },
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

  textTable(headers: string[], rows: string[][]): Table {
    return this.table(
      headers.map((h) => ({ text: h, children: [new TextRun(h)] })),
      rows.map((r) => r.map((c) => ({ text: c, children: this.inlineText(c) }))),
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
    const { info } = this.doc;
    const out: FileChild[] = [];
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
                new TableCell({ width: { size: widths[1]!, type: WidthType.DXA }, children: [new Paragraph({ style: 'TableText', children: this.inlineText(value) })] }),
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

  body(): FileChild[] {
    const out: FileChild[] = [];
    let first = true;
    for (const b of this.doc.blocks) {
      switch (b.kind) {
        case 'heading':
          out.push(
            new Paragraph({
              heading: HEADINGS[b.level - 2],
              pageBreakBefore: first || undefined,
              children: [new Bookmark({ id: this.headingBookmarks.get(b)!, children: [new TextRun(b.text)] })],
            }),
          );
          first = false;
          break;
        case 'markdown':
          out.push(...this.markdown(b.text));
          break;
        case 'list':
          out.push(...this.simpleList(b.items, Boolean(b.ordered)));
          break;
        case 'table':
          out.push(this.textTable(b.headers, b.rows), new Paragraph({ style: 'AfterTable' }));
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
    }
    out.push(new Paragraph({ style: 'Note', alignment: AlignmentType.CENTER, border: { top: line(C.border, 4, 8) }, spacing: { before: 480 }, children: [new TextRun(this.L('generatedBy'))] }));
    return out;
  }

  // ---- header & footer ----

  header(): Header {
    const title = this.doc.title.length > 90 ? `${this.doc.title.slice(0, 87)}...` : this.doc.title;
    return new Header({
      children: [
        new Paragraph({
          style: 'Header',
          tabStops: [{ type: TabStopType.RIGHT, position: TEXT_WIDTH }],
          children: [new TextRun(title), new TextRun({ children: [new Tab(), this.doc.info.documentId ?? ''] })],
        }),
      ],
    });
  }

  footer(): Footer {
    const parts = this.L('pageOf')
      .split(/(\{page\}|\{pages\})/)
      .filter(Boolean)
      .map((p) => (p === '{page}' ? PageNumber.CURRENT : p === '{pages}' ? PageNumber.TOTAL_PAGES : p));
    return new Footer({
      children: [
        new Paragraph({
          style: 'Footer',
          tabStops: [{ type: TabStopType.RIGHT, position: TEXT_WIDTH }],
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
        run: { font: MONO, size: 17, color: '24292F' },
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
      { id: 'InlineCode', name: 'Inline Code', basedOn: 'DefaultParagraphFont', run: { font: MONO, size: 19, color: '24292F', shading: solid(C.inlineCodeFill) } },
    ],
  };
}

// ---- entry point -----------------------------------------------------------------------------

/**
 * Renders the Word delivery document. Diagrams are embedded as SVG (vector, Word 2016+/365) with a PNG fallback drawn
 * by resvg (older Word, LibreOffice, Google Docs, WPS).
 *
 * Table of contents: a real TOC field with one hyperlinked entry per numbered section, written with the page numbers
 * (and the page count of the footer) worked out by laying the pages out as Word does, so it is complete when the file
 * opens and Word does not ask to update fields. When that layout cannot place every section (e.g. text in a font it
 * cannot measure), the file is written again with `updateFields` on, so Word refreshes the page numbers when it opens.
 */
export async function renderTechSpecDocx(input: BuiltDocument, options: DocxRenderOptions = {}): Promise<DocxRenderResult> {
  const doc = cleanDeep(input);
  const warnings: string[] = [];
  const figures = new Map<Block, FigureImage>();
  for (const b of doc.blocks) if (b.kind === 'figure') figures.set(b, await prepareFigure(b, warnings));

  const L = (key: StringKey) => t(doc.lang, key);
  const summary = markdownToPlain(doc.info.summary);
  const build = (features: { pageNumbers?: PageNumberEstimator; updateFields: boolean }) => {
    const w = new Writer(doc, figures);
    const children = [...w.cover(), ...w.documentControl(), ...w.tableOfContents(), ...w.body()];
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
        sections: [
          {
            properties: {
              titlePage: true,
              page: {
                size: { width: PAGE.width, height: PAGE.height },
                margin: { top: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, right: PAGE.margin, header: PAGE.header, footer: PAGE.footer },
              },
            },
            // the cover page has neither header nor footer (a header part still needs one, empty, paragraph)
            headers: { default: w.header(), first: new Header({ children: [new Paragraph({})] }) },
            footers: { default: w.footer(), first: new Footer({ children: [new Paragraph({})] }) },
            children,
          },
        ],
      }),
    };
  };

  if (options.pageNumbers !== false) {
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
