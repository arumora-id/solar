/**
 * Guarded ZIP reader for Office Open XML packages. Every part is inflated through `stream`, which caps the bytes it
 * actually inflates (declared sizes are checked first, and output beyond the declared size aborts the entry), so zip
 * bombs, including ones with lying headers, never materialise.
 */
import { Inflate } from 'fflate';
import { fmtInt, fmtMB, MB, parseAttrs, type Deadline, type Limits } from './limits.js';
import { DocumentError, documentError } from './types.js';

interface ZipEntry {
  name: string;
  flags: number;
  method: number;
  csize: number;
  usize: number;
  lho: number;
}

const STOP = Symbol('stop');
/** Fully read parts above this size are rejected when their compression ratio is suspicious. */
const BOMB_MIN_BYTES = 8 * MB;
/** Small input chunks keep each inflate burst bounded (deflate expands at most ~1032:1). */
const INPUT_CHUNK = 16 * 1024;

export class ZipArchive {
  /** Bytes inflated so far, over all parts. */
  inflatedTotal = 0;
  private readonly cache = new Map<string, Uint8Array>();
  private readonly entries = new Map<string, ZipEntry>();
  private readonly lower = new Map<string, ZipEntry>();
  private readonly view: DataView;

  constructor(
    private readonly buf: Uint8Array,
    private readonly limits: Limits,
    private readonly deadline: Deadline,
    /** e.g. "dokumen Word (.docx)", used in error messages. */
    private readonly label: string,
  ) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.readDirectory();
  }

  private corrupt(detail: string): DocumentError {
    return documentError('CORRUPT', `File rusak atau bukan ${this.label} yang valid (${detail}).`);
  }

  private readDirectory(): void {
    const b = this.buf;
    const dv = this.view;
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
      if (b[i] === 0x50 && b[i + 1] === 0x4b && dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw this.corrupt('akhir direktori ZIP tidak ditemukan');
    let count = dv.getUint16(eocd + 10, true);
    let cdSize = dv.getUint32(eocd + 12, true);
    let cdOff = dv.getUint32(eocd + 16, true);
    if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {
      const loc = eocd - 20;
      if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
        const z = Number(dv.getBigUint64(loc + 8, true));
        if (z >= 0 && z + 56 <= b.length && dv.getUint32(z, true) === 0x06064b50) {
          count = Number(dv.getBigUint64(z + 32, true));
          cdSize = Number(dv.getBigUint64(z + 40, true));
          cdOff = Number(dv.getBigUint64(z + 48, true));
        }
      }
    }
    if (count > this.limits.maxEntries) {
      throw documentError('TOO_LARGE', `File berisi ${fmtInt(count)} entri ZIP (batas ${fmtInt(this.limits.maxEntries)}).`);
    }
    if (cdOff + cdSize > b.length) throw this.corrupt('direktori ZIP berada di luar file');
    const utf8 = new TextDecoder('utf-8');
    let p = cdOff;
    for (let i = 0; i < count; i++) {
      if (p + 46 > b.length || dv.getUint32(p, true) !== 0x02014b50) throw this.corrupt('entri direktori ZIP tidak valid');
      const flags = dv.getUint16(p + 8, true);
      const method = dv.getUint16(p + 10, true);
      let csize = dv.getUint32(p + 20, true);
      let usize = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true);
      const xlen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      let lho = dv.getUint32(p + 42, true);
      if (p + 46 + nlen + xlen > b.length) throw this.corrupt('entri direktori ZIP terpotong');
      const name = utf8
        .decode(b.subarray(p + 46, p + 46 + nlen))
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
      if (usize === 0xffffffff || csize === 0xffffffff || lho === 0xffffffff) {
        // ZIP64 extra field
        let x = p + 46 + nlen;
        const xend = x + xlen;
        while (x + 4 <= xend) {
          const id = dv.getUint16(x, true);
          const sz = dv.getUint16(x + 2, true);
          if (id === 0x0001) {
            let q = x + 4;
            const next = () => {
              if (q + 8 > xend) throw this.corrupt('data ZIP64 tidak lengkap');
              const v = Number(dv.getBigUint64(q, true));
              q += 8;
              return v;
            };
            if (usize === 0xffffffff) usize = next();
            if (csize === 0xffffffff) csize = next();
            if (lho === 0xffffffff) lho = next();
            break;
          }
          x += 4 + sz;
        }
      }
      if (!name.endsWith('/')) {
        const e: ZipEntry = { name, flags, method, csize, usize, lho };
        this.entries.set(name, e);
        this.lower.set(name.toLowerCase(), e);
      }
      p += 46 + nlen + xlen + clen;
    }
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  get(name: string): ZipEntry | null {
    const n = name.replace(/^\/+/, '');
    return this.entries.get(n) ?? this.lower.get(n.toLowerCase()) ?? null;
  }

  has(name: string): boolean {
    return this.get(name) !== null;
  }

  private tooLarge(detail: string): DocumentError {
    return documentError('TOO_LARGE', `File terlalu besar: ${detail}. Pecah dokumen menjadi beberapa file.`);
  }

  private bomb(detail: string): DocumentError {
    return documentError('ZIP_BOMB', `File ditolak karena terindikasi zip bomb: ${detail}.`);
  }

  /** Validates an entry before inflating it and returns where its data starts. */
  private check(e: ZipEntry, maxBytes: number, streaming: boolean): number {
    if (e.flags & 1) throw documentError('ENCRYPTED', `${capitalize(this.label)} ini dilindungi kata sandi (entri ZIP terenkripsi). Hapus kata sandinya lalu lampirkan lagi.`);
    if (e.method !== 0 && e.method !== 8) throw this.corrupt(`metode kompresi ZIP ${e.method} tidak didukung untuk "${e.name}"`);
    const ratio = e.csize > 0 ? e.usize / e.csize : Infinity;
    const expands = `"${e.name}" mengembang menjadi ${fmtMB(e.usize)} dari ${fmtMB(e.csize)} (rasio ${Math.round(ratio)}:1)`;
    if (streaming && ratio > this.limits.maxCompressionRatio && e.usize > this.limits.maxEntryBytes) throw this.bomb(expands);
    // Streamed parts (worksheets, shared strings) are consumed incrementally and may stop early, so their declared
    // size is no reason to reject them; the bytes actually inflated stay capped.
    if (!streaming && ratio > this.limits.maxCompressionRatio && e.usize > BOMB_MIN_BYTES) throw this.bomb(expands);
    if (!streaming && e.usize > maxBytes) {
      throw this.tooLarge(`bagian "${e.name}" mengembang menjadi ${fmtMB(e.usize)} (batas ${fmtMB(maxBytes)} per bagian)`);
    }
    if (!streaming && this.inflatedTotal + e.usize > this.limits.maxTotalInflatedBytes) {
      throw this.tooLarge(`isinya mengembang lebih dari ${fmtMB(this.limits.maxTotalInflatedBytes)}`);
    }
    const dv = this.view;
    if (e.lho + 30 > this.buf.length || dv.getUint32(e.lho, true) !== 0x04034b50) throw this.corrupt(`header lokal "${e.name}" tidak valid`);
    const start = e.lho + 30 + dv.getUint16(e.lho + 26, true) + dv.getUint16(e.lho + 28, true);
    if (start + e.csize > this.buf.length) throw this.corrupt(`entri "${e.name}" terpotong`);
    return start;
  }

  private account(n: number): void {
    this.inflatedTotal += n;
    if (this.inflatedTotal > this.limits.maxTotalInflatedBytes) {
      throw this.tooLarge(`isinya mengembang lebih dari ${fmtMB(this.limits.maxTotalInflatedBytes)}`);
    }
  }

  /**
   * Stream-inflates an entry; `onChunk` may return false to stop early. Never inflates more than
   * min(declared size, maxBytes) bytes: output beyond the declared size means the header lies and aborts at once.
   * `streaming` parts are consumed incrementally, so only their real output counts against the limits.
   */
  stream(name: string | ZipEntry, onChunk: (chunk: Uint8Array) => boolean | void, maxBytes = this.limits.maxEntryBytes, streaming = false): void {
    const e = typeof name === 'string' ? this.get(name) : name;
    if (!e) throw this.corrupt(`bagian "${String(name)}" tidak ada`);
    const start = this.check(e, maxBytes, streaming);
    const data = this.buf.subarray(start, start + e.csize);
    if (e.method === 0) {
      if (e.csize !== e.usize) throw this.corrupt(`ukuran entri "${e.name}" tidak konsisten`);
      if (e.usize > maxBytes) throw this.tooLarge(`bagian "${e.name}" lebih dari ${fmtMB(maxBytes)}`);
      this.account(e.usize);
      onChunk(data);
      return;
    }
    let produced = 0;
    let stop = false;
    const inflate = new Inflate((chunk) => {
      if (stop || !chunk.length) return;
      produced += chunk.length;
      if (produced > e.usize) throw this.bomb(`"${e.name}" mengembang melebihi ukuran yang dinyatakan (${fmtInt(e.usize)} byte)`);
      if (produced > maxBytes) throw this.tooLarge(`bagian "${e.name}" mengembang lebih dari ${fmtMB(maxBytes)}`);
      this.account(chunk.length);
      if (onChunk(chunk) === false) {
        stop = true;
        throw STOP;
      }
    });
    try {
      for (let off = 0; off < data.length && !stop; off += INPUT_CHUNK) {
        if ((off & 0xfffff) === 0) this.deadline.check();
        const end = Math.min(data.length, off + INPUT_CHUNK);
        inflate.push(data.subarray(off, end), end === data.length);
      }
    } catch (err) {
      if (err === STOP) return;
      if (err instanceof DocumentError) throw err;
      throw this.corrupt(`"${e.name}" tidak bisa didekompresi: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!stop && produced !== e.usize) throw this.corrupt(`ukuran "${e.name}" tidak cocok (dinyatakan ${e.usize}, hasil ${produced})`);
  }

  /** Inflates a whole part (null when it does not exist). */
  read(name: string, maxBytes = this.limits.maxEntryBytes): Uint8Array | null {
    const e = this.get(name);
    if (!e) return null;
    const cached = this.cache.get(e.name);
    if (cached) return cached;
    const out = new Uint8Array(Math.min(e.usize, maxBytes));
    let pos = 0;
    this.stream(
      e,
      (c) => {
        out.set(c, pos);
        pos += c.length;
      },
      maxBytes,
    );
    const res = pos === out.length ? out : out.subarray(0, pos);
    if (e.usize < 4 * MB) this.cache.set(e.name, res);
    return res;
  }

  text(name: string, maxBytes?: number): string | null {
    const b = this.read(name, maxBytes);
    if (!b) return null;
    const s = new TextDecoder('utf-8').decode(b);
    return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
  }

  /** Incrementally decodes a part as UTF-8; `onText` may return false to stop. Returns true when stopped early. */
  streamText(name: string, onText: (text: string) => boolean | void, maxBytes?: number, streaming = false): boolean {
    const dec = new TextDecoder('utf-8');
    let first = true;
    let stopped = false;
    this.stream(
      name,
      (c) => {
        let s = dec.decode(c, { stream: true });
        if (first) {
          if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
          first = false;
        }
        if (onText(s) === false) {
          stopped = true;
          return false;
        }
        return true;
      },
      maxBytes,
      streaming,
    );
    if (!stopped) {
      const tail = dec.decode();
      if (tail) onText(tail);
    }
    return stopped;
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// --- OPC (Open Packaging Conventions) helpers --------------------------------------------------

export interface Relationship {
  id: string;
  type: string;
  target: string;
  external: boolean;
}

export function parseRels(xml: string | null): Relationship[] {
  const rels: Relationship[] = [];
  if (!xml) return rels;
  for (const m of xml.matchAll(/<(?:\w+:)?Relationship\b([^<>]*?)\/?>/g)) {
    const a = parseAttrs(m[1]);
    rels.push({ id: a.Id ?? '', type: a.Type ?? '', target: a.Target ?? '', external: a.TargetMode === 'External' });
  }
  return rels;
}

/** Resolves a relationship target against the directory of its source part. */
export function resolvePart(baseDir: string, target: string): string {
  if (!target) return '';
  if (target.startsWith('/')) return target.replace(/^\/+/, '');
  const out: string[] = [];
  for (const p of [...(baseDir ? baseDir.split('/') : []), ...target.split('/')]) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

export const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const relsPathOf = (p: string) => `${dirOf(p) ? `${dirOf(p)}/` : ''}_rels/${p.slice(p.lastIndexOf('/') + 1)}.rels`;

export type OoxmlKind = 'docx' | 'xlsx' | 'pptx';

export interface OoxmlPackage {
  kind: OoxmlKind | null;
  /** Path of the main part (word/document.xml, xl/workbook.xml, ppt/presentation.xml). */
  mainPart: string;
  mainType: string;
  /** Why the package is not supported (Visio, OpenDocument, .xlsb), Indonesian. */
  unsupported: string | null;
}

/** Identifies the kind of Office package from its content types and root relationships (not from the file name). */
export function classifyOoxml(zip: ZipArchive): OoxmlPackage {
  const overrides = new Map<string, string>();
  const ctXml = zip.text('[Content_Types].xml', 4 * MB);
  if (ctXml) {
    for (const m of ctXml.matchAll(/<(?:\w+:)?Override\b([^<>]*?)\/?>/g)) {
      const a = parseAttrs(m[1]);
      if (a.PartName) overrides.set(a.PartName.replace(/^\/+/, '').toLowerCase(), a.ContentType ?? '');
    }
  }
  const officeRel = parseRels(zip.text('_rels/.rels', 4 * MB)).find((r) => /\/officeDocument$/.test(r.type) && !r.external);
  let mainPart = officeRel ? resolvePart('', officeRel.target) : '';
  const mainType = mainPart ? (overrides.get(mainPart.toLowerCase()) ?? '') : '';
  const t = mainType.toLowerCase();
  let kind: OoxmlKind | null = null;
  let unsupported: string | null = null;
  if (/wordprocessingml\.(document|template)\.main|ms-word\.(document|template)\.macroenabled/.test(t)) kind = 'docx';
  else if (/spreadsheetml\.(sheet|template)\.main|ms-excel\.(sheet|template)\.macroenabled\.main/.test(t)) kind = 'xlsx';
  else if (/presentationml\.(presentation|slideshow|template)\.main|ms-powerpoint\.(presentation|slideshow|template)\.macroenabled\.main/.test(t)) kind = 'pptx';
  else if (/ms-excel\.sheet\.binary/.test(t)) unsupported = 'Excel Binary Workbook (.xlsb) belum didukung; simpan sebagai .xlsx atau .csv';
  else if (/ms-visio/.test(t) || zip.has('visio/document.xml')) unsupported = 'gambar Visio (.vsdx) belum didukung; ekspor ke PDF';
  else if (!t) {
    // no content type for the main part: fall back on well-known part names (some producers are sloppy)
    if (zip.has('word/document.xml')) [kind, mainPart] = ['docx', 'word/document.xml'];
    else if (zip.has('xl/workbook.xml')) [kind, mainPart] = ['xlsx', 'xl/workbook.xml'];
    else if (zip.has('ppt/presentation.xml')) [kind, mainPart] = ['pptx', 'ppt/presentation.xml'];
    else if ((zip.text('mimetype', 4096) ?? '').includes('opendocument')) {
      unsupported = 'file OpenDocument (.odt/.ods/.odp) belum didukung; simpan sebagai .docx, .xlsx atau .pptx';
    }
  }
  if (kind && !zip.has(mainPart)) kind = null;
  return { kind, mainPart, mainType, unsupported };
}
