#!/usr/bin/env node
/**
 * Regenerates the raster app icons from the hand-drawn SVG app icon, apps/web/public/favicon.svg (64x64 viewBox whose
 * first element is the full-size rounded background <rect width="64" height="64" .../>; it currently shows Robo, the
 * default character):
 *
 *   apps/web/public/icons/icon-192.png, icon-512.png    the favicon as drawn (rounded square, transparent corners)
 *   apps/web/public/icons/apple-touch-icon.png (180)    full-bleed background (iOS rounds the corners itself)
 *   apps/web/public/icons/maskable-192.png, -512.png    full-bleed background, artwork shrunk into the maskable safe zone
 *                                                       (the central circle of 80% diameter)
 *   apps/desktop/build/icon.png (512)                   Windows installer / app icon (electron-builder), as icon-512
 *
 * Edit favicon.svg, then run:  node scripts/generate-icons.mjs
 *
 * The SVG is rasterised by Chromium through Playwright, which is NOT a project dependency (to keep installs small). Use a
 * global install (`npm i -g playwright && npx playwright install chromium`) or any local one; PLAYWRIGHT_BROWSERS_PATH
 * is honoured as usual. Output is deterministic for a given Chromium version.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'apps/web/public/favicon.svg');

/** Playwright from the project (if someone added it) or from the global npm prefix. */
async function loadChromium() {
  const bases = [join(root, 'package.json')];
  try {
    bases.push(join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'));
  } catch {
    // no npm on PATH: only the project is searched
  }
  for (const base of bases) {
    for (const name of ['playwright', 'playwright-core']) {
      try {
        const entry = createRequire(base).resolve(name);
        const mod = await import(pathToFileURL(entry).href);
        return mod.chromium ?? mod.default?.chromium;
      } catch {
        // try the next location
      }
    }
  }
  console.error('Playwright not found. Install it with: npm i -g playwright && npx playwright install chromium');
  process.exit(1);
}

const svg = readFileSync(source, 'utf8');
const background = /<rect\s+width="64"\s+height="64"[^>]*\/>/.exec(svg);
const fill = background && /fill="([^"]+)"/.exec(background[0])?.[1];
if (!background || !fill || !/viewBox="0 0 64 64"/.test(svg)) {
  console.error(`${relative(root, source)}: expected a 64x64 viewBox whose first element is <rect width="64" height="64" ... fill="..."/>`);
  process.exit(1);
}
// the artwork without its rounded background, so it can be re-laid on a full-bleed square
const artwork = svg
  .replace(/<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(background[0], '');

/**
 * Full-bleed variant: square background, artwork scaled about its own centre (the centre of its bounding box, measured
 * in the browser) and placed in the middle of the icon.
 */
const fullBleed = (scale, cx, cy) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${fill}"/>` +
  `<g transform="translate(32 32) scale(${scale}) translate(${-cx} ${-cy})">${artwork}</g></svg>`;

const outputs = [
  // [path, size, variant, transparent corners]
  ['apps/web/public/icons/icon-192.png', 192, 'asis', true],
  ['apps/web/public/icons/icon-512.png', 512, 'asis', true],
  ['apps/desktop/build/icon.png', 512, 'asis', true],
  ['apps/web/public/icons/apple-touch-icon.png', 180, 0.9, false],
  ['apps/web/public/icons/maskable-192.png', 192, 0.7, false],
  ['apps/web/public/icons/maskable-512.png', 512, 0.7, false],
];

const chromium = await loadChromium();
const browser = await chromium.launch();
try {
  const probe = await browser.newPage();
  await probe.setContent(svg.replace(background[0], ''));
  const box = await probe.evaluate(() => {
    const b = document.querySelector('svg').getBBox();
    return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
  });
  await probe.close();

  for (const [path, size, variant, transparent] of outputs) {
    const markup = variant === 'asis' ? svg : fullBleed(variant, box.cx, box.cy);
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const data = `data:image/svg+xml;base64,${Buffer.from(markup).toString('base64')}`;
    await page.setContent(
      `<html><body style="margin:0;background:transparent"><img src="${data}" width="${size}" height="${size}" style="display:block"></body></html>`,
    );
    await page.waitForFunction(() => document.querySelector('img')?.complete);
    mkdirSync(dirname(join(root, path)), { recursive: true });
    await page.screenshot({ path: join(root, path), omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
    console.log(`${path} (${size}x${size})`);
  }
} finally {
  await browser.close();
}
