/**
 * OLE2 / Compound File Binary sniffing. Office wraps password-protected .docx/.xlsx/.pptx in such a container, and
 * it is also the format of legacy Word/Excel/PowerPoint 97-2003 files; the stream names tell them apart.
 */
import { DEFAULT_LANG, t, type Lang } from '../i18n.js';
import { documentError, type DocumentError } from './types.js';

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export function isOle(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && OLE_MAGIC.every((v, i) => bytes[i] === v);
}

interface DirEntry {
  name: string;
  type: number;
  left: number;
  right: number;
  child: number;
}

const NO_SECTOR = 0xfffffffa;
const NO_STREAM = 0xffffffff;

/**
 * Names of the streams and storages directly in the root storage (best effort, never throws). Only the root's own
 * entries count: an embedded object (e.g. a Word document inside an .xls) lives in a sub-storage. Every walk is
 * bounded by the file size, so a crafted header cannot make it allocate or loop more than the file allows.
 */
function streamNames(b: Uint8Array): Set<string> {
  const names = new Set<string>();
  try {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const shift = dv.getUint16(30, true);
    if (shift !== 9 && shift !== 12) throw new Error('bad sector shift');
    const ss = 1 << shift;
    const perSector = ss / 4;
    const maxSectors = Math.max(0, Math.floor(b.length / ss) - 1);
    const sectorOff = (s: number) => (s + 1) * ss;
    const inFile = (s: number) => s < maxSectors;
    // FAT sector numbers: the first 109 in the header, the rest in the DIFAT chain
    const nFat = Math.min(dv.getUint32(44, true), Math.ceil(maxSectors / perSector));
    const fatSectors: number[] = [];
    for (let i = 0; i < 109 && fatSectors.length < nFat; i++) fatSectors.push(dv.getUint32(76 + i * 4, true));
    const seenDifat = new Set<number>();
    for (let d = dv.getUint32(68, true); d < NO_SECTOR && inFile(d) && fatSectors.length < nFat && !seenDifat.has(d); ) {
      seenDifat.add(d);
      const o = sectorOff(d);
      for (let i = 0; i < perSector - 1 && fatSectors.length < nFat; i++) fatSectors.push(dv.getUint32(o + i * 4, true));
      d = dv.getUint32(o + ss - 4, true);
    }
    // FAT entries are looked up when needed instead of materialising the whole table
    const next = (s: number): number => {
      const fs = fatSectors[Math.floor(s / perSector)];
      if (fs === undefined || !inFile(fs)) return 0xfffffffe;
      return dv.getUint32(sectorOff(fs) + (s % perSector) * 4, true);
    };
    const entries: DirEntry[] = [];
    const seen = new Set<number>();
    for (let s = dv.getUint32(48, true); s < NO_SECTOR && inFile(s) && !seen.has(s); s = next(s)) {
      seen.add(s);
      const o = sectorOff(s);
      for (let e = 0; e < ss / 128; e++) {
        const eo = o + e * 128;
        const nameLen = dv.getUint16(eo + 64, true);
        let name = '';
        for (let i = 0; i < Math.min(32, nameLen / 2) - 1; i++) name += String.fromCharCode(dv.getUint16(eo + i * 2, true));
        entries.push({ name, type: b[eo + 66]!, left: dv.getUint32(eo + 68, true), right: dv.getUint32(eo + 72, true), child: dv.getUint32(eo + 76, true) });
      }
    }
    // the root's children form a tree of siblings (left/right); do not descend into sub-storages
    const stack = entries[0]?.type === 5 ? [entries[0].child] : [];
    const visited = new Set<number>();
    while (stack.length) {
      const id = stack.pop()!;
      if (id === NO_STREAM || id >= entries.length || visited.has(id)) continue;
      visited.add(id);
      const en = entries[id]!;
      if (en.type === 1 || en.type === 2) names.add(en.name);
      stack.push(en.left, en.right);
    }
  } catch {
    // fall back to scanning below
  }
  if (names.size === 0) {
    // look for well-known UTF-16LE stream names anywhere in the container
    const all = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
    for (const n of ['EncryptionInfo', 'EncryptedPackage', 'WordDocument', 'Workbook', 'Book', 'PowerPoint Document']) {
      if (all.indexOf(Buffer.from(n, 'utf16le')) >= 0) names.add(n);
    }
  }
  return names;
}

const OFFICE_LABEL = {
  docx: 'doc.label.docx',
  xlsx: 'doc.label.xlsx',
  xlsm: 'doc.label.xlsx',
  pptx: 'doc.label.pptx',
} as const;

/** The error to report (in `lang`) for an OLE2 file: encrypted Office document, legacy 97-2003 format or something else. */
export function oleError(bytes: Uint8Array, ext: string, lang: Lang = DEFAULT_LANG): DocumentError {
  const names = streamNames(bytes);
  if (names.has('EncryptionInfo') || names.has('EncryptedPackage')) {
    const label = t(lang, OFFICE_LABEL[ext as keyof typeof OFFICE_LABEL] ?? 'doc.label.office');
    return documentError('ENCRYPTED', t(lang, 'doc.ole.encrypted', { label }));
  }
  if (names.has('WordDocument')) return documentError('LEGACY_FORMAT', t(lang, 'doc.ole.doc'));
  if (names.has('Workbook') || names.has('Book')) return documentError('LEGACY_FORMAT', t(lang, 'doc.ole.xls'));
  if (names.has('PowerPoint Document')) return documentError('LEGACY_FORMAT', t(lang, 'doc.ole.ppt'));
  return documentError('UNSUPPORTED', t(lang, 'doc.ole.other'));
}
