import { describe, expect, it } from 'vitest';
import { detectKind, DocumentError, extractDocument, outlineOf } from '../src/documents/index.js';
import { csvToMarkdown, decodeText, MAX_TABLE_ROWS } from '../src/documents/text.js';

describe('document kinds', () => {
  it('maps extensions and rejects legacy or unknown formats with a hint', () => {
    expect(detectKind('Kebutuhan.DOCX').kind).toBe('docx');
    expect(detectKind('inventory.xlsm').kind).toBe('xlsx');
    expect(detectKind('notes.markdown').kind).toBe('markdown');
    expect(() => detectKind('old.doc')).toThrow(/\.docx/);
    expect(() => detectKind('old.xls')).toThrow(DocumentError);
    expect(() => detectKind('drawing.vsdx')).toThrow(/tidak didukung/);
    expect(() => detectKind('noextension')).toThrow(DocumentError);
  });
});

describe('text decoding', () => {
  it('decodes UTF-8 with BOM, UTF-16 and Windows-1252 (curly quotes, dashes, euro)', () => {
    expect(decodeText(Buffer.from([0xef, 0xbb, 0xbf, 0x63, 0x61, 0x66, 0xc3, 0xa9]))).toBe('café');
    expect(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('≥ 99,9%', 'utf16le')]))).toBe('≥ 99,9%');
    const cp1252 = Buffer.from([0x93, 0x52, 0x61, 0x70, 0x61, 0x74, 0x94, 0x20, 0x96, 0x20, 0x63, 0x61, 0x66, 0xe9, 0x20, 0x80, 0x35]);
    expect(decodeText(cp1252)).toBe('“Rapat” – café €5');
  });

  it('detects Windows-1252 even when only one character is not ASCII', () => {
    const ascii = Buffer.from(`${'id;nama\n'.repeat(200)}`, 'latin1');
    const row = Buffer.from([0x32, 0x30, 0x31, 0x3b, 0x4a, 0x6f, 0x73, 0xe9]); // "201;José" in cp1252
    expect(decodeText(Buffer.concat([ascii, row])).endsWith('201;José')).toBe(true);
  });

  it('caps very large CSV files and says so', () => {
    const rows = ['a,b', ...Array.from({ length: MAX_TABLE_ROWS + 50 }, (_, i) => `${i},x`)].join('\n');
    const { markdown, warnings } = csvToMarkdown(rows, 'big');
    // header + separator + data rows
    expect(markdown.split('\n').filter((l) => l.startsWith('| ')).length).toBe(MAX_TABLE_ROWS + 2);
    expect(warnings[0]).toContain(String(MAX_TABLE_ROWS));
  });
});

describe('extractDocument', () => {
  it('returns Markdown, an outline and no warnings for a normal Markdown file', async () => {
    const r = await extractDocument(Buffer.from('# Judul\n\n## Bagian A\ntext\n### Detail\n'), 'a.md');
    expect(r.kind).toBe('markdown');
    expect(outlineOf(r.markdown)).toEqual(['Judul', '  Bagian A', '    Detail']);
    expect(r.warnings).toEqual([]);
  });

  it('rejects empty files and truncates over-long text with a warning', async () => {
    await expect(extractDocument(Buffer.alloc(0), 'a.txt')).rejects.toThrow(/kosong/);
    const r = await extractDocument(Buffer.from('x'.repeat(5000)), 'long.txt', { maxChars: 1000 });
    expect(r.markdown.length).toBeLessThan(1200);
    expect(r.warnings.join(' ')).toMatch(/1\.000/);
  });

  it('removes control characters and flags documents without text', async () => {
    const r = await extractDocument(Buffer.from('a\u0000b\r\nc\u0007'), 'x.txt');
    expect(r.markdown).toBe('ab\nc');
    const blank = await extractDocument(Buffer.from('   \n\n  '), 'blank.txt');
    expect(blank.warnings.join(' ')).toMatch(/tidak berisi teks/);
  });
});
