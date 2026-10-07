import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { extractDocument, type SheetTable } from '../src/documents/index.js';
import type { KnowledgeStore } from '../src/knowledge/knowledgeStore.js';
import { importTable, MAX_IMPORT_ROWS, type TableImportOptions } from '../src/knowledge/tableImport.js';

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const SHEET_MAIN = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const col = (c: number): string => (c >= 26 ? col(Math.floor(c / 26) - 1) : '') + String.fromCharCode(65 + (c % 26));

/** A workbook from raw <sheetData> contents per sheet, with an optional shared-string table. */
function rawWorkbook(sheets: Record<string, string>, sst?: string[]): Buffer {
  const names = Object.keys(sheets);
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="${SHEET_MAIN}"/></Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><sheets>${names
        .map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}${sst ? `<Relationship Id="rIdS" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>` : ''}</Relationships>`,
    ),
  };
  names.forEach((name, s) => {
    files[`xl/worksheets/sheet${s + 1}.xml`] = strToU8(
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheets[name]}</sheetData></worksheet>`,
    );
  });
  if (sst) {
    files['xl/sharedStrings.xml'] = strToU8(
      `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${sst.map((v) => `<si><t>${v}</t></si>`).join('')}</sst>`,
    );
  }
  return Buffer.from(zipSync(files));
}

/** A workbook with one sheet per entry: text as inline strings, or as shared strings (t="s") the way Excel writes it. */
function workbook(sheets: Record<string, string[][]>, sharedStrings = false): Buffer {
  const sst: string[] = [];
  const cell = (v: string, ref: string) =>
    sharedStrings ? `<c r="${ref}" t="s"><v>${sst.push(v) - 1}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
  const data = Object.fromEntries(
    Object.entries(sheets).map(([name, rows]) => [
      name,
      rows.map((r, i) => `<row r="${i + 1}">${r.map((v, c) => cell(v, `${col(c)}${i + 1}`)).join('')}</row>`).join(''),
    ]),
  );
  return rawWorkbook(data, sharedStrings ? sst : undefined);
}

const catalog = (prefix: string) => [
  ['ID', 'Nama', 'Keterangan'],
  ...Array.from({ length: 10 }, (_, i) => [`${prefix}-${i + 1}`, `Sistem ${i + 1}`, 'x'.repeat(80)]),
];

const shape = (tables: SheetTable[] | undefined) => tables?.map((t) => [t.name, t.rows.length, t.truncated]);

const importOptions: TableImportOptions = { sheet: 'A', headerRow: 1, idColumn: 'ID', aliasColumns: [], folder: 'systems', removeStale: true };
/** The import must refuse before it touches the store. */
const untouchedStore = {} as KnowledgeStore;

describe('knowledge table import and the Markdown character budget', () => {
  const file = workbook({ A: catalog('A'), B: catalog('B') });

  it('returns every row of a sheet whose Markdown was cut', async () => {
    const doc = await extractDocument(file, 'katalog.xlsx', { tableRows: 50, maxChars: 1200 });
    // the Markdown for the model is capped...
    expect(doc.warnings.join('\n')).toContain('Sheet "B" dipotong');
    // ...but the raw tables used by the import are complete
    expect(shape(doc.tables)).toEqual([
      ['A', 11, false],
      ['B', 11, false],
    ]);
  });

  it('returns every row of a sheet read in full but rendered after the budget ran out (shared strings)', async () => {
    // shared strings count little while reading, so C is read; B's first row goes over the budget, so C gets none
    const book = workbook({ A: catalog('A'), B: [['ID', 'Nama', 'x'.repeat(400)], ...catalog('B').slice(1)], C: catalog('C') }, true);
    const doc = await extractDocument(book, 'katalog.xlsx', { tableRows: 50, maxChars: 1200 });
    expect(doc.warnings.join('\n')).toContain('1 sheet terakhir tidak dibaca');
    expect(shape(doc.tables)).toEqual([
      ['A', 11, false],
      ['B', 11, false],
      ['C', 11, false],
    ]);
  });

  it('lists a sheet skipped while reading as cut instead of leaving it out', async () => {
    const doc = await extractDocument(file, 'katalog.xlsx', { tableRows: 50, maxChars: 1000 });
    expect(shape(doc.tables)).toEqual([
      ['A', 11, false],
      ['B', 0, true],
    ]);
  });

  it('limits the total text of the tables, marking the sheet that passes it as cut', async () => {
    // one 2000-character shared string used in every cell: cheap to read, but copied once per cell
    const header = `<row r="1">${Array.from({ length: 50 }, (_, c) => `<c r="${col(c)}1" t="inlineStr"><is><t>Kolom ${c + 1}</t></is></c>`).join('')}</row>`;
    const body = Array.from(
      { length: 600 },
      (_, i) => `<row r="${i + 2}">${Array.from({ length: 50 }, (_, c) => `<c r="${col(c)}${i + 2}" t="s"><v>0</v></c>`).join('')}</row>`,
    ).join('');
    const book = rawWorkbook({ Katalog: header + body }, ['x'.repeat(2000)]);
    const doc = await extractDocument(book, 'katalog.xlsx', { tableRows: 5010, maxChars: 100_000 });
    const table = doc.tables![0]!;
    expect(table.truncated).toBe(true);
    expect(table.rows.length).toBeLessThan(601);
    expect(table.rows.reduce((n, r) => n + r.reduce((m, v) => m + v.length, 0), 0)).toBeLessThanOrEqual(50_000_000);
  });

  it('does not count rows holding only empty shared strings toward the row cap', async () => {
    // some exporters write empty cells as a reference to an empty shared string
    const rows: string[] = ['<row r="1"><c r="A1" t="s"><v>1</v></c><c r="B1" t="s"><v>2</v></c></row>'];
    for (let i = 0; i < 30; i++) {
      rows.push(`<row><c r="A${rows.length + 1}" t="inlineStr"><is><t>SYS-${i + 1}</t></is></c><c r="B${rows.length + 1}" t="s"><v>2</v></c></row>`);
      rows.push(`<row><c r="A${rows.length + 1}" t="s"><v>0</v></c><c r="B${rows.length + 1}" t="s"><v>0</v></c></row>`);
    }
    for (let i = 0; i < 100; i++) rows.push(`<row><c r="A${rows.length + 1}" t="s"><v>0</v></c></row>`);
    const sst = ['', 'ID', 'Nama'];
    const doc = await extractDocument(rawWorkbook({ Katalog: rows.join('') }, sst), 'katalog.xlsx', { tableRows: 40, maxChars: 1_000_000 });
    expect(shape(doc.tables)).toEqual([['Katalog', 31, false]]);
    // a sheet with more real rows than the cap is still reported as cut
    const full = workbook({ Katalog: [['ID', 'Nama'], ...Array.from({ length: 50 }, (_, i) => [`SYS-${i + 1}`, 'Nama'])] }, true);
    const cut = await extractDocument(full, 'katalog.xlsx', { tableRows: 40, maxChars: 1_000_000 });
    expect(shape(cut.tables)).toEqual([['Katalog', 40, true]]);
  });

  it('refuses to import a table that was cut, naming the reason, instead of importing part of it', async () => {
    const cutForText: SheetTable = { name: 'A', rows: catalog('A'), truncated: true };
    await expect(importTable(untouchedStore, cutForText, 'katalog.xlsx', importOptions)).rejects.toThrow(
      'Sheet "A" tidak terbaca utuh karena teksnya terlalu panjang',
    );
    const tooManyRows: SheetTable = {
      name: 'A',
      rows: [['ID'], ...Array.from({ length: MAX_IMPORT_ROWS + 9 }, (_, i) => [`SYS-${i + 1}`])],
      truncated: true,
    };
    await expect(importTable(untouchedStore, tooManyRows, 'katalog.xlsx', importOptions)).rejects.toThrow(
      `Sheet "A" berisi lebih dari ${MAX_IMPORT_ROWS} baris`,
    );
  });

  it('refuses a sheet skipped while reading with that reason, not a missing column', async () => {
    const doc = await extractDocument(file, 'katalog.xlsx', { tableRows: 50, maxChars: 1000 });
    const skipped = doc.tables!.find((t) => t.name === 'B')!;
    await expect(importTable(untouchedStore, skipped, 'katalog.xlsx', { ...importOptions, sheet: 'B' })).rejects.toThrow(
      'Sheet "B" tidak dibaca karena teks workbook sudah mencapai batas',
    );
  });
});
