import type { Catalog } from './helpers.js';

/**
 * Request-scoped text: answers of the HTTP API in the language of the request (X-Solar-Language, Accept-Language),
 * including the errors of the stores behind it (skills, plugins, model providers, knowledge files).
 */
export const API_MESSAGES = {
  // ---- access and request body ----------------------------------------------------------------------------
  'api.forbiddenHost': {
    id: 'Host "{host}" ditolak. Tanpa SOLAR_ACCESS_TOKEN, API hanya melayani permintaan untuk komputer ini (127.0.0.1 / localhost).',
    en: 'Forbidden host "{host}". Without SOLAR_ACCESS_TOKEN the API only answers requests for this computer (127.0.0.1 / localhost).',
  },
  'api.forbiddenOrigin': { id: 'Origin "{origin}" ditolak.', en: 'Forbidden origin "{origin}".' },
  'api.unauthorized': {
    id: 'Tidak diizinkan: token akses SOLAR tidak ada atau tidak valid',
    en: 'Unauthorized: missing or invalid SOLAR access token',
  },
  'api.invalidJson': { id: 'Isi permintaan bukan JSON yang valid', en: 'The request body is not valid JSON' },
  'api.bodyTooLarge': { id: 'Isi permintaan terlalu besar', en: 'The request body is too large' },
  'api.optionsJson': { id: 'options: harus berupa JSON', en: 'options: expected JSON' },

  // ---- tasks, confirmations, artifacts ----------------------------------------------------------------------
  'api.taskNotFound': { id: 'Task tidak ditemukan', en: 'Task not found' },
  'api.taskNotActive': { id: 'Task tidak sedang mengantre atau berjalan', en: 'Task is not queued or running' },
  'api.taskNoArtifacts': { id: 'Task ini belum punya artefak', en: 'This task has no artifacts' },
  'api.zipReadme': {
    id: '{app} - hasil kerja\nTask: {title}\nId task: {task}\nDibuat: {created}\n\n{files}\n',
    en: '{app} deliverables\nTask: {title}\nTask id: {task}\nCreated: {created}\n\n{files}\n',
  },
  'api.confirmationNotFound': { id: 'Konfirmasi tidak ditemukan atau sudah dijawab', en: 'Confirmation not found or already resolved' },
  'api.artifactNotFound': { id: 'Artefak tidak ditemukan', en: 'Artifact not found' },

  // ---- attachments -------------------------------------------------------------------------------------------
  'api.attachmentUnknown': { id: 'Lampiran {id} tidak ditemukan', en: 'Attachment {id} not found' },
  'api.attachmentOtherSession': { id: 'Lampiran "{name}" milik percakapan lain', en: 'The attachment "{name}" belongs to another conversation' },
  'api.attachmentNotFound': { id: 'Lampiran tidak ditemukan', en: 'Attachment not found' },
  'api.attachmentInUse': {
    id: 'Lampiran sudah dipakai oleh sebuah task dan disimpan sebagai riwayatnya',
    en: 'The attachment is used by a task and is kept as part of its history',
  },
  'api.fileTooLarge': { id: 'File terlalu besar (maks {mb} MB).', en: 'The file is too large (max {mb} MB).' },
  'api.fileEmpty': { id: 'Isi file kosong', en: 'The file is empty' },

  // ---- skills, plugins, model providers -----------------------------------------------------------------------
  'api.skillNotFound': { id: 'Skill tidak ditemukan', en: 'Skill not found' },
  'api.pluginNotFound': { id: 'Plugin tidak ditemukan', en: 'Plugin not found' },
  'store.skill.notFound': { id: 'Skill "{id}" tidak ditemukan', en: 'Skill "{id}" not found' },
  'store.skill.fileNotFound': { id: 'File "{path}" tidak ada di skill "{id}"', en: 'File "{path}" not found in skill "{id}"' },
  'store.skill.fileTooLarge': { id: 'File lebih besar dari {bytes} byte', en: 'File is larger than {bytes} bytes' },
  'store.skill.exists': { id: 'Skill dengan id "{id}" sudah ada', en: 'A skill with id "{id}" already exists' },
  'store.skill.notUserSkill': {
    id: 'Skill pengguna "{id}" tidak ditemukan (skill bawaan hanya bisa dinonaktifkan)',
    en: 'User skill "{id}" not found (built-in skills can only be disabled)',
  },
  'store.skill.noContent': { id: 'File skill tidak berisi apa pun', en: 'The skill file has no content' },
  'store.plugin.exists': { id: 'Plugin "{id}" sudah ada', en: 'Plugin "{id}" already exists' },
  'store.plugin.notFound': { id: 'Plugin "{id}" tidak ditemukan', en: 'Plugin "{id}" not found' },
  'store.provider.exists': { id: 'Provider "{id}" sudah ada', en: 'Provider "{id}" already exists' },
  'store.provider.notFound': { id: 'Provider "{id}" tidak ditemukan', en: 'Provider "{id}" not found' },
  'store.provider.envProvider': {
    id: 'Provider OpenAI dari .env diubah di file .env',
    en: 'The OpenAI provider from .env is edited in the .env file',
  },
  'store.provider.unknownInRoute': {
    id: 'Rute "{route}": provider tidak dikenal di "{entry}"',
    en: 'Route "{route}": unknown provider in "{entry}"',
  },

  // ---- knowledge files ------------------------------------------------------------------------------------------
  'api.knowledgeNotFound': { id: 'File knowledge tidak ditemukan', en: 'Knowledge file not found' },
  'api.spreadsheetOnly': { id: 'pilih file .xlsx, .xlsm atau .csv', en: 'choose an .xlsx, .xlsm or .csv file' },
  'api.sheetMissing': { id: 'Sheet "{sheet}" tidak ada di file', en: 'Sheet "{sheet}" is not in the file' },
  'store.knowledge.invalidPath': {
    id: 'Path knowledge "{path}" tidak valid: pakai folder dan nama file .md, mis. systems/AD1GATE.md',
    en: 'Invalid knowledge path "{path}": use folders and a .md file name, e.g. systems/AD1GATE.md',
  },
  'store.knowledge.tooLarge': { id: 'File lebih besar dari {kb} KB', en: 'File is larger than {kb} KB' },
  'store.knowledge.notUserFile': {
    id: '"{path}" bukan file pengguna (file bawaan bisa ditimpa, tetapi tidak bisa dihapus)',
    en: '"{path}" is not a user file (built-in files can be overridden, not deleted)',
  },

  // ---- Word (.docx) export of a TSD ------------------------------------------------------------------------------
  'docx.artifactNotFound': { id: 'Artefak {id} tidak ditemukan', en: 'Artifact {id} not found' },
  'docx.notTsd': {
    id: '{name} bukan bagian dari Technical Specification Document (paketnya tidak punya model .tsd.json)',
    en: '{name} is not part of a Technical Specification Document (its bundle has no .tsd.json model)',
  },
  'docx.invalidJson': { id: '{name} bukan JSON yang valid', en: '{name} is not valid JSON' },
  'docx.invalidSpec': { id: '{name} bukan spesifikasi yang valid: {errors}', en: '{name} is not a valid specification: {errors}' },
  'docx.warning.noSize': {
    id: 'Diagram {file}: SVG tidak punya width/height, ditampilkan pada 800x600',
    en: 'Diagram {file}: the SVG has no width/height, it is shown at 800x600',
  },
  'docx.warning.smallText': {
    id: 'Diagram {file}: diperkecil menjadi {scale}% agar muat di halaman, sehingga teksnya tercetak sekitar {points} pt; pecah menjadi view yang lebih kecil (lebih sedikit elemen atau langkah per view) agar cetakannya terbaca',
    en: 'Diagram {file}: shrunk to {scale}% to fit the page, so its text prints at about {points} pt; split it into smaller views (fewer elements or steps each) for a readable printout',
  },
  'docx.warning.noPng': {
    id: 'Diagram {file}: gambar PNG cadangan tidak bisa dibuat ({error}); Word 2016+ menampilkan SVG-nya, penampil lama menampilkan kotak abu-abu',
    en: 'Diagram {file}: the PNG fallback could not be drawn ({error}); Word 2016+ shows the SVG, older viewers a grey placeholder',
  },
  'docx.warning.noPageNumbers': {
    id: 'Dokumen terlalu panjang untuk ditata halamannya tepat waktu: Word mengisi nomor halaman daftar isi saat file dibuka',
    en: 'The document was too long to lay out its pages in time: Word fills in the page numbers of the table of contents when it opens the file',
  },
  'docx.error.timeout': {
    id: 'membuat dokumen Word memakan waktu lebih dari {seconds} detik',
    en: 'rendering the Word document took longer than {seconds} s',
  },
  'docx.error.memory': {
    id: 'dokumen terlalu besar untuk dibuat (batas memori)',
    en: 'the document is too large to render (memory limit)',
  },
  'docx.error.stopped': {
    id: 'pembuat dokumen Word berhenti tak terduga (kode {code})',
    en: 'the Word renderer stopped unexpectedly (code {code})',
  },
} as const satisfies Catalog;
