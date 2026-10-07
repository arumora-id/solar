/**
 * OLE2 / Compound File Binary sniffing. Office wraps password-protected .docx/.xlsx/.pptx in such a container, and
 * it is also the format of legacy Word/Excel/PowerPoint 97-2003 files; the stream names tell them apart.
 */
import { documentError, type DocumentError } from './types.js';

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export function isOle(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && OLE_MAGIC.every((v, i) => bytes[i] === v);
}

/** Names of the storages and streams in the container (best effort, never throws). */
function streamNames(b: Uint8Array): Set<string> {
  const names = new Set<string>();
  try {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const shift = dv.getUint16(30, true);
    if (shift !== 9 && shift !== 12) throw new Error('bad sector shift');
    const ss = 1 << shift;
    const nFat = dv.getUint32(44, true);
    const dirStart = dv.getUint32(48, true);
    let difatSector = dv.getUint32(68, true);
    const nDifat = dv.getUint32(72, true);
    const sectorOff = (s: number) => (s + 1) * ss;
    const fatSectors: number[] = [];
    for (let i = 0; i < 109 && fatSectors.length < nFat; i++) fatSectors.push(dv.getUint32(76 + i * 4, true));
    for (let d = 0; d < nDifat && difatSector < 0xfffffffa && fatSectors.length < nFat && d < 10_000; d++) {
      const o = sectorOff(difatSector);
      if (o + ss > b.length) break;
      for (let i = 0; i < ss / 4 - 1 && fatSectors.length < nFat; i++) fatSectors.push(dv.getUint32(o + i * 4, true));
      difatSector = dv.getUint32(o + ss - 4, true);
    }
    const fat: number[] = [];
    for (const fs of fatSectors.slice(0, 50_000)) {
      const o = sectorOff(fs);
      if (o + ss > b.length) break;
      for (let i = 0; i < ss / 4; i++) fat.push(dv.getUint32(o + i * 4, true));
    }
    const seen = new Set<number>();
    for (let s = dirStart; s < 0xfffffffa && !seen.has(s) && seen.size < 10_000; s = fat[s] ?? 0xfffffffe) {
      seen.add(s);
      const o = sectorOff(s);
      if (o + ss > b.length) break;
      for (let e = 0; e < ss / 128; e++) {
        const eo = o + e * 128;
        const nameLen = dv.getUint16(eo + 64, true);
        const type = b[eo + 66];
        if (!nameLen || nameLen > 64 || (type !== 1 && type !== 2 && type !== 5)) continue;
        let n = '';
        for (let i = 0; i < nameLen / 2 - 1; i++) n += String.fromCharCode(dv.getUint16(eo + i * 2, true));
        names.add(n);
      }
    }
  } catch {
    // fall back to scanning below
  }
  if (names.size <= 1) {
    // look for well-known UTF-16LE stream names anywhere in the container
    const all = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
    for (const n of ['EncryptionInfo', 'EncryptedPackage', 'WordDocument', 'Workbook', 'Book', 'PowerPoint Document']) {
      if (all.indexOf(Buffer.from(n, 'utf16le')) >= 0) names.add(n);
    }
  }
  return names;
}

const OFFICE_LABEL: Record<string, string> = {
  docx: 'dokumen Word',
  xlsx: 'workbook Excel',
  xlsm: 'workbook Excel',
  pptx: 'presentasi PowerPoint',
};

/** The error to report for an OLE2 file: encrypted Office document, legacy 97-2003 format or something else. */
export function oleError(bytes: Uint8Array, ext: string): DocumentError {
  const names = streamNames(bytes);
  if (names.has('EncryptionInfo') || names.has('EncryptedPackage')) {
    return documentError(
      'ENCRYPTED',
      `${capitalize(OFFICE_LABEL[ext] ?? 'dokumen Office')} ini dilindungi kata sandi (terenkripsi). Hapus kata sandinya di Office (File → Info → Protect → Encrypt with Password), simpan, lalu lampirkan lagi.`,
    );
  }
  if (names.has('WordDocument')) {
    return documentError('LEGACY_FORMAT', 'Format Word 97-2003 (.doc) belum didukung. Buka di Word lalu simpan sebagai .docx (atau ekspor ke PDF), kemudian lampirkan lagi.');
  }
  if (names.has('Workbook') || names.has('Book')) {
    return documentError('LEGACY_FORMAT', 'Format Excel 97-2003 (.xls) belum didukung. Simpan sebagai .xlsx (atau .csv), kemudian lampirkan lagi.');
  }
  if (names.has('PowerPoint Document')) {
    return documentError('LEGACY_FORMAT', 'Format PowerPoint 97-2003 (.ppt) belum didukung. Simpan sebagai .pptx (atau ekspor ke PDF), kemudian lampirkan lagi.');
  }
  return documentError('UNSUPPORTED', 'File ini berformat OLE2 (Office lama atau format lain) dan belum didukung. Simpan sebagai .docx, .xlsx, .pptx atau PDF.');
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
