/**
 * Excel (.xlsx/.xlsm) → Markdown with a streaming reader: worksheets are inflated and scanned incrementally, so only
 * the rows that are shown (row/column caps) are parsed, and shared strings are read only up to the highest index used.
 */
import { decodeOoxmlText, decodeXml, fmtInt, MB, mdCell, mdTable, parseAttrs, yieldToLoop } from './limits.js';
import { documentError, type ParseContext, type ParsedDocument } from './types.js';
import { dirOf, parseRels, relsPathOf, resolvePart, type OoxmlPackage, type Relationship, type ZipArchive } from './zip.js';

/** Optional namespace prefix in element names. */
const P = '(?:[A-Za-z_][\\w.-]*:)?';

function colIndex(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c >= 65 && c <= 90) n = n * 26 + (c - 64);
    else if (c >= 97 && c <= 122) n = n * 26 + (c - 96);
    else break;
  }
  return n - 1;
}

const BUILTIN_NUMFMT: Record<number, string> = {
  9: '0%',
  10: '0.00%',
  14: 'yyyy-mm-dd',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'yyyy-mm-dd h:mm',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mm:ss.0',
};
for (let i = 27; i <= 36; i++) BUILTIN_NUMFMT[i] = 'yyyy-mm-dd';
for (let i = 50; i <= 58; i++) BUILTIN_NUMFMT[i] = 'yyyy-mm-dd';

type NumFormat = { type: 'date'; date: boolean; time: boolean; seconds: boolean } | { type: 'percent'; decimals: number } | null;

export function analyzeNumFmt(code: string): NumFormat {
  if (!code) return null;
  const section = code.split(';')[0]!;
  const stripped = section
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[(?!h\]|hh\]|m\]|mm\]|s\]|ss\])[^\]]*\]/gi, '');
  if (/^general$/i.test(stripped.trim())) return null;
  const hasY = /y/i.test(stripped);
  const hasD = /d/i.test(stripped);
  const hasH = /h/i.test(stripped);
  const hasS = /s/i.test(stripped);
  const hasM = /m/i.test(stripped);
  if (hasY || hasD || hasH || hasS || (hasM && !/[0#?]/.test(stripped))) {
    return { type: 'date', date: hasY || hasD || (hasM && !hasH && !hasS), time: hasH || hasS, seconds: hasS };
  }
  if (stripped.includes('%')) {
    const m = /\.([0#?]+)/.exec(stripped);
    return { type: 'percent', decimals: m ? m[1]!.length : 0 };
  }
  return null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function formatSerialDate(serial: number, fmt: { date: boolean; time: boolean; seconds: boolean }, date1904: boolean): string {
  if (!Number.isFinite(serial)) return String(serial);
  let days = serial;
  if (date1904) days += 1462;
  else if (days < 60) days += 1; // Excel's fictitious 1900-02-29
  const d = new Date(Math.round((days - 25569) * 86400) * 1000);
  if (Number.isNaN(d.getTime())) return String(serial);
  const date = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  const time = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}${fmt.seconds ? `:${pad2(d.getUTCSeconds())}` : ''}`;
  if (fmt.date && fmt.time) return `${date} ${time}`;
  if (fmt.time && !fmt.date) return serial >= 1 ? `${date} ${time}` : time;
  return date;
}

function cleanNumber(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(15)));
}

/** Text of a rich/inline string: its <t> runs, without phonetic runs (<rPh>). */
function siText(xml: string): string {
  const noPhonetic = xml.includes('rPh') ? xml.replace(new RegExp(`<${P}rPh\\b[\\s\\S]*?<\\/${P}rPh>`, 'g'), '') : xml;
  let out = '';
  for (const m of noPhonetic.matchAll(new RegExp(`<${P}t(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${P}t>`, 'g'))) out += m[1];
  return decodeOoxmlText(out);
}

type Cell = { sst: number } | { text: string };

interface Sheet {
  name: string;
  state: string;
  rel: Relationship | undefined;
  path: string;
  kind: 'sheet' | 'dialog' | 'chart' | 'missing' | 'skipped';
  rows: Array<Cell[]>;
  truncatedRows: boolean;
  truncatedCols: boolean;
  /** Formula cells without a cached value. */
  noCache: string[];
  dimension?: string | null;
  scannedLastRow?: number;
  countComplete?: boolean;
}

export async function extractXlsx(ctx: ParseContext, zip: ZipArchive, pkg: OoxmlPackage): Promise<ParsedDocument> {
  const { limits, deadline, warnings, maxChars } = ctx;
  const wbPath = pkg.mainPart;
  const wbXml = zip.text(wbPath, 16 * MB);
  if (!wbXml) throw documentError('CORRUPT', 'File bukan workbook Excel yang valid (xl/workbook.xml tidak ada).');
  const date1904 = new RegExp(`<${P}workbookPr\\b[^>]*\\bdate1904="(1|true)"`).test(wbXml);
  const rels = parseRels(zip.text(relsPathOf(wbPath), 4 * MB));
  const relById = new Map(rels.map((r) => [r.id, r]));
  const sheets: Sheet[] = [];
  for (const m of wbXml.matchAll(new RegExp(`<${P}sheet\\b([^>]*?)\\/?>`, 'g'))) {
    const a = parseAttrs(m[1]);
    const rel = relById.get(a['r:id'] ?? a.id ?? '');
    sheets.push({
      name: a.name || `Sheet${sheets.length + 1}`,
      state: a.state || 'visible',
      rel,
      path: rel ? resolvePart(dirOf(wbPath), rel.target) : '',
      kind: 'missing',
      rows: [],
      truncatedRows: false,
      truncatedCols: false,
      noCache: [],
    });
  }
  if (!sheets.length) throw documentError('CORRUPT', 'File bukan workbook Excel yang valid (tidak berisi worksheet).');
  if (zip.names().some((n) => /vbaProject\.bin$/i.test(n))) warnings.push('Workbook berisi makro VBA; makro diabaikan (tidak pernah dijalankan).');

  // styles: cellXfs index -> number format
  const stylesRel = rels.find((r) => /\/styles$/.test(r.type));
  const stylesXml = stylesRel ? zip.text(resolvePart(dirOf(wbPath), stylesRel.target), 32 * MB) : null;
  const xfFormats: NumFormat[] = [];
  if (stylesXml) {
    const custom = new Map<number, string>();
    for (const m of stylesXml.matchAll(new RegExp(`<${P}numFmt\\b([^>]*?)\\/?>`, 'g'))) {
      const a = parseAttrs(m[1]);
      custom.set(Number(a.numFmtId), a.formatCode ?? '');
    }
    const cellXfs = new RegExp(`<${P}cellXfs\\b[^>]*>([\\s\\S]*?)<\\/${P}cellXfs>`).exec(stylesXml);
    if (cellXfs) {
      for (const m of cellXfs[1]!.matchAll(new RegExp(`<${P}xf\\b([^>]*?)\\/?>`, 'g'))) {
        const id = Number(parseAttrs(m[1]).numFmtId ?? 0);
        xfFormats.push(analyzeNumFmt(custom.get(id) ?? BUILTIN_NUMFMT[id] ?? ''));
      }
    }
  }

  const sheetLimit = Math.min(sheets.length, limits.maxSheets);
  if (sheets.length > limits.maxSheets) warnings.push(`Workbook dipotong: hanya ${limits.maxSheets} dari ${sheets.length} sheet pertama yang dibaca.`);
  let maxSst = -1;
  /** Rough size of the text read so far; later sheets are skipped once it passes maxChars. */
  let textChars = 0;
  let skippedForChars = 0;
  const rowRe = new RegExp(`<${P}row\\b([^>]*?)(\\/>|>([\\s\\S]*?)<\\/${P}row>)`, 'g');
  const cellRe = new RegExp(`<${P}c\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${P}c>)`, 'g');
  const vRe = new RegExp(`<${P}v(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${P}v>`);
  const fRe = new RegExp(`<${P}f(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${P}f>`);
  const isRe = new RegExp(`<${P}is\\b[^>]*>([\\s\\S]*?)<\\/${P}is>`);
  const endDataRe = new RegExp(`<\\/${P}sheetData>|<${P}sheetData\\s*\\/>`);
  const dimRe = new RegExp(`<${P}dimension\\b[^>]*\\bref="([^"]*)"`);
  const capText = (s: string) => (s.length > limits.maxCellChars ? `${s.slice(0, limits.maxCellChars)}…` : s);

  for (let si = 0; si < sheetLimit; si++) {
    const sh = sheets[si]!;
    if (!sh.rel || !zip.has(sh.path)) continue;
    if (/\/chartsheet$/.test(sh.rel.type)) {
      sh.kind = 'chart';
      continue;
    }
    if (textChars > maxChars) {
      sh.kind = 'skipped';
      skippedForChars += 1;
      continue;
    }
    sh.kind = /\/dialogsheet$/.test(sh.rel.type) ? 'dialog' : 'sheet';
    let buf = '';
    let done = false;
    let lastRow = -1;
    // After the row cap is hit, keep scanning cheaply (without parsing cells) to report the sheet's real row count
    // when it has no <dimension>, within a small time budget.
    let countMode = false;
    let countUntil = 0;
    const lastRowRe = new RegExp(`<${P}row\\b[^>]*?\\br="(\\d+)"`, 'g');
    const onText = (text: string): boolean => {
      if (countMode) {
        const s = buf + text;
        lastRowRe.lastIndex = 0;
        let m: RegExpExecArray | null;
        let last: string | null = null;
        while ((m = lastRowRe.exec(s))) last = m[1]!;
        if (last) sh.scannedLastRow = Math.max(sh.scannedLastRow ?? 0, parseInt(last, 10));
        buf = s.slice(-256);
        if (endDataRe.test(s)) {
          sh.countComplete = true;
          return false;
        }
        return Date.now() < countUntil && zip.inflatedTotal < limits.maxTotalInflatedBytes * 0.4;
      }
      buf += text;
      const lastEnd = buf.lastIndexOf('row>');
      if (sh.dimension === undefined) {
        const dm = dimRe.exec(buf);
        if (dm) sh.dimension = dm[1]!;
        else if (buf.includes('sheetData')) sh.dimension = null;
      }
      rowRe.lastIndex = 0;
      let consumed = 0;
      let m: RegExpExecArray | null;
      const scan = lastEnd >= 0 ? buf.slice(0, lastEnd + 4) : '';
      while ((m = rowRe.exec(scan))) {
        consumed = rowRe.lastIndex;
        const ra = parseAttrs(m[1]);
        const rowIndex = ra.r ? parseInt(ra.r, 10) - 1 : lastRow + 1;
        lastRow = rowIndex;
        if (!m[3]) continue;
        const cells: Cell[] = [];
        let lastCol = -1;
        let any = false;
        for (const c of m[3].matchAll(cellRe)) {
          const ca = parseAttrs(c[1]);
          const col = ca.r ? colIndex(ca.r) : lastCol + 1;
          lastCol = col;
          const inner = c[2] ?? '';
          const t = ca.t || 'n';
          const v = inner ? (vRe.exec(inner)?.[1] ?? null) : null;
          let cell: Cell | null = null;
          if (t === 's' && v != null) {
            const idx = parseInt(v, 10);
            if (idx >= 0) {
              cell = { sst: idx };
              if (idx > maxSst) maxSst = idx;
            }
          } else if (t === 'inlineStr') {
            const im = isRe.exec(inner);
            cell = { text: im ? siText(im[1]!) : '' };
          } else if (t === 'b' && v != null) cell = { text: v.trim() === '1' || v.trim() === 'true' ? 'TRUE' : 'FALSE' };
          else if (t === 'e' && v != null) cell = { text: decodeXml(v) };
          else if ((t === 'str' || t === 'd') && v != null) cell = { text: decodeOoxmlText(v) };
          else if (v != null && v !== '') {
            const fmt = ca.s ? xfFormats[parseInt(ca.s, 10)] : null;
            const num = Number(v);
            if (fmt?.type === 'date' && Number.isFinite(num)) cell = { text: formatSerialDate(num, fmt, date1904) };
            else if (fmt?.type === 'percent' && Number.isFinite(num)) cell = { text: `${cleanNumber((num * 100).toFixed(fmt.decimals))}%` };
            else cell = { text: cleanNumber(v) };
          } else {
            const fm = inner ? fRe.exec(inner) : null;
            if (fm && fm[1]!.trim()) {
              cell = { text: `=${decodeXml(fm[1])}` };
              sh.noCache.push(ca.r || `R${rowIndex + 1}C${col + 1}`);
            }
          }
          if (!cell || ('text' in cell && cell.text === '')) continue;
          if (col >= limits.maxColsPerSheet) {
            sh.truncatedCols = true;
            break;
          }
          if ('text' in cell) {
            cell.text = capText(cell.text);
            textChars += cell.text.length + 3;
          } else {
            textChars += 8;
          }
          cells[col] = cell;
          any = true;
        }
        if (!any) continue;
        if (sh.rows.length >= limits.maxRowsPerSheet) {
          sh.truncatedRows = true;
          done = true;
          break;
        }
        sh.rows.push(cells);
      }
      if (consumed) buf = buf.slice(consumed);
      if (done && sh.truncatedRows && !sh.dimension) {
        countMode = true;
        countUntil = Date.now() + Math.min(3000, deadline.remaining() / 4);
        sh.scannedLastRow = lastRow + 1;
        const rest = buf;
        buf = '';
        return onText(rest);
      }
      if (!done && endDataRe.test(buf)) done = true;
      if (!done && buf.length > 16 * MB) {
        throw documentError('TOO_LARGE', `File terlalu besar: satu baris di sheet "${sh.name}" melebihi 16 MB XML.`);
      }
      return !done;
    };
    zip.streamText(sh.path, onText, limits.maxTotalInflatedBytes, true);
    deadline.check();
    await yieldToLoop();
  }

  // shared strings: stream only as far as the highest index actually referenced
  const sst: string[] = [];
  if (maxSst >= 0) {
    const sstRel = rels.find((r) => /\/sharedStrings$/.test(r.type));
    const sstPath = sstRel ? resolvePart(dirOf(wbPath), sstRel.target) : 'xl/sharedStrings.xml';
    if (zip.has(sstPath)) {
      let buf = '';
      const siRe = new RegExp(`<${P}si\\b[^>]*?(?:\\/>|>([\\s\\S]*?)<\\/${P}si>)`, 'g');
      zip.streamText(
        sstPath,
        (text) => {
          buf += text;
          siRe.lastIndex = 0;
          let consumed = 0;
          let m: RegExpExecArray | null;
          while ((m = siRe.exec(buf))) {
            consumed = siRe.lastIndex;
            sst.push(capText(m[1] ? siText(m[1]) : ''));
            if (sst.length > maxSst) return false;
          }
          if (consumed) buf = buf.slice(consumed);
          if (buf.length > 16 * MB) throw documentError('TOO_LARGE', 'File terlalu besar: satu teks di shared strings melebihi 16 MB XML.');
          return true;
        },
        limits.maxTotalInflatedBytes,
        true,
      );
    } else {
      warnings.push('Workbook merujuk shared strings, tetapi xl/sharedStrings.xml tidak ada; sebagian sel tampil kosong.');
    }
  }

  const parts: string[] = [];
  for (let si = 0; si < sheets.length; si++) {
    const sh = sheets[si]!;
    parts.push(`## Sheet: ${sh.name}${sh.state !== 'visible' ? ' (hidden)' : ''}`);
    if (si >= sheetLimit) {
      parts.push('_(tidak dibaca: batas jumlah sheet tercapai)_');
      continue;
    }
    if (sh.kind === 'skipped') {
      parts.push('_(tidak dibaca: batas panjang teks tercapai)_');
      continue;
    }
    if (sh.kind === 'chart') {
      parts.push('_(sheet grafik — tidak ada data sel)_');
      continue;
    }
    if (sh.kind === 'missing') {
      parts.push('_(bagian sheet tidak ada)_');
      warnings.push(`Sheet "${sh.name}" tidak bisa dibaca (bagiannya tidak ada di file).`);
      continue;
    }
    const rows = sh.rows
      .map((cells) => Array.from({ length: cells.length }, (_, c) => {
        const cell = cells[c];
        if (!cell) return '';
        return 'sst' in cell ? (sst[cell.sst] ?? '') : cell.text;
      }))
      .filter((v) => v.some((x) => x !== ''));
    if (!rows.length) {
      parts.push('_(sheet kosong)_');
      warnings.push(`Sheet "${sh.name}" kosong.`);
      continue;
    }
    // trim leading/trailing all-empty columns
    let minC = Infinity;
    let maxC = -1;
    for (const r of rows) {
      r.forEach((v, i) => {
        if (v !== '') [minC, maxC] = [Math.min(minC, i), Math.max(maxC, i)];
      });
    }
    const width = maxC - minC + 1;
    const table = rows.map((r) => Array.from({ length: width }, (_, i) => r[minC + i] ?? ''));
    // leading single-cell rows (merged titles, captions) become text above the table
    if (width > 1) {
      while (table.length > 1 && table[0]!.filter((v) => v !== '').length === 1) {
        const caption = table.shift()!.find((v) => v !== '')!;
        parts.push(`**${mdCell(caption, limits.maxCellChars).replace(/\\\|/g, '|')}**`);
      }
    }
    parts.push(mdTable(table.map((r) => r.map((v) => mdCell(v, limits.maxCellChars)))));
    if (sh.truncatedRows) {
      let totalRows: number | null = null;
      const dm = sh.dimension ? /:?[A-Z]+(\d+)$/i.exec(sh.dimension) : null;
      if (dm) totalRows = parseInt(dm[1]!, 10);
      let of = totalRows ? ` dari ${fmtInt(totalRows)}` : '';
      if (!totalRows && sh.scannedLastRow) of = sh.countComplete ? ` dari ${fmtInt(sh.scannedLastRow)}` : ` dari setidaknya ${fmtInt(sh.scannedLastRow)}`;
      const shown = fmtInt(limits.maxRowsPerSheet);
      warnings.push(`Sheet "${sh.name}" dipotong: hanya ${shown} baris pertama${of} yang ditampilkan.`);
      parts.push(`_(dipotong: ${shown} baris pertama${of} ditampilkan)_`);
    }
    if (sh.truncatedCols) warnings.push(`Sheet "${sh.name}" dipotong: hanya ${limits.maxColsPerSheet} kolom pertama yang ditampilkan.`);
    if (sh.noCache.length) {
      warnings.push(
        `Sheet "${sh.name}": ${sh.noCache.length} sel rumus belum punya nilai tersimpan (ditampilkan sebagai rumus): ${sh.noCache.slice(0, 5).join(', ')}.`,
      );
    }
  }
  if (skippedForChars) warnings.push(`${skippedForChars} sheet terakhir tidak dibaca karena teks workbook sudah mencapai batas ${fmtInt(maxChars)} karakter.`);
  return { kind: 'xlsx', markdown: parts.join('\n\n'), parts: sheets.length };
}
