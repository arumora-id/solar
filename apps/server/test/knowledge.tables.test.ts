import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { extractDocument } from '../src/documents/index.js';
import type { KnowledgeStore } from '../src/knowledge/knowledgeStore.js';
import { importTable } from '../src/knowledge/tableImport.js';

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const SHEET_MAIN = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';

/** A workbook with one inline-string sheet per entry. */
function workbook(sheets: Record<string, string[][]>): Buffer {
  const names = Object.keys(sheets);
  const col = (c: number) => String.fromCharCode(65 + c);
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
        .join('')}</Relationships>`,
    ),
  };
  names.forEach((name, s) => {
    const rows = sheets[name]!.map(
      (r, i) => `<row r="${i + 1}">${r.map((v, c) => `<c r="${col(c)}${i + 1}" t="inlineStr"><is><t>${v}</t></is></c>`).join('')}</row>`,
    );
    files[`xl/worksheets/sheet${s + 1}.xml`] = strToU8(
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData></worksheet>`,
    );
  });
  return Buffer.from(zipSync(files));
}

const catalog = (prefix: string) => [
  ['ID', 'Nama', 'Keterangan'],
  ...Array.from({ length: 10 }, (_, i) => [`${prefix}-${i + 1}`, `Sistem ${i + 1}`, 'x'.repeat(80)]),
];

describe('knowledge table import and the Markdown character budget', () => {
  const file = workbook({ A: catalog('A'), B: catalog('B') });
  const shape = (tables: Array<{ name: string; rows: string[][]; truncated: boolean }> | undefined) =>
    tables?.map((t) => [t.name, t.rows.length, t.truncated]);

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

  it('lists a sheet skipped while reading as cut instead of leaving it out', async () => {
    const doc = await extractDocument(file, 'katalog.xlsx', { tableRows: 50, maxChars: 1000 });
    expect(shape(doc.tables)).toEqual([
      ['A', 11, false],
      ['B', 0, true],
    ]);
  });

  it('refuses to import a table that was cut instead of importing part of it', async () => {
    const store = {} as KnowledgeStore; // never reached
    await expect(
      importTable(store, { name: 'A', rows: catalog('A'), truncated: true }, 'katalog.xlsx', {
        sheet: 'A',
        headerRow: 1,
        idColumn: 'ID',
        aliasColumns: [],
        folder: 'systems',
        removeStale: true,
      }),
    ).rejects.toThrow(/tidak terbaca utuh/);
  });
});
