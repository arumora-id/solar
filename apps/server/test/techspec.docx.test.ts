import { strFromU8, unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { extractDocument } from '../src/documents/index.js';
import { buildArchimate } from '../src/generators/archimate/index.js';
import { buildSequence } from '../src/generators/sequence/index.js';
import type { BuiltDocument } from '../src/generators/techspec/document.js';
import { columnWidths } from '../src/generators/techspec/docx.js';
import { buildTechSpec, renderTechSpecDocx, type ResolvedDiagram } from '../src/generators/techspec/index.js';
import { richTechSpec, sampleArchimate, sampleSequence, sampleTechSpec } from './fixtures.js';
import { decodePng } from './png.js';

const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const diagrams = new Map<string, ResolvedDiagram>();

function built(spec: unknown): BuiltDocument {
  const res = buildTechSpec(spec, diagrams, '2026-10-06');
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return res.output.document;
}

function unzip(buffer: Buffer): Record<string, string> & { media: string[] } {
  const files = unzipSync(new Uint8Array(buffer));
  const text: Record<string, string> = {};
  for (const [name, data] of Object.entries(files)) if (/\.(xml|rels)$/.test(name)) text[name] = strFromU8(data);
  return Object.assign(text, { media: Object.keys(files).filter((n) => n.startsWith('word/media/')), raw: files }) as never;
}

beforeAll(() => {
  const a = buildArchimate(sampleArchimate);
  const s = buildSequence(sampleSequence);
  if (!a.ok || !s.ok) throw new Error('fixture diagrams failed');
  diagrams.set('art_view1', { artifactId: 'art_view1', fileName: 'order-layered.svg', svg: a.output.views[0]!.svg });
  diagrams.set('art_view2', { artifactId: 'art_view2', fileName: 'order-coop.svg', svg: a.output.views[1]!.svg });
  diagrams.set('art_seq', { artifactId: 'art_seq', fileName: 'place-order.sequence.svg', svg: s.output.svg, mermaid: s.output.mermaid });
});

describe('renderTechSpecDocx', () => {
  let parts: ReturnType<typeof unzip>;
  let buffer: Buffer;
  let warnings: string[];

  beforeAll(async () => {
    ({ buffer, warnings } = await renderTechSpecDocx(built(richTechSpec({ view: 'art_view1', view2: 'art_view2', sequence: 'art_seq' }))));
    parts = unzip(buffer);
  });

  it('writes a complete package with core and app properties', () => {
    expect(warnings).toEqual([]);
    for (const part of [
      '[Content_Types].xml',
      '_rels/.rels',
      'word/document.xml',
      'word/_rels/document.xml.rels',
      'word/styles.xml',
      'word/numbering.xml',
      'word/settings.xml',
      'docProps/core.xml',
      'docProps/app.xml',
    ]) {
      expect(parts[part], part).toBeTruthy();
    }
    const types = parts['[Content_Types].xml']!;
    expect(types).toMatch(/<Default ContentType="image\/png" Extension="png"\/>/);
    expect(types).toMatch(/<Default ContentType="image\/svg\+xml" Extension="svg"\/>/);
    expect(types).toContain('wordprocessingml.document.main+xml');
    const core = parts['docProps/core.xml']!;
    expect(core).toContain('<dc:title>Order Platform - Technical Specification</dc:title>');
    expect(core).toContain('<dc:subject>Dokumen Spesifikasi Teknis</dc:subject>');
    expect(core).toContain('<dc:creator>Solution Architect</dc:creator>');
    expect(core).toMatch(/<cp:keywords>TSD; Dokumen Spesifikasi Teknis; TSD-ORD-001;/);
    expect(core).toContain('<dc:description>Ringkasan solusi pemesanan.</dc:description>');
    expect(parts['docProps/app.xml']).toContain('<Application>SOLAR AI AGENT</Application>');
    // A4, Indonesian proofing, built-in style names
    expect(parts['word/document.xml']).toContain('<w:pgSz w:w="11906" w:h="16838"');
    const styles = parts['word/styles.xml']!;
    expect(styles).toContain('<w:lang w:val="id-ID"/>');
    for (const id of ['Title', 'Heading1', 'Heading2', 'Heading3', 'Caption', 'TOC1', 'TOCHeading', 'Quote', 'CodeBlock', 'TableGrid', 'Header', 'Footer']) {
      expect(styles, id).toContain(`w:styleId="${id}"`);
    }
  });

  it('has a header and a "Halaman X dari Y" footer, but not on the cover', () => {
    const doc = parts['word/document.xml']!;
    expect(doc).toContain('<w:titlePg/>');
    expect(doc).toMatch(/<w:headerReference w:type="first"/);
    const headers = Object.keys(parts).filter((n) => /^word\/header\d+\.xml$/.test(n)).map((n) => parts[n]!);
    const footers = Object.keys(parts).filter((n) => /^word\/footer\d+\.xml$/.test(n)).map((n) => parts[n]!);
    const header = headers.find((h) => h.includes('TSD-ORD-001'))!;
    expect(header).toContain('Order Platform - Technical Specification');
    const footer = footers.find((f) => f.includes('PAGE'))!;
    expect(footer).toMatch(/Halaman <\/w:t>.*>PAGE<\/w:instrText>.*> dari <\/w:t>.*>NUMPAGES<\/w:instrText>/);
    // the first-page header/footer are empty
    expect(headers.some((h) => !/<w:t[ >]/.test(h))).toBe(true);
    expect(footers.some((f) => !/<w:t[ >]/.test(f))).toBe(true);
  });

  it('has a real, hyperlinked table of contents with its entries and page numbers already written', () => {
    const doc = parts['word/document.xml']!;
    expect(doc).toContain('TOC \\h \\o &quot;1-1&quot;');
    const toc = doc.slice(doc.indexOf('<w:sdt>'), doc.indexOf('</w:sdt>'));
    expect(toc).toMatch(/<w:hyperlink w:history="1" w:anchor="_Toc\d+">.*1\. Ringkasan Eksekutif/);
    const pages = [...toc.matchAll(/PAGEREF (_Toc\d+) \\h<\/w:instrText><w:fldChar w:fldCharType="separate"\/><w:t xml:space="preserve">(\d+)</g)];
    expect(pages.length).toBe((toc.match(/<w:hyperlink /g) ?? []).length);
    expect(pages[0]![2]).toBe('4'); // cover, document control, table of contents, then the body
    // every TOC target is a bookmark on a heading, which also carries the section's own anchor
    for (const [, name] of pages) expect(doc).toContain(`w:name="${name}"`);
    expect(doc).toMatch(/<w:pStyle w:val="Heading1"\/><w:pageBreakBefore\/><\/w:pPr><w:bookmarkStart w:name="_Toc\d+" w:id="\d+"\/><w:bookmarkStart w:name="_Tsd_1_ringkasan_eksekutif"/);
    // the page count is written too, so Word need not update fields on open
    const footer = Object.keys(parts).filter((n) => /^word\/footer\d+\.xml$/.test(n)).map((n) => parts[n]!).find((f) => f.includes('NUMPAGES'))!;
    expect(footer).toMatch(/NUMPAGES<\/w:instrText><w:fldChar w:fldCharType="separate"\/><w:t xml:space="preserve">\d+</);
    expect(parts['word/settings.xml']).not.toMatch(/<w:updateFields\/>|<w:updateFields w:val="true"\/>/);
  });

  it('embeds every diagram as SVG with a rasterized PNG fallback and a caption', () => {
    const svgs = parts.media.filter((m) => m.endsWith('.svg'));
    const pngs = parts.media.filter((m) => m.endsWith('.png'));
    expect(svgs).toHaveLength(3);
    expect(pngs).toHaveLength(3);
    const raw = (parts as unknown as { raw: Record<string, Uint8Array> }).raw;
    for (const png of pngs) {
      const image = decodePng(Buffer.from(raw[png]!));
      expect(image.width).toBeGreaterThan(500);
      expect(image.grey.some((g) => g < 100)).toBe(true); // drawn, not blank
    }
    const doc = parts['word/document.xml']!;
    expect((doc.match(/<asvg:svgBlip /g) ?? []).length).toBe(3);
    expect(doc).toMatch(
      /<w:pStyle w:val="Caption"\/><\/w:pPr><w:r><w:t xml:space="preserve">Gambar <\/w:t><\/w:r><w:r><w:fldChar w:fldCharType="begin"\/><w:instrText xml:space="preserve"> SEQ Gambar \\\* ARABIC <\/w:instrText><w:fldChar w:fldCharType="separate"\/><w:t xml:space="preserve">1<\/w:t><w:fldChar w:fldCharType="end"\/><\/w:r>/,
    );
    expect(doc).toContain('Sequence: place order');
    // the sequence diagram's Mermaid source is not pasted into the Word file
    expect(doc).not.toContain('sequenceDiagram');
    expect(doc).toContain('Sumber Mermaid: tersedia pada file .mmd');
  });

  it('converts Markdown: links, lists that restart, tables, code, quotes; raw HTML stays literal text', () => {
    const doc = parts['word/document.xml']!;
    const rels = parts['word/_rels/document.xml.rels']!;
    expect(rels).toContain('Target="https://example.com/docs?a=1&amp;b=2" TargetMode="External"');
    expect(doc).toMatch(/<w:hyperlink w:history="1" w:anchor="_Tsd_3_ruang_lingkup">/);
    expect(doc).toMatch(/&lt;b&gt;<\/w:t>.*tag HTML.*&lt;\/b&gt;/);
    expect(doc).toMatch(/&lt;script&gt;<\/w:t>.*alert\(1\).*&lt;\/script&gt;/);
    expect(doc).toContain('&lt;div onclick=&quot;x()&quot;&gt;blok HTML&lt;/div&gt;');
    expect(doc).not.toMatch(/<(script|div|b)[ >]/);
    expect(doc).toMatch(/<w:pStyle w:val="Quote"\/>/);
    expect(doc).toMatch(/<w:pStyle w:val="CodeBlock"\/>.*key: value/);
    expect(doc).toMatch(/<w:rStyle w:val="InlineCode"\/>.*kode/);
    expect(doc).toMatch(/<w:strike\/>.*lama/);
    // the two ordered lists of the background use different numbering instances that each start at 1
    const numbering = parts['word/numbering.xml']!;
    const bgStart = doc.indexOf('Langkah satu');
    const firstNum = /<w:numId w:val="(\d+)"\/><\/w:numPr><\/w:pPr><w:r><w:t xml:space="preserve">Langkah satu/.exec(doc)?.[1];
    const secondNum = /<w:numId w:val="(\d+)"\/><\/w:numPr><\/w:pPr><w:r><w:t xml:space="preserve">Daftar kedua/.exec(doc)?.[1];
    expect(bgStart).toBeGreaterThan(0);
    expect(firstNum && secondNum && firstNum !== secondNum).toBe(true);
    expect(numbering).toContain(`<w:num w:numId="${secondNum}"><w:abstractNumId w:val="`);
    expect(numbering).toMatch(new RegExp(`<w:num w:numId="${secondNum}">.*?<w:startOverride w:val="1"/>`));
    // a nested bullet list sits one level deeper
    expect(doc).toMatch(/<w:ilvl w:val="1"\/>.*sub poin/);
    // headings inside Markdown are below the document's levels (out of the table of contents)
    expect(doc).toMatch(/<w:pStyle w:val="Heading6"\/><\/w:pPr><w:r><w:t xml:space="preserve">Subjudul dalam markdown/);
  });

  it('gives every heading a valid, unique Word bookmark', () => {
    const names = [...parts['word/document.xml']!.matchAll(/<w:bookmarkStart w:name="([^"]+)"/g)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(20);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^_[A-Za-z0-9_]{1,39}$/);
  });

  it('has document control, revision history and a sign-off table with empty signature cells', () => {
    const doc = parts['word/document.xml']!;
    for (const label of ['Kontrol Dokumen', 'Riwayat Revisi', 'Persetujuan Dokumen', 'Tanda Tangan', 'Versi awal', '6 Oktober 2026']) expect(doc, label).toContain(label);
    // a name with a comma stays one signer
    expect(doc).toMatch(/Lead Architect, Corp<\/w:t>.*Reviewer/);
    expect(doc).toMatch(/Siti Rahma<\/w:t>.*Penyetuju/);
    // tables repeat their header row on each page
    expect(doc).toContain('<w:tblHeader/>');
  });

  it('strips characters XML 1.0 does not allow', () => {
    for (const [name, text] of Object.entries(parts)) if (typeof text === 'string') expect(INVALID_XML.test(text), name).toBe(false);
    expect(parts['word/document.xml']).toContain('TSD</w:t>');
    expect(parts['word/document.xml']).toContain('sulit diskalakan. Lihat');
  });

  it('reads back as the same document (headings and table text)', async () => {
    const { markdown } = await extractDocument(buffer, 'tsd.docx');
    expect(markdown).toMatch(/^# Order Platform - Technical Specification$/m);
    expect(markdown).toMatch(/^## 1\. Ringkasan Eksekutif$/m);
    expect(markdown).toMatch(/^### 2\.1 Latar Belakang$/m);
    expect(markdown).toMatch(/^## 13\. Risiko$/m);
    expect(markdown).toContain('Gambar 3: Sequence: place order');
    expect(markdown).toMatch(/\| RSK-01 \| Lonjakan trafik \\?\| promo \| High \| Medium \| Autoscaling \|/);
    expect(markdown).toContain('FR-01');
    expect(markdown).toContain('p95 < 300 ms');
  });
});

describe('renderTechSpecDocx (English, minimal spec)', () => {
  it('uses English labels and omits the sign-off table without reviewers or approvers', async () => {
    const { buffer } = await renderTechSpecDocx(built({ ...sampleTechSpec('art_view1'), language: 'en' }), { pageNumbers: false });
    const parts = unzip(buffer);
    const doc = parts['word/document.xml']!;
    for (const label of ['Technical Specification Document', 'Document Control', 'Revision History', 'Table of Contents', 'Figure ', '1. Executive Summary', '6 October 2026']) {
      expect(doc, label).toContain(label);
    }
    expect(doc).not.toContain('Document Approval');
    expect(parts['word/styles.xml']).toContain('<w:lang w:val="en-US"/>');
    const footer = Object.keys(parts).filter((n) => /^word\/footer\d+\.xml$/.test(n)).map((n) => parts[n]!).find((f) => f.includes('PAGE'))!;
    expect(footer).toMatch(/Page <\/w:t>.*PAGE<\/w:instrText>.* of <\/w:t>.*NUMPAGES/);
    // without the page layout Word is asked to refresh the fields when it opens the file
    expect(parts['word/settings.xml']).toMatch(/<w:updateFields\/>|<w:updateFields w:val="true"\/>/);
  });

  it('keeps bookmarks unique when two headings share an anchor ("1.1 Foo" and "11. Foo" both slug to 11-foo)', async () => {
    const doc = built({ ...sampleTechSpec('art_view1'), language: 'en' });
    const twin = { kind: 'heading' as const, level: 2 as const, text: 'Twin', anchor: '1-executive-summary', toc: true };
    const { buffer } = await renderTechSpecDocx({ ...doc, blocks: [...doc.blocks, twin] }, { pageNumbers: false });
    const xml = unzip(buffer)['word/document.xml']!;
    const names = [...xml.matchAll(/<w:bookmarkStart w:name="(_Tsd_1_executive_summary[^"]*)"/g)].map((m) => m[1]);
    expect(names).toEqual(['_Tsd_1_executive_summary', '_Tsd_1_executive_summary_2']);
  });

  it('falls back to a placeholder PNG with a warning when a diagram cannot be rasterized', async () => {
    const broken = new Map(diagrams);
    broken.set('art_view1', { artifactId: 'art_view1', fileName: 'broken.svg', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect></svg>' });
    const res = buildTechSpec(sampleTechSpec('art_view1'), broken, '2026-10-06');
    if (!res.ok) throw new Error('spec');
    const { buffer, warnings } = await renderTechSpecDocx(res.output.document, { pageNumbers: false });
    expect(warnings.join('\n')).toMatch(/broken\.svg: the PNG fallback could not be drawn/);
    const files = unzipSync(new Uint8Array(buffer));
    const png = Object.keys(files).find((n) => n.endsWith('.png'))!;
    expect(decodePng(Buffer.from(files[png]!)).width).toBeGreaterThan(0);
  });
});

describe('columnWidths', () => {
  it('fills the text width, keeps id columns narrow and words unbroken where possible', () => {
    const widths = columnWidths([
      ['ID', 'FR-01', 'FR-02'],
      ['Tipe', 'Microservice', 'SPA'],
      ['Deskripsi', 'Sistem harus membuat pesanan dan mengirim notifikasi ke pelanggan setelah pembayaran diterima', 'x'],
    ]);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(9070);
    expect(widths[0]!).toBeLessThan(widths[2]!);
    expect(widths[1]!).toBeGreaterThanOrEqual(12 * 100 + 220);
  });
});
