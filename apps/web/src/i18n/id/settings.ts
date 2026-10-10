import type { ConfirmPolicy, LlmProviderKind, PluginState } from '@solar/shared';
import { numId } from '../helpers';

/**
 * Settings panels: components/settings/SystemPanel.tsx, ModelsPanel.tsx, KnowledgePanel.tsx, PluginsPanel.tsx and
 * SkillsPanel.tsx (the tab names and the language switch itself are in `app`; the Voice tab is `voice`).
 *
 * Texts marked "markup" may contain **bold** and `code` (rendered by components/settings/richText.tsx), nothing else.
 */
export const settings = {
  /** Where a skill or knowledge file comes from (badge). */
  source: {
    builtin: 'Bawaan',
    user: 'Pengguna',
  },

  /** Settings → Sistem. */
  system: {
    theme: 'Tema',
    themes: {
      system: 'Ikuti sistem',
      light: 'Terang',
      dark: 'Gelap',
    },
    compactMode: 'Mode ringkas (sembunyikan tombol cepat di bawah karakter)',

    /** Installing the web UI as an app (PWA). */
    app: {
      label: 'Aplikasi',
      standalone: 'SOLAR berjalan sebagai aplikasi terpasang.',
      install: 'Pasang SOLAR sebagai aplikasi',
      installHint: 'Jendela sendiri dan ikon di Start menu / layar utama; tampilan tetap terbuka saat server tidak terjangkau.',
      iosHint: 'Di iPhone/iPad: ketuk Bagikan lalu Tambahkan ke Layar Utama.',
      browserHint:
        'Pasang lewat menu browser (Chrome/Edge: Instal SOLAR AI AGENT). Butuh HTTPS, atau localhost di komputer yang menjalankan server.',
    },

    serverConfig: 'Konfigurasi server',
    /** Rows of the server configuration table: the label, then values. */
    rows: {
      version: 'Versi',
      primaryModel: 'Model utama',
      primaryModelValue: (provider: string, model: string, effort: string) => `${provider} · ${model} (reasoning effort ${effort})`,
      modelRoute: 'Rute model',
      modelStatus: 'Status model',
      modelReady: 'Siap',
      modelMissingKey: 'BELUM ada API key (OPENAI_API_KEY atau Pengaturan → Model AI)',
      knowledgeBase: 'Knowledge base',
      database: 'Database',
      databaseNeon: 'Neon Postgres (DATABASE_URL)',
      databaseLocal: 'File lokal (data/)',
      artifactStorage: 'Penyimpanan artefak',
      storageS3: 'Object storage S3 (Neon/S3)',
      storageLocal: 'File lokal (data/artifacts)',
      github: 'GitHub',
      githubConnected: (repo: string, branch: string) => `Terhubung · repo default: ${repo} (${branch})`,
      githubMissing: 'Belum (GITHUB_TOKEN)',
      plane: 'Plane',
      accessToken: 'Token akses',
      tokenRequired: 'Wajib',
      tokenNotRequired: 'Tidak wajib (hanya localhost)',
    },
    credentialsHint:
      'Provider LLM diatur di tab Model AI; kredensial lain (Neon, S3, GitHub, Plane, Visual Paradigm) di file .env - lihat README.',
    tokenLabel: 'Token akses SOLAR (SOLAR_ACCESS_TOKEN)',
    saveToken: 'Simpan token',
  },

  /** Settings → Model AI (LLM providers and the default model route). */
  models: {
    /** markup */
    intro:
      'SOLAR bisa memakai beberapa provider LLM sekaligus: OpenAI, gateway seperti OmniRoute/OpenRouter/LiteLLM, Claude, Gemini, atau model lokal (Ollama). **Rute default** menentukan model utama dan cadangannya: bila model utama gagal (koneksi, kuota, limit, key salah), task otomatis pindah ke model berikutnya.',
    kind: {
      'openai-chat': 'Chat Completions (OpenAI-compatible)',
      'openai-responses': 'OpenAI Responses API',
    } satisfies Record<LlmProviderKind, string>,

    route: {
      title: 'Rute default (utama → cadangan)',
      primary: 'Utama',
      fallback: (n: number) => `Cadangan ${numId(n)}`,
      moveUp: 'Naikkan',
      moveDown: 'Turunkan',
      remove: 'Hapus dari rute',
      entryPlaceholder: 'provider/model, mis. omniroute/claude-sonnet',
      save: 'Simpan rute',
      resetToEnv: 'Kembali ke model .env',
      appliesHint: 'Berlaku untuk task berikutnya, tanpa restart.',
    },

    providers: 'Provider',
    addProvider: 'Tambah provider',
    newProvider: 'Provider baru',
    editProvider: (id: string) => `Edit provider: ${id}`,
    /** Name of a provider made from a preset (only the presets whose name has words to translate). */
    presetName: {
      ollama: 'Ollama (lokal)',
    },
    /** Shown under the preset buttons after one is picked. */
    presetHint: {
      omniroute: 'Ganti host/port sesuai instalasi OmniRoute Anda.',
      ollama: 'Tanpa API key. Tambahkan model yang sudah di-pull.',
    },
    fields: {
      id: 'Id (dipakai di rute, mis. omniroute) - kosong = dari nama',
      kind: 'Jenis API',
      baseUrl: 'Base URL (termasuk /v1)',
      apiKey: 'API key (atau referensi variabel .env, mis. ${OMNIROUTE_API_KEY}; kosong untuk model lokal)',
      models: 'Model (satu per baris). Opsi: max=16384; reasoning; effort=high; price=input/cached/output (USD per 1 juta token)',
      advanced: 'Lanjutan',
      headers: 'Header tambahan (KEY=nilai per baris)',
      maxTokensParam: 'Parameter batas output',
      maxTokensAuto: 'Otomatis (max_completion_tokens untuk api.openai.com, selain itu max_tokens)',
      vision: 'Model menerima gambar',
    },

    /** Provider card. */
    fromEnv: '.env',
    ready: 'Siap',
    missingKey: 'Belum ada API key',
    modelList: (models: string) => `Model: ${models}`,
    missingVars: (vars: string) => `Variabel belum diisi: ${vars}`,
    envHint: 'Diatur lewat OPENAI_API_KEY, OPENAI_BASE_URL dan SOLAR_MODEL di .env.',
    testConnection: 'Tes koneksi',
    testing: 'Menguji…',
    testOk: (n: number) => `Terhubung · ${numId(n)} model tersedia`,
    confirmDelete: (name: string) => `Hapus provider "${name}"?`,
  },

  /** Settings → Knowledge. */
  knowledge: {
    intro:
      'Knowledge base berisi aturan dan fakta Anda (sistem, integrasi, standar ArchiMate, PlantUML, API, prinsip). Agent membaca file yang relevan sebelum mendesain, dan isinya mengalahkan aturan bawaan. Registry besar (daftar sistem/API) cukup diimpor dari Excel: satu file per baris, sehingga agent hanya membaca yang dibutuhkan.',
    newFile: 'File baru',
    importMarkdown: 'Impor .md',
    importFolder: 'Impor folder',
    importTable: 'Impor Excel/CSV',
    importDocument: 'Impor dokumen',

    /** Starting point of a new knowledge file: its path and content (the user edits both). */
    template: {
      path: 'systems/NAMA.md',
      content: `---
id: NAMA
type: system
title: Nama lengkap
aliases: []
status: active
---

# Nama lengkap

Ringkasan.
`,
    },

    noMarkdownPicked: 'Tidak ada file .md yang dipilih.',
    imported: (n: number) => `${numId(n)} file diimpor.`,
    importedWithFailures: (n: number, failures: string) => `${numId(n)} file diimpor; gagal: ${failures}.`,
    noTable: 'File tidak berisi tabel.',

    /** Importing an Excel/CSV table as one file per row. */
    table: {
      title: (file: string) => `Impor tabel: ${file}`,
      sheet: 'Sheet',
      sheetOption: (name: string, rows: number, truncated: boolean) => `${name} (${numId(rows)} baris${truncated ? ', dipotong' : ''})`,
      truncatedRows:
        'Sheet ini tidak terbaca utuh (terlalu banyak baris atau teks), jadi tidak bisa diimpor. Pecah file lalu impor tiap bagian.',
      truncatedWorkbook:
        'Sheet ini tidak dibaca karena teks workbook sudah mencapai batas, jadi tidak bisa diimpor. Simpan sheet ini sebagai file terpisah lalu impor.',
      idColumn: 'Kolom ID / nama file (wajib)',
      titleColumn: 'Kolom nama lengkap',
      statusColumn: 'Kolom status (active / sunset / retired)',
      noColumn: '(tidak ada)',
      aliasColumns: 'Kolom nama lain / alias (dicocokkan dengan nama di BRD)',
      sampleRow: (cells: string) => `Contoh baris: ${cells}`,
      removeStale: 'Hapus file dari impor sebelumnya (file & sheet yang sama) yang barisnya sudah tidak ada',
      /** After an import; `notes` are the skipped rows (skippedRow), already joined. */
      done: (written: number, folder: string, index: string, removed: number, notes: string) =>
        `${numId(written)} file ditulis ke ${folder}/ (indeks: ${index})${removed ? `, ${numId(removed)} file lama dihapus` : ''}${notes ? `. Catatan: ${notes}` : ''}.`,
      skippedRow: (row: number, reason: string) => `baris ${numId(row)}: ${reason}`,
    },

    /** Importing a document (Word, PDF, PowerPoint, Markdown, text). */
    document: {
      title: (file: string) => `Impor dokumen: ${file}`,
      split: 'Pecah dokumen',
      splitNone: 'Tidak, simpan sebagai satu file',
      splitChapters: 'Per bab (heading 1)',
      splitSections: 'Per bab dan sub-bab (heading 1-2)',
      removeStale: 'Ganti hasil impor sebelumnya dari dokumen yang sama',
      /** After an import; `warnings` come from the server, already joined. */
      done: (written: number, removed: number, warnings: string) =>
        `${numId(written)} file ditulis${removed ? `, ${numId(removed)} file lama dihapus` : ''}.${warnings ? ` Catatan: ${warnings}` : ''}`,
    },

    targetFolder: 'Folder tujuan',

    /** Editing one knowledge file. */
    editor: {
      edit: (path: string) => `Edit: ${path}`,
      path: 'Path (folder/nama.md)',
      builtinHint: 'File bawaan: menyimpan membuat salinan milik Anda (versi bawaan kembali bila salinan dihapus).',
      content: 'Isi (Markdown dengan front matter)',
      saved: (path: string) => `${path} disimpan.`,
    },

    searchPlaceholder: 'Cari path, nama atau alias…',
    allTypes: 'Semua jenis',
    readByAgent: (n: number) => `${numId(n)} file dibaca agent`,
    matching: (n: number) => `${numId(n)} cocok dengan filter`,
    /** Group of guides and templates (files under a folder starting with "_", README.md). */
    guides: 'Panduan & template (tidak dibaca agent)',
    groupHeading: (label: string, n: number) => `${label} (${numId(n)})`,
    /** Badge of an entry whose status means it is no longer in use. */
    retired: (status: string) => `${status} (tidak dipakai untuk solusi baru)`,
    aliases: (aliases: string) => `alias: ${aliases}`,
    viewOrOverride: 'Lihat / override',
    confirmDelete: (path: string) => `Hapus ${path}?`,
    deleted: (path: string) => `${path}: dihapus.`,
    reverted: (path: string) => `${path}: versi bawaan dipulihkan.`,
    more: (n: number) => `${numId(n)} file lain - persempit dengan pencarian.`,
  },

  /** Settings → Plugin MCP. */
  plugins: {
    /** markup */
    intro:
      'Plugin MCP memberi SOLAR akses ke sistem lain. Nilai seperti `${GITHUB_TOKEN}` diambil dari file `.env` sehingga rahasia tidak tersimpan di sini. Visual Paradigm diset **selalu konfirmasi**.',
    policy: {
      never: 'Tanpa konfirmasi',
      writes: 'Konfirmasi untuk operasi tulis',
      always: 'Selalu konfirmasi setiap pemanggilan',
    } satisfies Record<ConfirmPolicy, string>,
    state: {
      disabled: 'Nonaktif',
      unconfigured: 'Belum dikonfigurasi',
      connecting: 'Menghubungkan…',
      connected: 'Terhubung',
      error: 'Error',
    } satisfies Record<PluginState, string>,
    add: 'Tambah plugin MCP',
    newPlugin: 'Plugin baru',
    editPlugin: (id: string) => `Edit plugin: ${id}`,
    fields: {
      id: 'Id (huruf kecil, angka, -)',
      idPlaceholder: 'otomatis dari nama',
      transport: 'Transport',
      transportHttp: 'Streamable HTTP (remote)',
      transportSse: 'SSE (remote, lama)',
      transportStdio: 'stdio (proses lokal, mis. npx)',
      policy: 'Kebijakan konfirmasi',
      command: 'Command',
      args: 'Argumen (satu per baris)',
      env: 'Environment (KEY=VALUE per baris, boleh ${VAR})',
      url: 'URL endpoint MCP',
      headers: 'Header (KEY=VALUE per baris, boleh ${VAR})',
      allowlist: 'Batasi tool (opsional, pisahkan koma)',
      allowlistPlaceholder: 'kosong = semua tool',
    },
    saveAndConnect: 'Simpan & hubungkan',
    /** After the state badge of a connected plugin. */
    toolCount: (n: number) => `${numId(n)} tool`,
    reconnect: 'Hubungkan ulang',
    deleteLabel: (name: string) => `Hapus ${name}`,
    confirmDelete: (name: string) => `Hapus plugin "${name}"?`,
    toolList: (n: number) => `Daftar tool (${numId(n)})`,
  },

  /** Settings → Skills. */
  skills: {
    /** markup */
    intro:
      'Skill adalah instruksi “house style” yang dimuat agent saat relevan (format `SKILL.md`: front matter `name` dan `description`, lalu isi Markdown). Skill bawaan bisa dinonaktifkan atau di-override.',
    add: 'Tambah skill',
    importFile: 'Impor SKILL.md',
    newSkill: 'Skill baru',
    editSkill: (id: string) => `Edit skill: ${id}`,
    namePlaceholder: 'mis. Cloud Cost Review',
    description: 'Deskripsi (kapan skill dipakai)',
    content: 'Instruksi (Markdown)',
    noDescription: 'Tanpa deskripsi',
    files: (files: string) => `file: ${files}`,
    confirmDelete: (name: string) => `Hapus skill "${name}"? Skill bawaan dengan id yang sama akan dipulihkan.`,
  },
};
