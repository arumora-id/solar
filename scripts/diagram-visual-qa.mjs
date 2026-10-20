/**
 * Diagram-specific Chromium QA: render freshly generated SVGs in an actual browser,
 * inspect their finite viewBoxes and export editable files for human draw.io/VP Online QA.
 *
 * Run after Playwright Chromium installation:
 *   node --import tsx scripts/diagram-visual-qa.mjs
 * Never contacts diagram SaaS providers, and never reads production user data.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { buildArchimate } from '../apps/server/src/generators/archimate/index.ts';
import { buildSequence } from '../apps/server/src/generators/sequence/index.ts';
import { sampleArchimate, sampleSequence } from '../apps/server/test/fixtures.ts';

const output = join(process.env.RUNNER_TEMP ?? tmpdir(), 'solar-diagram-qa');
await mkdir(output, { recursive: true });
const arch = buildArchimate(sampleArchimate);
const seq = buildSequence(sampleSequence);
assert(arch.ok, 'ArchiMate QA fixture must validate');
assert(seq.ok, 'Sequence QA fixture must validate');
const diagrams = [
  ...arch.output.views.map((v, i) => ({
    id: 'archimate-view-' + (i + 1), name: v.name, svg: v.svg,
  })),
  { id: 'sequence-sample', name: sampleSequence.title, svg: seq.output.svg },
];
await Promise.all([
  writeFile(join(output, 'archimate-sample.drawio'), arch.output.drawio),
  writeFile(join(output, 'archimate-sample.vp-online.xml'), arch.output.drawio),
  writeFile(join(output, 'archimate-sample.exchange.xml'), arch.output.exchangeXml),
  writeFile(join(output, 'sequence-sample.drawio'), seq.output.drawio),
  writeFile(join(output, 'sequence-sample.vp-online.xml'), seq.output.drawio),
  ...diagrams.map((d) => writeFile(join(output, d.id + '.svg'), d.svg)),
]);
let browser;
const reports = [];
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  for (const diagram of diagrams) {
    assert(!/(?:NaN|Infinity|undefined)/.test(diagram.svg), diagram.id + ': invalid geometry');
    await page.setContent('<!doctype html><html><head><meta charset="UTF-8"/><style>body{background:#fff;margin:0;padding:16px;font-family:Arial,sans-serif}svg{display:block;max-width:none}</style></head><body><main>' +
      diagram.svg + '</main></body></html>', { waitUntil: 'load' });
    const metrics = await page.locator('svg').evaluate((svg) => {
      const box = svg.getBoundingClientRect();
      const view = svg.viewBox.baseVal;
      let visibleText = 0;
      let outOfBoundsText = 0;
      for (const text of svg.querySelectorAll('text')) {
        const textBox = text.getBBox();
        if (textBox.width <= 0 || textBox.height <= 0) continue;
        visibleText++;
        if (textBox.x < -4 || textBox.y < -4 ||
          textBox.x + textBox.width > view.width + 4 ||
          textBox.y + textBox.height > view.height + 4) outOfBoundsText++;
      }
      return {
        width: box.width, height: box.height, viewWidth: view.width, viewHeight: view.height,
        visibleText, outOfBoundsText,
      };
    });
    assert(metrics.width > 100 && metrics.height > 100, diagram.id + ': SVG failed to render');
    assert(Number.isFinite(metrics.viewWidth) && Number.isFinite(metrics.viewHeight),
      diagram.id + ': malformed viewBox');
    assert(metrics.visibleText > 0, diagram.id + ': no readable text objects');
    // Out-of-bounds text is measured/reported, not silently cropped or mislabeled as success.
    const filename = join(output, diagram.id + '.png');
    await page.locator('svg').screenshot({ path: filename, timeout: 45000 });
    reports.push({ diagram: diagram.id, name: diagram.name, ...metrics, screenshot: diagram.id + '.png' });
  }
} finally {
  await browser?.close();
}
await writeFile(join(output, 'quality-report.json'), JSON.stringify({
  note: 'Chromium SVG inspection; draw.io / Visual Paradigm Online hosted import requires separate manual QA.',
  generatedAt: new Date().toISOString(),
  archimateWarnings: arch.output.warnings,
  sequenceWarnings: seq.output.warnings,
  diagrams: reports,
}, null, 2));
console.log('Diagram visual QA succeeded:', JSON.stringify(reports));
console.log('For human editor QA, import .drawio into draw.io and .vp-online.xml into VP Online.');
console.log('Screenshots and source files:', output);
