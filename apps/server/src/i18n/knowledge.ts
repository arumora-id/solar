import { count, type Catalog } from './helpers.js';

/**
 * Knowledge base writes and imports: refusals of a write (shown in the UI and, as they are, to the agent) and the
 * notices and scaffolding of the Excel/document imports, in the language of the request that imported.
 */
export const KNOWLEDGE_MESSAGES = {
  // ---- writes (agent tools and API) ------------------------------------------------------------------------
  // the agent's text (it names the tool's overwrite parameter); the API answers with api.knowledgeExists.*
  'knowledge.conflict.builtin': {
    id: 'File knowledge "{path}" sudah ada (file bawaan: {title}). Baca dulu isinya, lalu simpan ulang dengan overwrite bila memang ingin menggantinya.',
    en: 'The knowledge file "{path}" already exists (built-in file: {title}). Read it first, then save it again with overwrite if you really want to replace it.',
  },
  'knowledge.conflict.user': {
    id: 'File knowledge "{path}" sudah ada (file pengguna: {title}). Baca dulu isinya, lalu simpan ulang dengan overwrite bila memang ingin menggantinya.',
    en: 'The knowledge file "{path}" already exists (user file: {title}). Read it first, then save it again with overwrite if you really want to replace it.',
  },
  'knowledge.guidancePath': {
    id: '"{path}" adalah panduan untuk manusia (folder/file berawalan "_" atau README.md) dan tidak dibaca agent; pilih path lain.',
    en: '"{path}" is guidance for people (a folder/file starting with "_" or README.md) and is not read by the agent; choose another path.',
  },
  'knowledge.fileTooLarge': {
    id: 'File knowledge akan berukuran {kb} KB termasuk front matter; batasnya {max} KB. Ringkas atau pecah isinya.',
    en: 'The knowledge file would be {kb} KB including the front matter; the limit is {max} KB. Shorten or split the content.',
  },
  'knowledge.stateChanged': {
    id: 'File knowledge "{path}" berubah setelah persetujuan diminta.',
    en: 'The knowledge file "{path}" changed after approval was requested.',
  },
  'knowledge.artifactNotFound': { id: 'Artefak {id} tidak ditemukan.', en: 'Artifact {id} not found.' },
  'knowledge.notMarkdown': {
    id: '{name} bukan file Markdown; knowledge base hanya berisi Markdown.',
    en: '{name} is not a Markdown file; the knowledge base holds Markdown only.',
  },
  'knowledge.useSibling': { id: ' Pakai {name} ({id}) dari paket yang sama.', en: ' Use {name} ({id}) from the same bundle.' },

  // ---- imports ------------------------------------------------------------------------------------------------
  'import.hiddenFolder': {
    id: 'Folder tidak boleh berawalan "_" (file di sana tidak dibaca agent)',
    en: 'The folder must not start with "_" (those files are not read by the agent)',
  },
  'import.sheetSkipped': {
    id: 'Sheet "{sheet}" tidak dibaca karena teks workbook sudah mencapai batas; simpan sheet ini sebagai file terpisah lalu impor',
    en: 'Sheet "{sheet}" was not read because the workbook text reached its limit; save this sheet as a separate file and import it',
  },
  'import.sheetTooManyRows': {
    id: 'Sheet "{sheet}" berisi lebih dari {max} baris; maksimum {max} baris per impor, pecah file sebelum impor',
    en: 'Sheet "{sheet}" has more than {max} rows; an import takes at most {max} rows, split the file before importing',
  },
  'import.sheetCut': {
    id: 'Sheet "{sheet}" tidak terbaca utuh karena teksnya terlalu panjang; pecah file sebelum impor',
    en: 'Sheet "{sheet}" could not be read completely because its text is too long; split the file before importing',
  },
  'import.columnMissing': {
    id: 'Kolom "{column}" tidak ada di baris header {row} sheet "{sheet}"',
    en: 'Column "{column}" is not in header row {row} of sheet "{sheet}"',
  },
  'import.tooManyRows': {
    id: 'Sheet berisi {rows} baris; maksimum {max} per impor',
    en: 'The sheet has {rows} rows; an import takes at most {max}',
  },
  'import.emptyId': { id: 'kolom "{column}" kosong', en: 'column "{column}" is empty' },
  'import.duplicateId': { id: 'id "{id}" duplikat; disimpan sebagai {file}', en: 'duplicate id "{id}"; saved as {file}' },
  'import.rowSource': { id: '{source} (baris {row})', en: '{source} (row {row})' },
  'import.column': { id: 'Kolom {n}', en: 'Column {n}' },
  'import.indexName': { id: 'Nama', en: 'Name' },
  'import.indexTitle': {
    id: 'Indeks {folder} ({n} item)',
    en: (p: { folder: string; n: number }) => `${p.folder} index (${count(p.n, 'item')})`,
  },
  'import.indexHeading': { id: 'Indeks {folder}', en: '{folder} index' },
  'import.indexIntro': {
    id: 'Dibuat dari {file}, sheet "{sheet}". Satu file per baris di folder `{folder}/`; baca file itemnya untuk detail.',
    en: 'Created from {file}, sheet "{sheet}". One file per row in the folder `{folder}/`; read an item\'s file for the details.',
  },
  'import.noHeadings': {
    id: 'Dokumen tidak punya heading untuk dipecah; disimpan sebagai satu file.',
    en: 'The document has no headings to split at; it was saved as one file.',
  },
  'import.introduction': { id: 'Pendahuluan', en: 'Introduction' },
  'import.chapterSource': { id: '{source} (bab {n})', en: '{source} (chapter {n})' },
  'import.chapterIndex': {
    id: 'Diimpor dari {file}, dipecah per bab. Baca bab yang relevan:',
    en: 'Imported from {file}, split by chapter. Read the relevant chapters:',
  },
} as const satisfies Catalog;
