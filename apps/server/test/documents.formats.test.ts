import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { DocumentError, extractDocument, outlineOf } from '../src/documents/index.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/documents/${name}`, import.meta.url));

async function extractError(buffer: Buffer, name: string): Promise<DocumentError> {
  try {
    await extractDocument(buffer, name);
  } catch (err) {
    if (err instanceof DocumentError) return err;
    throw err;
  }
  throw new Error(`${name} was extracted, expected a DocumentError`);
}

/** Minimal PDF with one Helvetica text line per page (null = a page without text, like a scan). */
function makePdf(pages: Array<string | null>): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  pages.forEach((text, i) => {
    const stream = text ? `BT /F1 12 Tf 72 720 Td (${text}) Tj ET` : '';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const WORD_MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const SHEET_MAIN = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function officeZip(mainPart: string, mainType: string, parts: Record<string, string>): Buffer {
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${mainPart}" ContentType="${mainType}"/></Types>`,
      ),
      '_rels/.rels': strToU8(
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="${mainPart}"/></Relationships>`,
      ),
      ...Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, strToU8(v)])),
    }),
  );
}

function docx(bodyXml: string): Buffer {
  return officeZip('word/document.xml', WORD_MAIN, {
    'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`,
  });
}

/** Rewrites the uncompressed size a ZIP's central directory declares for one entry. */
function declareSize(zip: Buffer, entry: string, size: number): Buffer {
  const out = Buffer.from(zip);
  for (let p = out.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), out.length); p >= 0; p = out.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), p - 1)) {
    const nameLength = out.readUInt16LE(p + 28);
    if (out.toString('utf8', p + 46, p + 46 + nameLength) === entry) {
      out.writeUInt32LE(size, p + 24);
      return out;
    }
  }
  throw new Error(`entry ${entry} not found`);
}

function workbook(rows: number, withDimension: boolean): Buffer {
  const sheetRows = Array.from(
    { length: rows },
    (_, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>Baris ${i + 1}</t></is></c><c r="B${i + 1}"><v>${i * 10}</v></c></row>`,
  ).join('');
  return officeZip('xl/workbook.xml', SHEET_MAIN, {
    'xl/workbook.xml': `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><sheets><sheet name="Transaksi" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${withDimension ? `<dimension ref="A1:B${rows}"/>` : ''}<sheetData>${sheetRows}</sheetData></worksheet>`,
  });
}

describe('Word documents', () => {
  it('keeps the title, nested headings, lists, tables, footnotes and accepted tracked changes', async () => {
    const doc = await extractDocument(fixture('requirements.docx'), 'requirements.docx');
    const md = doc.markdown;
    expect(doc.kind).toBe('docx');
    expect(doc.warnings).toEqual([]);
    expect(md.startsWith('# Dokumen Persyaratan Sistem Pembayaran Terpadu (SPT)')).toBe(true);
    // Heading 1/2/3 sit below the title
    expect(md).toMatch(/^## 1\. Pendahuluan$/m);
    expect(md).toMatch(/^### 1\.1 Ruang Lingkup$/m);
    expect(md).toMatch(/^#### 2\.1\.1 Penanganan Kegagalan$/m);
    expect(md).toMatch(/^- Aplikasi mobile pelanggan \(Android & iOS\)\n {2}- Termasuk mode offline/m);
    expect(md).toMatch(/^1\. .+\n2\. .+\n3\. .+\n4\. /m);
    expect(md).toContain('| ID Persyaratan | Deskripsi | Prioritas | Pemilik |');
    expect(md).toMatch(/^\| REQ-003 \| Rekonsiliasi harian otomatis dengan bank \|/m);
    expect(md).toMatch(/^\| Catatan: semua keputusan arsitektur dicatat di ADR \|  \|  \|$/m);
    expect(md).toMatch(/\[\^\d+\]: /);
    expect(md).toContain('satu (1) hari kerja');
    expect(md).not.toContain('dua (2)');
    expect(outlineOf(md)[0]).toBe('Dokumen Persyaratan Sistem Pembayaran Terpadu (SPT)');
  });

  it('cuts very long documents at a block boundary and says so', async () => {
    const paragraph = (i: number) => `<w:p><w:r><w:t>Paragraf nomor ${i} ${'isi '.repeat(40)}</w:t></w:r></w:p>`;
    const buffer = docx(Array.from({ length: 4000 }, (_, i) => paragraph(i)).join(''));
    const doc = await extractDocument(buffer, 'panjang.docx', { maxChars: 100_000 });
    expect(doc.warnings.some((w) => w.startsWith('Dokumen dipotong'))).toBe(true);
    expect(doc.markdown).toContain('Paragraf nomor 0 ');
    expect(doc.markdown).not.toContain('Paragraf nomor 3999 ');
  });
});

describe('PowerPoint presentations', () => {
  it('lists slides in presentation order with titles, nested bullets, tables, notes and the untitled last slide', async () => {
    const doc = await extractDocument(fixture('architecture-overview.pptx'), 'architecture-overview.pptx');
    const md = doc.markdown;
    expect(doc.kind).toBe('pptx');
    expect(doc.parts).toBe(11);
    const slides = [...md.matchAll(/^## Slide (\d+)/gm)].map((m) => Number(m[1]));
    expect(slides).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(md).toContain('## Slide 1: Arsitektur Solusi: Platform Pembayaran Digital');
    expect(md).toMatch(/^## Slide 11$/m);
    expect(md).toContain('Terima kasih — sesi tanya jawab & café break');
    expect(md).toMatch(/- Direktorat Digital\n {2}- Product Owner: Budi Santoso/);
    expect(md).toMatch(/^\| Sistem \| Protokol \| Arah \| Frekuensi \|$/m);
    const slide6 = md.slice(md.indexOf('## Slide 6'), md.indexOf('## Slide 7'));
    expect(slide6).toContain('### Speaker notes');
    expect(slide6).toContain('Konfirmasi format file rekonsiliasi SAP dengan tim Finance sebelum sprint 3.');
    expect(md.match(/### Speaker notes/g)).toHaveLength(4);
  });
});

describe('Excel workbooks', () => {
  it('renders sheets in order with ISO dates, percentages, cached formula results and escaped pipes', async () => {
    const doc = await extractDocument(fixture('integration-inventory.xlsx'), 'integration-inventory.xlsx');
    const md = doc.markdown;
    expect(doc.kind).toBe('xlsx');
    expect(doc.parts).toBe(3);
    const order = ['## Sheet: Integrations', '## Sheet: NFR', '## Sheet: Catatan & Asumsi'].map((h) => md.indexOf(h));
    expect(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1]!))).toBe(true);
    expect(md.split('Inventaris Integrasi — Platform Pembayaran Digital (per 1 Okt 2026)')).toHaveLength(2);
    expect(md).toContain('| ID | Sistem | Protokol | Tanggal Go-Live | Transaksi/Hari | Ukuran Payload (KB) | Volume Harian (KB) | Catatan |');
    for (const date of ['2026-03-15', '2026-04-01', '2026-07-01']) expect(md).toContain(date);
    expect(md).not.toMatch(/\b46096\b/);
    expect(md).toMatch(/\| Total \|.*48501.*140980/);
    expect(md).toContain('Delimiter ; \\| encoding UTF-8');
    expect(md).toContain('99.9%');
    expect(doc.warnings).toEqual([expect.stringContaining('sel rumus belum punya nilai tersimpan')]);
  });

  it.each([true, false])('shows the first 1000 rows and the real row count (dimension: %s)', async (withDimension) => {
    const doc = await extractDocument(workbook(1500, withDimension), 'transaksi.xlsx');
    expect(doc.markdown).toContain('| Baris 1000 | 9990 |');
    expect(doc.markdown).not.toContain('Baris 1001 ');
    expect(doc.warnings).toEqual(['Sheet "Transaksi" dipotong: hanya 1.000 baris pertama dari 1.500 yang ditampilkan.']);
  });
});

describe('PDF documents', () => {
  it('marks pages, keeps Unicode text and turns large lines into headings', async () => {
    const doc = await extractDocument(fixture('business-case.pdf'), 'business-case.pdf');
    const md = doc.markdown;
    expect(doc.kind).toBe('pdf');
    expect(doc.parts).toBe(4);
    expect(doc.warnings).toEqual([]);
    const pages = [1, 2, 3, 4].map((n) => md.indexOf(`<!-- page ${n} -->`));
    expect(pages.every((at, i) => at >= 0 && (i === 0 || at > pages[i - 1]!))).toBe(true);
    expect(md.indexOf('Analisis Biaya')).toBeGreaterThan(pages[1]!);
    expect(md).toContain('Ketersediaan ≥ 99,9% mengurangi kehilangan pendapatan Rp 650 juta per tahun');
    expect(md).toContain('jaringan café mitra');
    expect(md).not.toContain('ﬁ');
    expect(md).toMatch(/^#{1,3} Business Case: Platform Pembayaran Digital$/m);
  });

  it('warns about pages without a text layer (scans) instead of failing', async () => {
    const scanned = await extractDocument(makePdf([null, null]), 'scan.pdf');
    expect(scanned.parts).toBe(2);
    expect(scanned.warnings).toEqual([expect.stringContaining('OCR belum didukung')]);
    const partial = await extractDocument(makePdf(['Halaman satu', null, 'Halaman tiga']), 'campuran.pdf');
    expect(partial.markdown).toContain('Halaman tiga');
    expect(partial.warnings).toEqual(['Halaman 2 tidak memiliki lapisan teks (gambar/hasil scan?); OCR belum didukung.']);
  });

  it('stops reading pages at the character limit', async () => {
    const pages = Array.from({ length: 30 }, (_, i) => `Isi halaman ${i + 1} ${'kata '.repeat(60)}`);
    const doc = await extractDocument(makePdf(pages), 'panjang.pdf', { maxChars: 2_000 });
    expect(doc.parts).toBe(30);
    expect(doc.markdown).toContain('Isi halaman 1 ');
    expect(doc.markdown).not.toContain('Isi halaman 30 ');
    expect(doc.warnings.some((w) => /^PDF dipotong setelah halaman \d+ dari 30/.test(w))).toBe(true);
  });

  it('reads copy-restricted PDFs but rejects password-protected ones', async () => {
    const restricted = await extractDocument(fixture('encrypted-owner-only.pdf'), 'kebijakan.pdf');
    expect(restricted.markdown).toContain('Dokumen ini dapat dibuka tanpa kata sandi tetapi penyalinan dibatasi.');
    expect(restricted.warnings).toEqual([expect.stringContaining('pembatasan penggunaan')]);
    const locked = await extractError(fixture('encrypted.pdf'), 'rahasia.pdf');
    expect([locked.code, locked.status]).toEqual(['ENCRYPTED', 422]);
  });
});

describe('content sniffing and hostile files', () => {
  it('reads a file by its content when the extension is wrong', async () => {
    const doc = await extractDocument(fixture('requirements.docx'), 'requirements.xlsx');
    expect(doc.kind).toBe('docx');
    expect(doc.warnings).toEqual(['Ekstensi .xlsx tidak sesuai isinya (Word); file dibaca sebagai Word.']);
    const pdfAsText = await extractDocument(makePdf(['Teks PDF']), 'catatan.txt');
    expect(pdfAsText.kind).toBe('pdf');
  });

  it('explains encrypted Office files and legacy formats renamed to a modern extension', async () => {
    const encrypted = await extractError(fixture('encrypted.docx'), 'kontrak.docx');
    expect([encrypted.code, encrypted.status]).toEqual(['ENCRYPTED', 422]);
    expect(encrypted.message).toContain('kata sandi');
    const legacy = await extractError(fixture('legacy.doc'), 'lama.docx');
    expect([legacy.code, legacy.status]).toEqual(['LEGACY_FORMAT', 415]);
    expect(legacy.message).toContain('.docx');
  });

  it('rejects zip bombs before inflating them and stops lying entries at their declared size', async () => {
    const body = `<w:p><w:r><w:t>${'A'.repeat(2_000_000)}</w:t></w:r></w:p>`;
    const declared = await extractError(declareSize(docx(body), 'word/document.xml', 500 * 1024 * 1024), 'bom.docx');
    expect([declared.code, declared.status]).toEqual(['ZIP_BOMB', 413]);
    const lying = await extractError(declareSize(docx(body), 'word/document.xml', 1000), 'bohong.docx');
    expect([lying.code, lying.status]).toEqual(['ZIP_BOMB', 413]);
    expect(lying.message).toContain('melebihi ukuran yang dinyatakan');
  });

  it('rejects corrupt, unsupported and binary files with a clear status', async () => {
    const cases: Array<[Buffer, string, string, number]> = [
      [Buffer.from('bukan zip sama sekali'), 'rusak.docx', 'CORRUPT', 422],
      [Buffer.from('%PDF-1.7\nsampah'), 'rusak.pdf', 'CORRUPT', 422],
      [Buffer.from('teks biasa'), 'rusak.pdf', 'CORRUPT', 422],
      [Buffer.from(zipSync({ 'visio/document.xml': strToU8('<VisioDocument/>') })), 'gambar.docx', 'UNSUPPORTED', 415],
      [Buffer.from(zipSync({ mimetype: strToU8('application/vnd.oasis.opendocument.text') })), 'odt.docx', 'UNSUPPORTED', 415],
      [Buffer.from(zipSync({ 'a.txt': strToU8('isi') })), 'arsip.xlsx', 'CORRUPT', 422],
      [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0x0d]), 'gambar.txt', 'UNSUPPORTED', 415],
      [Buffer.alloc(0), 'kosong.md', 'EMPTY', 422],
    ];
    for (const [buffer, name, code, status] of cases) {
      const err = await extractError(buffer, name);
      expect([name, err.code, err.status]).toEqual([name, code, status]);
    }
  });
});
