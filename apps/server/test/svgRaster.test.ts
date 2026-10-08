import { describe, expect, it } from 'vitest';
import { decodePng, PNG_SIGNATURE } from './png.js';
import { cappedRasterWidth, MAX_RASTER_PIXELS, MAX_RASTER_SIDE, placeholderPng, rasterizeSvg, svgSize } from '../src/generators/svgRaster.js';

const dark = (grey: Uint8Array) => grey.reduce((n, g) => n + (g < 128 ? 1 : 0), 0);

describe('svgSize', () => {
  it('reads width/height, falls back to the viewBox and ignores relative units', () => {
    expect(svgSize('<svg xmlns="http://www.w3.org/2000/svg" width="716" height="578" viewBox="0 0 716 578">')).toEqual({ width: 716, height: 578 });
    expect(svgSize("<svg viewBox='0 0 200 100'>")).toEqual({ width: 200, height: 100 });
    expect(svgSize('<svg width="300px" viewBox="0 0 200 100">')).toEqual({ width: 300, height: 150 });
    expect(svgSize('<svg width="100%" height="100%">')).toBeNull();
    expect(svgSize('not an svg')).toBeNull();
  });

  it('caps the raster size', () => {
    expect(cappedRasterWidth({ width: 700, height: 500 }, 1400)).toBe(1400);
    expect(cappedRasterWidth({ width: 20000, height: 100 }, 40000)).toBe(MAX_RASTER_SIDE);
    expect(cappedRasterWidth({ width: 100, height: 20000 }, 1000)).toBe(20); // height capped at MAX_RASTER_SIDE
    const w = cappedRasterWidth({ width: 1000, height: 1000 }, 3900);
    expect(w * w).toBeLessThanOrEqual(MAX_RASTER_PIXELS);
  });
});

describe('rasterizeSvg', () => {
  const textOnly = (font: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60" viewBox="0 0 200 60" font-family="${font}">` +
    `<text x="10" y="40" font-size="28" font-weight="700" fill="#000">Order API</text></svg>`;

  it('renders a PNG at the requested width with the aspect ratio kept', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"><rect x="10" y="10" width="100" height="50" fill="rgba(9,105,218,0.5)"/></svg>';
    const { png, width, height } = await rasterizeSvg(svg, 600);
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    expect([width, height]).toEqual([600, 300]);
    const decoded = decodePng(png);
    expect([decoded.width, decoded.height]).toEqual([600, 300]);
  });

  it('draws text with the bundled font (WebAssembly has no system fonts)', async () => {
    // none of these families exist in the WebAssembly: the text must fall back to Liberation Sans, not vanish
    for (const font of ["'Segoe UI', 'Helvetica Neue', Arial, sans-serif", 'Arial', 'NoSuchFont']) {
      const { png } = await rasterizeSvg(textOnly(font), 400);
      const { grey } = decodePng(png);
      expect(dark(grey), font).toBeGreaterThan(800);
    }
    const empty = decodePng((await rasterizeSvg('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"/>', 400)).png);
    expect(dark(empty.grey)).toBe(0);
  });

  it('initialises once when called concurrently', async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => rasterizeSvg(textOnly('Arial'), 200)));
    expect(results.every((r) => r.width === 200 && r.height === 60)).toBe(true);
  });

  it('rejects an SVG it cannot parse', async () => {
    await expect(rasterizeSvg('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect></svg>', 20)).rejects.toThrow();
  });
});

describe('placeholderPng', () => {
  it('is a valid PNG of the given size', () => {
    const { width, height, grey } = decodePng(placeholderPng(120, 80));
    expect([width, height]).toEqual([120, 80]);
    expect(grey[0]).toBeLessThan(grey[60 * 40 + 60]!); // darker frame, light inside
  });
});
