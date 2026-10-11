import { deflateSync } from 'node:zlib';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { loadAsset } from '../assets/index.js';

/**
 * SVG -> PNG with resvg (WebAssembly, no native binary). WebAssembly has no system fonts, so diagram text is drawn with
 * the bundled Liberation Sans (metric-compatible with Arial): every family the SVG asks for that is not loaded
 * ('Segoe UI', 'Helvetica Neue', Arial, sans-serif) falls back to it.
 */

export const RASTER_FONT_FAMILY = 'Liberation Sans';
/** Longest side and pixel count of a rasterized image: enough for print, small enough for a Word file. */
export const MAX_RASTER_SIDE = 4000;
export const MAX_RASTER_PIXELS = 8_000_000;

export interface SvgSize {
  width: number;
  height: number;
}

export interface RasterImage {
  png: Buffer;
  width: number;
  height: number;
}

const ROOT_SVG = /<svg\b[^>]*>/i;

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag)?.slice(2).find((v) => v !== undefined);
}

function length(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i.exec(value);
  return m ? Number(m[1]) : null;
}

/** Intrinsic size of an SVG in CSS pixels, from the root element's width/height or else its viewBox. */
export function svgSize(svg: string): SvgSize | null {
  const tag = ROOT_SVG.exec(svg)?.[0];
  if (!tag) return null;
  let width = length(attr(tag, 'width'));
  let height = length(attr(tag, 'height'));
  const box = attr(tag, 'viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (box && box.length === 4 && box.every(Number.isFinite) && box[2]! > 0 && box[3]! > 0) {
    if (width === null && height === null) [width, height] = [box[2]!, box[3]!];
    else if (width === null) width = (height! * box[2]!) / box[3]!;
    else if (height === null) height = (width * box[3]!) / box[2]!;
  }
  return width && height && width > 0 && height > 0 ? { width, height } : null;
}

/** The width in pixels to rasterize at: as asked, but within MAX_RASTER_SIDE and MAX_RASTER_PIXELS. */
export function cappedRasterWidth(size: SvgSize, wanted: number): number {
  const aspect = size.height / size.width;
  let width = Math.max(1, wanted);
  width = Math.min(width, MAX_RASTER_SIDE, MAX_RASTER_SIDE / aspect, Math.sqrt(MAX_RASTER_PIXELS / aspect));
  return Math.max(1, Math.floor(width));
}

let wasmReady: Promise<void> | null = null;
let fontsReady: Promise<Uint8Array[]> | null = null;

/** Loads the WebAssembly once; concurrent callers share the same promise, a failure lets the next call try again. */
function ensureWasm(): Promise<void> {
  wasmReady ??= loadAsset('resvg.wasm')
    .then((bytes) => initWasm(bytes))
    .catch((err: unknown) => {
      wasmReady = null;
      throw err;
    });
  return wasmReady;
}

function fonts(): Promise<Uint8Array[]> {
  fontsReady ??= Promise.all([loadAsset('LiberationSans-Regular.ttf'), loadAsset('LiberationSans-Bold.ttf')]).catch((err: unknown) => {
    fontsReady = null;
    throw err;
  });
  return fontsReady;
}

/** Renders an SVG to a PNG `width` pixels wide (capped, see cappedRasterWidth) on a white background. */
export async function rasterizeSvg(svg: string, width: number): Promise<RasterImage> {
  const size = svgSize(svg);
  const target = size ? cappedRasterWidth(size, width) : Math.min(Math.max(1, Math.floor(width)), MAX_RASTER_SIDE);
  const [, fontBuffers] = await Promise.all([ensureWasm(), fonts()]);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: target },
    background: '#ffffff',
    font: {
      fontBuffers,
      loadSystemFonts: false,
      defaultFontFamily: RASTER_FONT_FAMILY,
      sansSerifFamily: RASTER_FONT_FAMILY,
    },
  });
  try {
    const image = resvg.render();
    try {
      return { png: Buffer.from(image.asPng()), width: image.width, height: image.height };
    } finally {
      image.free();
    }
  } finally {
    resvg.free();
  }
}

// ---- placeholder ------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * A plain light-grey frame used as the PNG fallback of a diagram that could not be rasterized (Word 2016+ still shows the
 * SVG; older viewers show this instead of nothing).
 */
export function placeholderPng(width = 240, height = 150): Buffer {
  const w = Math.max(4, Math.round(width));
  const h = Math.max(4, Math.round(height));
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const edge = x < 2 || y < 2 || x >= w - 2 || y >= h - 2;
      const [r, g, b] = edge ? [0xc4, 0xc9, 0xd0] : [0xf3, 0xf4, 0xf6];
      raw.set([r, g, b], row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, deflate, no filter, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
