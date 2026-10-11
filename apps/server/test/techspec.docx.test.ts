import { strFromU8, unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { extractDocument } from '../src/documents/index.js';
import { buildArchimate } from '../src/generators/archimate/index.js';
import { buildSequence } from '../src/generators/sequence/index.js';
import type { BuiltDocument } from '../src/generators/techspec/document.js';
import {
  columnWidths,
  externalHref,
  LAYOUT_LIMITS,
  renderTechSpecDocx,
  svgTextSize,
  tableLayout,
  textTwips,
  wordsFit,
} from '../src/generators/techspec/docx.js';
import { buildTechSpec, type ResolvedDiagram } from '../src/generators/techspec/index.js';
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
    // headings inside Markdown are below the document's levels (out of the table of contents): #### is Heading 4
    expect(doc).toMatch(/<w:pStyle w:val="Heading4"\/><\/w:pPr><w:r><w:t xml:space="preserve">Subjudul dalam markdown/);
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
    // a name with a comma stays one signer, in the sign-off table and in the document control table (one name per line)
    expect(doc).toMatch(/Lead Architect, Corp<\/w:t>.*Reviewer/);
    const control = doc.slice(doc.indexOf('Kontrol Dokumen'), doc.indexOf('Riwayat Revisi'));
    expect(control).toMatch(/>Budi Santoso<\/w:t><\/w:r><w:r><w:br\/><\/w:r><w:r><w:t xml:space="preserve">Lead Architect, Corp</);
    // the date is written out as on the cover, not as 2026-10-06
    expect(control).toContain('6 Oktober 2026');
    expect(control).not.toContain('2026-10-06');
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

describe('renderTechSpecDocx (review fixes)', () => {
  const svg = (width: number, height: number, font = 11) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="1" y="1" width="${width - 2}" height="${height - 2}" fill="#eef"/><text x="20" y="40" font-size="${font}">Element name</text><text x="20" y="80" font-size="${font}">Other</text></svg>`;

  async function render(spec: Record<string, unknown>, svgs: Record<string, string> = {}, options = { pageNumbers: false }) {
    const map = new Map(diagrams);
    for (const [id, text] of Object.entries(svgs)) map.set(id, { artifactId: id, fileName: `${id}.svg`, svg: text });
    const res = buildTechSpec(spec, map, '2026-10-06');
    if (!res.ok) throw new Error(JSON.stringify(res.errors));
    const { buffer, warnings } = await renderTechSpecDocx(res.output.document, options);
    return { parts: unzip(buffer), warnings };
  }

  it('writes link targets as valid URIs: entities decoded, spaces, quotes and "|" percent-encoded', async () => {
    const { parts } = await render({
      ...sampleTechSpec('art_view1'),
      executiveSummary:
        'See [spec](<https://intranet.example.com/My Docs/spec v2.pdf>), [search](https://x.example.com/a?q=a|b), [amp](https://x.example.com/?a=1&amp;b=2) and [q](https://example.com/a?c="x").',
    });
    const targets = [...parts['word/_rels/document.xml.rels']!.matchAll(/Target="([^"]*)" TargetMode="External"/g)].map((m) =>
      m[1]!.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
    );
    expect(targets).toEqual([
      'https://intranet.example.com/My%20Docs/spec%20v2.pdf',
      'https://x.example.com/a?q=a%7Cb',
      'https://x.example.com/?a=1&b=2',
      'https://example.com/a?c=%22x%22',
    ]);
    for (const target of targets) expect(target).not.toMatch(/[\s"|<>]|&amp;/);
  });

  it('normalizes hrefs and refuses other schemes', () => {
    expect(externalHref('https://example.com/a b?x=1&amp;y=2#f')).toBe('https://example.com/a%20b?x=1&y=2#f');
    expect(externalHref('mailto:a@example.com?subject=Hi there')).toBe('mailto:a@example.com?subject=Hi%20there');
    expect(externalHref('https://example.com/100%')).toBe('https://example.com/100%25');
    expect(externalHref('https://example.com/{x}^`')).toBe('https://example.com/%7Bx%7D%5E%60');
    expect(externalHref('javascript:alert(1)')).toBeNull();
    expect(externalHref('#3-ruang-lingkup')).toBeNull();
  });

  it('maps Markdown headings to distinct levels below the document\'s own', async () => {
    const { parts } = await render({ ...sampleTechSpec('art_view1'), deployment: '# Satu\n\n### Tahapan Rilis\n\nteks\n\n#### Rollback\n\nteks\n\n###### Enam' });
    const doc = parts['word/document.xml']!;
    const style = (text: string) => new RegExp(`<w:pStyle w:val="(Heading\\d)"/></w:pPr><w:r><w:t xml:space="preserve">${text}<`).exec(doc)?.[1];
    expect([style('Satu'), style('Tahapan Rilis'), style('Rollback'), style('Enam')]).toEqual(['Heading3', 'Heading3', 'Heading4', 'Heading6']);
  });

  it('keeps a label ("Kriteria Penerimaan:", "Contoh Response:") on the page of the list or code block it introduces', async () => {
    const { parts } = await render(richTechSpec({ view: 'art_view1', sequence: 'art_seq' }));
    const doc = parts['word/document.xml']!;
    for (const label of ['Kriteria Penerimaan:', 'Contoh Response:']) {
      expect(doc, label).toMatch(new RegExp(`<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">${label}</w:t>`));
    }
    // ordinary paragraphs are not tied to what follows
    expect(doc).toMatch(/<w:p><w:r><w:t xml:space="preserve">Ringkasan <\/w:t>/);
  });

  it('turns spelling and grammar marks off for code', async () => {
    const { parts } = await render(sampleTechSpec('art_view1'));
    const styles = parts['word/styles.xml']!;
    for (const id of ['CodeBlock', 'InlineCode']) expect(styles, id).toMatch(new RegExp(`w:styleId="${id}">(?:(?!</w:style>).)*<w:noProof/>`));
  });

  it('gives a wide diagram a landscape page of its own, with the headings right before it', async () => {
    const spec = sampleTechSpec('art_view1');
    const { parts, warnings } = await render(
      {
        ...spec,
        architecture: { ...spec.architecture, diagrams: [{ artifactId: 'art_small', caption: 'Small' }, { artifactId: 'art_wide', caption: 'Wide' }] },
      },
      { art_small: svg(500, 300), art_wide: svg(1400, 560) },
    );
    expect(warnings).toEqual([]);
    const doc = parts['word/document.xml']!;
    const sections = doc.split(/<w:sectPr/).slice(1).map((s) => s.slice(0, s.indexOf('</w:sectPr>')));
    expect(sections.map((s) => (/w:orient="landscape"/.test(s) ? 'landscape' : 'portrait'))).toEqual(['portrait', 'landscape', 'portrait']);
    expect(sections[1]).toContain('<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>');
    // the wide figure is drawn larger than the portrait text width (604 px = 5753400 EMU) allows; the small one is not enlarged
    const extents = [...doc.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)].map((m) => Math.round(Number(m[1]) / 9525));
    expect(extents).toEqual([500, 933]);
    // the landscape page's header and footer reach across its full width
    const landscapeHeader = /<w:headerReference w:type="default" r:id="(rId\d+)"\/>/.exec(sections[1]!)![1];
    const target = new RegExp(`Id="${landscapeHeader}"[^>]*Target="([^"]+)"`).exec(parts['word/_rels/document.xml.rels']!)?.[1]
      ?? new RegExp(`Target="([^"]+)"[^>]*Id="${landscapeHeader}"`).exec(parts['word/_rels/document.xml.rels']!)![1];
    expect(parts[`word/${target}`]).toContain('<w:tab w:val="right" w:pos="14002"/>');
    // the caption and the figure are in the landscape section, the paragraph before it is not
    const wideAt = doc.indexOf('Gambar 2');
    const breakAt = doc.indexOf('w:orient="landscape"');
    expect(wideAt).toBeLessThan(breakAt);
    expect(doc.lastIndexOf('<w:sectPr', wideAt)).toBeGreaterThan(doc.indexOf('Gambar 1'));
  });

  it('gives a table whose words cannot fit portrait A4 a landscape page instead of breaking an identifier', async () => {
    const integration = {
      id: 'INT-01',
      name: 'Settlement notification',
      source: 'SettlementService',
      target: 'MerchantNotificationGateway',
      protocol: 'HTTPS/REST',
      pattern: 'Request/Response',
      dataFormat: 'application/json',
      frequency: 'Real-time',
      security: 'OAuth 2.0 + mTLS',
    };
    const { parts } = await render({ ...sampleTechSpec('art_view1'), integrations: [integration] });
    const doc = parts['word/document.xml']!;
    const sections = doc.split(/<w:sectPr/).slice(1).map((s) => s.slice(0, s.indexOf('</w:sectPr>')));
    expect(sections.map((s) => (/w:orient="landscape"/.test(s) ? 'landscape' : 'portrait'))).toEqual(['portrait', 'landscape', 'portrait']);
    // the heading goes with the table, which spans the landscape text width at the normal table size
    const landscape = doc.slice(doc.indexOf('</w:sectPr>'), doc.indexOf('w:orient="landscape"'));
    expect(landscape).toContain('Spesifikasi Integrasi</w:t>');
    expect(landscape).toContain('<w:tblW w:type="dxa" w:w="14002"/>');
    expect(landscape).toContain('MerchantNotificationGateway');
    expect(landscape).not.toContain('TableTextSmall');
    const grid = [.../<w:tblGrid>(.*?)<\/w:tblGrid>/.exec(landscape)![1]!.matchAll(/w:w="(\d+)"/g)].map((m) => Number(m[1]));
    expect(grid[3]! - 180).toBeGreaterThanOrEqual(textTwips('MerchantNotificationGateway', 9.5));

    // the same table with identifiers that fit stays on the portrait page, in the small table style
    const fits = await render({ ...sampleTechSpec('art_view1'), integrations: [{ ...integration, source: 'Settlement', target: 'Gateway' }] });
    expect(fits.parts['word/document.xml']).not.toContain('w:orient="landscape"');
    expect(fits.parts['word/document.xml']).toContain('TableTextSmall');
  });

  it('chooses the portrait layout, then landscape at the normal size, then landscape small', () => {
    const integration = (target: string) =>
      ['ID:INT-01', 'Antarmuka:Settlement notification', 'Sumber:SettlementService', `Tujuan:${target}`, 'Protokol:HTTPS/REST', 'Pola:Request/Response', 'Format Data:application/json', 'Frekuensi:Real-time', 'Keamanan:OAuth 2.0 + mTLS'].map(
        (c) => c.split(':'),
      );
    expect(tableLayout(integration('Gateway'))).toMatchObject({ landscape: false, small: true, width: 9070, size: 8.5, margin: 45 });
    expect(tableLayout(integration('MerchantNotificationGateway'))).toMatchObject({ landscape: true, small: false, width: 14002, size: 9.5, margin: 90 });
    // tables inside Markdown text stay portrait
    expect(tableLayout(integration('MerchantNotificationGateway'), false)).toMatchObject({ landscape: false, small: true });
    expect(tableLayout(integration('Gateway').slice(0, 4))).toMatchObject({ landscape: false, small: false, size: 9.5, margin: 90 });
    const many = Array.from({ length: 16 }, (_, i) => [`Kolom${i}`, 'Settlement_Account']);
    expect(tableLayout(many)).toMatchObject({ landscape: true, small: true });
    expect(wordsFit([['ID', 'INT-01']], 9070, 9.5, 180)).toBe(true);
  });

  it('warns when a diagram has to be shrunk so far that its text is unreadable in print', async () => {
    const spec = sampleTechSpec('art_view1');
    const { warnings } = await render(
      { ...spec, architecture: { ...spec.architecture, diagrams: [{ artifactId: 'art_huge', caption: 'Huge' }] } },
      { art_huge: svg(1600, 2400, 11) },
    );
    expect(warnings).toEqual([expect.stringMatching(/^Diagram art_huge\.svg: shrunk to 35% to fit the page, so its text prints at about 2\.9 pt; split it/)]);
    expect(svgTextSize(svg(100, 100, 12), 100)).toBe(12);
    expect(svgTextSize('<svg width="200" viewBox="0 0 100 50"><text font-size="10">x</text></svg>', 200)).toBe(20);
    expect(svgTextSize('<svg width="10" height="10"/>', 10)).toBeNull();
  });

  it('leaves the page numbers to Word when a long unbroken token would make the page layout slow', async () => {
    const { parts } = await render({ ...sampleTechSpec('art_view1'), executiveSummary: `Token: ${'A'.repeat(LAYOUT_LIMITS.longestRun + 1)}` }, {}, { pageNumbers: true });
    expect(parts['word/settings.xml']).toMatch(/<w:updateFields\/>|<w:updateFields w:val="true"\/>/);
  }, 10_000);
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
    expect(widths[1]!).toBeGreaterThanOrEqual(textTwips('Microservice', 9.5) + 180);
  });

  /** Room for the widest word of each column (header words bold), given the cell margins. */
  const fitsWords = (columns: string[][], widths: number[], size: number, padding: number, maxChars = 12) =>
    columns.map((cells, i) => {
      const [header, ...body] = cells;
      const words = [...header!.split(/\s+/).map((w) => textTwips(w, size, true)), ...body.flatMap((c) => c.split(/\s+|(?<=\/)/)).filter((w) => w.length <= maxChars).map((w) => textTwips(w, size))];
      return widths[i]! - padding >= Math.max(...words);
    });

  it('never breaks header words or short tokens of a 9-column table ("Keamana|n", "INT-|01", "Respons|e")', () => {
    const columns = [
      ['ID', 'INT-01', 'INT-02'],
      ['Antarmuka', 'Settlement notification — kirim status settlement ke merchant', 'Payment API'],
      ['Sumber', 'SettlementService', 'Merchant'],
      ['Tujuan', 'MerchantNotificationGateway', 'API Gateway'],
      ['Protokol', 'HTTPS/REST', 'TCP/ISO 8583'],
      ['Pola', 'Request/Response', 'Callback'],
      ['Format Data', 'application/json', 'ISO 8583:1993'],
      ['Frekuensi', 'Real-time, 1.500 TPS puncak', 'Harian 01:00 WIB'],
      ['Keamanan', 'OAuth 2.0 + mTLS', 'HMAC-SHA256 signature'],
    ];
    const widths = columnWidths(columns, 9070, 8.5, 90);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(9070);
    expect(fitsWords(columns, widths, 8.5, 90)).toEqual(columns.map(() => true));
  });

  it('gives a long identifier its full width when the other columns have room (no "account_nu|mber")', () => {
    const columns = [
      ['Atribut', 'merchant_settlement_account_number', 'payment_id'],
      ['Tipe', 'varchar(34)', 'varchar(26)'],
      ['Wajib', 'Ya', 'Tidak'],
      ['Deskripsi', 'Nomor rekening settlement merchant di bank mitra', 'ULID'],
    ];
    const widths = columnWidths(columns);
    expect(widths[0]! - 180).toBeGreaterThanOrEqual(textTwips('merchant_settlement_account_number', 9.5));
    expect(fitsWords(columns, widths, 9.5, 180, 40)).toEqual(columns.map(() => true));
  });

  it('scales every column down only when not even the short words fit', () => {
    const columns = Array.from({ length: 12 }, (_, i) => [`Kolom${i}`, 'Keamanan', 'INT-0001']);
    const widths = columnWidths(columns, 9070, 8.5, 90);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(9070);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(12);
  });
});
