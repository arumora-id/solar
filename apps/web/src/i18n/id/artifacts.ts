import type { KnowledgeType } from '@solar/shared';
import { numId } from '../helpers';

/** Artifacts: components/Artifacts.tsx and the knowledge type names of lib/knowledgeTypes.ts (typeLabel). */
export const artifacts = {
  /** Knowledge types (lib/knowledgeTypes.ts typeLabel(), also the Knowledge settings and "Simpan ke knowledge base"). */
  knowledgeType: {
    landscape: 'Landscape',
    system: 'Sistem',
    integration: 'Integrasi',
    standard: 'Standar',
    principle: 'Prinsip',
    nfr: 'NFR / keamanan',
    process: 'Proses',
    document: 'Struktur dokumen',
    decision: 'Keputusan (ADR)',
    glossary: 'Glosarium',
    reference: 'Referensi',
  } satisfies Record<KnowledgeType, string>,

  /** Heading of a group of files, by artifact family (the part of the kind before "-"). */
  groups: {
    archimate: 'ArchiMate',
    sequence: 'Sequence diagram',
    tsd: 'Technical Specification',
    other: 'Lainnya',
  },
  /** Heading of a group whose family is unknown to this version of the app. */
  groupFallback: 'Artefak',

  downloadAll: 'Unduh semua (ZIP)',
  /** The request did not reach the server (no HTTP answer). */
  offline: 'Server tidak bisa dihubungi, coba lagi.',

  /** One file of a group. */
  row: {
    preview: (name: string) => `Pratinjau ${name}`,
    /** Eye button of a file the browser cannot show (e.g. .docx): opens the download dialog. */
    info: (name: string) => `Info ${name}`,
    notViewable: 'Tidak bisa dipratinjau di browser',
    download: (name: string) => `Unduh ${name}`,
    saveToKnowledge: (name: string) => `Simpan ${name} ke knowledge base`,
  },

  /** The Word (.docx) file of a Technical Specification. */
  word: {
    download: 'Unduh Word (.docx)',
    downloadTitle: (name: string) => `Unduh ${name}, dokumen Word untuk klien`,
    create: 'Buat Word (.docx)',
    creating: 'Membuat Word…',
    createTitle: 'Buat dokumen Word dari spesifikasi ini',
    failed: (reason: string) => `Dokumen Word gagal dibuat: ${reason}`,
    /** Reasons after "Dokumen Word gagal dibuat:"; the server's own message is shown under "Rincian". */
    errors: {
      offline: 'server tidak bisa dihubungi, coba lagi.',
      invalid: 'spesifikasi ini tidak valid untuk dibuat versi Word-nya.',
      notFound: 'artefak tidak ditemukan (mungkin sudah dihapus).',
      server: 'server gagal membuat dokumen Word, coba lagi nanti.',
    },
    createdWithNotes: (n: number) => `Dokumen Word dibuat dengan ${numId(n)} catatan.`,
    /** Announced to screen readers when the Word file is ready. */
    ready: 'Dokumen Word siap diunduh.',
    noPreview:
      'Dokumen Word tidak bisa dipratinjau di browser. Unduh lalu buka di Microsoft Word, LibreOffice Writer atau Google Docs.',
    previewHtml: 'Pratinjau versi HTML',
    htmlHint: 'Versi HTML memuat isi yang sama, tanpa tata letak halaman Word (sampul, nomor halaman).',
  },

  /** Preview dialog. */
  preview: {
    /** A file that is neither text nor image. */
    noPreview: 'File ini tidak bisa dipratinjau di browser. Unduh untuk membukanya.',
  },

  /** "Simpan ke knowledge base" dialog for a Markdown artifact. */
  saveToKnowledge: {
    title: 'Simpan ke knowledge base',
    intro: (name: string) =>
      `${name} disalin ke knowledge base sebagai file Markdown. Isinya diikuti agent di atas aturan bawaan, jadi simpan hanya dokumen yang sudah Anda periksa.`,
    idLabel: 'ID (nama di diagram dan dokumen)',
    titlePlaceholder: 'Kosongkan untuk memakai judul dokumen',
    aliasesLabel: 'Alias (pisahkan dengan koma, opsional)',
    aliasesPlaceholder: 'mis. AD1 Gateway, ADI Gate',
    overwrite: 'Ganti file yang sudah ada',
    /** "{path}" marks where the saved path is shown (as code). */
    savedAs: 'Tersimpan sebagai {path}.',
    /** After saving; `where` is the place in the app to manage it ("Pengaturan → Knowledge"). */
    savedForAgent: (where: string) => `Agent membacanya mulai task berikutnya; kelola di ${where}.`,
    savedGuidance: (where: string) =>
      `File di folder berawalan "_" atau README.md adalah panduan untuk manusia dan tidak dibaca agent; kelola di ${where}.`,
  },
};
