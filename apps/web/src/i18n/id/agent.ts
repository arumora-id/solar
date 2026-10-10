import { numId } from '../helpers';

/**
 * Agent page: pages/AgentPage.tsx (speech bubble, quick prompts, conversation), components/AgentBubble.tsx,
 * Composer.tsx, Attachments.tsx, ConfirmationDialog.tsx and lib/markdown.ts.
 */
export const agent = {
  /** The character's first words in the speech bubble. */
  greeting: 'Halo! Saya SOLAR AI AGENT, asisten solution architect Anda. Ketik atau ucapkan kebutuhan Anda.',

  /**
   * Quick prompt chips under the character: the label, and the text put in the composer. The text is a request to the
   * agent in this language, so the agent answers in it too. Keys are the order of AgentPage's QUICK_PROMPTS.
   */
  quickPrompts: {
    fromDocuments: {
      label: 'Dari dokumen',
      text: 'Pelajari semua dokumen terlampir, lalu buatkan paket arsitektur lengkap (model ArchiMate, sequence diagram skenario utama dan error, serta Technical Specification Document) sesuai isinya. Catat asumsi dan pertanyaan terbuka. Fokus: ',
    },
    fullPackage: {
      label: 'Paket lengkap',
      text: 'Buatkan paket arsitektur lengkap dalam sekali proses: model ArchiMate (Layered View dan Application Cooperation View), sequence diagram untuk skenario utama dan alur error, serta Technical Specification Document. Sistem: ',
    },
    archimate: {
      label: 'Diagram ArchiMate',
      text: 'Buatkan model ArchiMate 3.2 (Layered View) untuk sistem berikut: ',
    },
    sequence: {
      label: 'Sequence diagram',
      text: 'Buatkan sequence diagram (happy path dan error path) untuk alur: ',
    },
    techSpec: {
      label: 'Technical Spec',
      text: 'Susun Technical Specification Document (TSD) lengkap untuk: ',
    },
    planeBacklog: {
      label: 'Backlog Plane',
      text: 'Buat backlog di Plane (plane.mesthi.com) dari TSD terakhir: epic per komponen, story per functional requirement.',
    },
    publishGithub: {
      label: 'Publish GitHub',
      text: 'Publish semua artefak dari task terakhir ke GitHub di folder docs/architecture/',
    },
  },

  /** The speech bubble above the character: `text` is the main line, `sub` the smaller one under it. */
  speech: {
    connecting: 'Menghubungkan ke server SOLAR AI AGENT…',
    llmMissing: 'Model AI belum siap',
    llmMissingSub: 'Isi OPENAI_API_KEY di .env, atau tambahkan provider di Pengaturan → Model AI.',
    listening: 'Saya mendengarkan…',
    listeningSub: 'Bicaralah, saya berhenti otomatis saat Anda diam.',
    done: 'Selesai! Semua deliverable siap.',
    doneSub: 'Lihat artefak di panel percakapan.',
    failed: 'Ada kendala…',
    failedSub: 'Detail error ada di percakapan dan monitor.',
    needsApproval: 'Butuh persetujuan Anda',
    /** While a task runs and the server has not named its step yet. */
    working: 'Sedang bekerja…',
    speaking: 'Ringkasan hasil…',
    idleSub: 'Klik saya untuk mulai bicara.',
  },

  /** The conversation panel of the Agent page. */
  chat: {
    title: 'Percakapan',
    dropTitle: 'Lepaskan untuk melampirkan dokumen',
    dropFormats: 'PDF, Word, Excel, PowerPoint, Markdown atau teks',
    stopSpeaking: 'Hentikan suara',
    newConversation: 'Percakapan baru',
    newConversationTitle: 'Mulai percakapan baru (konteks sebelumnya tidak dibawa)',
    emptyTitle: 'Mulai dengan satu perintah.',
    emptyExample:
      'Contoh: “Buatkan paket arsitektur lengkap untuk sistem pemesanan online dengan pembayaran via payment gateway, deploy di Kubernetes, database PostgreSQL.”',
    emptyAttach: 'Punya dokumen proyek? Lampirkan PDF, Word, Excel, PowerPoint atau Markdown dengan tombol klip, atau seret file ke sini.',
  },

  /** The agent's answer bubble (AgentBubble.tsx). */
  bubble: {
    costTitle: 'Estimasi biaya API',
    cancelTask: 'Batalkan',
    progressLabel: (title: string) => `Progres ${title}`,
    cancelled: 'Task dibatalkan.',
    /** The collapsible list of tool calls, progress notes and approvals; n = the steps that are not notes. */
    steps: (n: number) => `Langkah kerja (${numId(n)})`,
    awaitingApproval: (action: string) => `Menunggu persetujuan: ${action}`,
    approved: 'Disetujui',
    rejected: 'Ditolak',
    rejectedWithNote: (note: string) => `Ditolak (${note})`,
  },

  /** The prompt box (Composer.tsx). */
  composer: {
    promptLabel: 'Perintah untuk SOLAR',
    placeholder: 'Ketik perintah… (Enter kirim, Shift+Enter baris baru)',
    placeholderWithFiles: 'Apa yang harus dibuat dari dokumen ini?',
    micStart: 'Bicara (input suara)',
    micStop: 'Berhenti mendengarkan',
    micTitle: 'Input suara',
    micTitleWhisper: 'Input suara (Whisper lokal)',
    micUnavailable: 'Input suara tidak tersedia',
    attachLabel: 'Lampirkan dokumen',
    attachTitle: (maxMb: number, maxFiles: number) =>
      `Lampirkan dokumen proyek: PDF, Word, Excel, PowerPoint, Markdown, teks (maks ${numId(maxMb)} MB, ${numId(maxFiles)} file). Bisa juga seret file ke percakapan.`,
    attachmentsLabel: 'Lampiran untuk permintaan ini',
    listening: 'Mendengarkan…',
    readingAttachments: 'Membaca dokumen lampiran…',
    waitForAttachments: 'Tunggu sampai semua lampiran selesai dibaca.',
    uploading: (percent: number) => `Mengunggah ${percent}%`,
    reading: 'Membaca…',
    /** Files refused before uploading (shown on the chip). */
    legacyFormat: (ext: string, modern: string) => `Format lama ${ext} belum didukung - simpan ulang sebagai ${modern} atau PDF.`,
    unsupportedType: 'Jenis file tidak didukung. Gunakan PDF, Word (.docx), Excel (.xlsx/.csv), PowerPoint (.pptx), Markdown atau .txt.',
    emptyFile: 'File kosong.',
    tooLarge: (maxMb: number) => `Terlalu besar (maks ${numId(maxMb)} MB).`,
    tooMany: (max: number) => `Maksimal ${numId(max)} lampiran per permintaan.`,
  },

  /** Attachment chips, the attachment table of the monitor and the extracted-text preview (Attachments.tsx). */
  attachments: {
    /** Parts of a read document, e.g. "4 halaman · 23,9 KB". */
    pages: (n: number) => `${numId(n)} halaman`,
    slides: (n: number) => `${numId(n)} slide`,
    sheets: (n: number) => `${numId(n)} sheet`,
    warning: 'Peringatan',
    open: (name: string) => `Lihat isi ${name}`,
    remove: (name: string) => `Hapus lampiran ${name}`,
    download: (name: string) => `Unduh ${name}`,
    stripLabel: 'Dokumen terlampir',
    /** Name of a chip whose attachment is still loading. */
    placeholderName: 'Lampiran',
    loadingList: 'Memuat lampiran…',
    viewText: 'Lihat teks',
    originalFile: 'File asli',
    /** After the type, parts, size and length of the document in the preview header. */
    previewNote: 'teks hasil ekstraksi inilah yang dibaca agen.',
    viewLabel: 'Tampilan teks',
    formatted: 'Diformat',
    raw: 'Teks mentah',
    loadingText: 'Memuat teks…',
    truncated: '… (pratinjau dipotong; agen tetap membaca seluruh teks)',
    /** Separator for a page marker of the extracted text. */
    page: (n: string) => `Halaman ${n}`,
    pagesNotRead: (from: string, to: string) => `Halaman ${from}-${to} tidak dibaca (batas panjang dokumen)`,
  },

  /** The approval dialog (ConfirmationDialog.tsx). */
  confirmation: {
    badge: 'Perlu persetujuan Anda',
    more: (n: number) => `+${numId(n)} permintaan lain`,
    plugin: (name: string) => `Plugin: ${name}`,
    task: (title: string) => `Task: ${title}`,
    data: 'Data yang akan dikirim',
    noteLabel: 'Catatan untuk SOLAR (opsional)',
    notePlaceholder: "mis. gunakan project 'Order Platform' saja",
    approve: 'Setujui & lanjutkan',
  },

  /** Rendering of uploaded documents (lib/markdown.ts): an image is shown as this text, never loaded. */
  markdown: {
    image: 'gambar',
    imageWithAlt: (alt: string) => `gambar: ${alt}`,
  },
};
