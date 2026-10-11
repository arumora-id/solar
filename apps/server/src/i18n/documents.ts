import { count, type Catalog } from './helpers.js';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Reading uploaded documents (../documents): errors and warnings shown to the user, and the notes written into the
 * extracted text, in the language of the upload request. Warnings are stored with the attachment, so they keep the
 * language they were uploaded in. Numbers that are formatted arrive as strings (fmtInt).
 */
export const DOCUMENT_MESSAGES = {
  // ---- labels ---------------------------------------------------------------------------------------------
  'doc.label.docx': { id: 'dokumen Word', en: 'Word document' },
  'doc.label.xlsx': { id: 'workbook Excel', en: 'Excel workbook' },
  'doc.label.pptx': { id: 'presentasi PowerPoint', en: 'PowerPoint presentation' },
  'doc.label.office': { id: 'dokumen Office', en: 'Office document' },
  'doc.label.withExtension': { id: '{label} (.{ext})', en: '{label} (.{ext})' },
  'doc.label.file': { id: 'file .{ext}', en: '.{ext} file' },

  // ---- general ----------------------------------------------------------------------------------------------
  'doc.empty': { id: 'File kosong (0 byte).', en: 'The file is empty (0 bytes).' },
  'doc.unreadable': {
    id: '"{file}" tidak bisa dibaca (file rusak atau memakai fitur yang belum didukung): {error}',
    en: '"{file}" could not be read (the file is damaged or uses a feature that is not supported yet): {error}',
  },
  'doc.extensionMismatch': {
    id: 'Ekstensi .{ext} tidak sesuai isinya ({kind}); file dibaca sebagai {kind}.',
    en: 'The .{ext} extension does not match the content ({kind}); the file was read as {kind}.',
  },
  'doc.unsupportedPackage': { id: 'Jenis file tidak didukung: {reason}.', en: 'Unsupported file type: {reason}.' },
  'doc.unsupported.xlsb': {
    id: 'Excel Binary Workbook (.xlsb) belum didukung; simpan sebagai .xlsx atau .csv',
    en: 'Excel Binary Workbooks (.xlsb) are not supported yet; save it as .xlsx or .csv',
  },
  'doc.unsupported.visio': { id: 'gambar Visio (.vsdx) belum didukung; ekspor ke PDF', en: 'Visio drawings (.vsdx) are not supported yet; export it to PDF' },
  'doc.unsupported.openDocument': {
    id: 'file OpenDocument (.odt/.ods/.odp) belum didukung; simpan sebagai .docx, .xlsx atau .pptx',
    en: 'OpenDocument files (.odt/.ods/.odp) are not supported yet; save it as .docx, .xlsx or .pptx',
  },
  'doc.corrupt': { id: 'File rusak atau bukan {label} yang valid ({detail}).', en: 'The file is damaged or not a valid {label} ({detail}).' },
  'doc.corrupt.mainPartMissing': { id: 'bagian utama dokumen tidak ditemukan', en: 'the main document part is missing' },
  'doc.corrupt.notOfficePackage': { id: 'bukan paket Office/ZIP', en: 'not an Office/ZIP package' },
  'doc.zipNotDocument': {
    id: 'File .{ext} ini ternyata arsip ZIP, bukan dokumen yang didukung.',
    en: 'This .{ext} file is a ZIP archive, not a supported document.',
  },
  'doc.pdfHeaderMissing': {
    id: 'File rusak atau bukan PDF yang valid (header %PDF tidak ditemukan).',
    en: 'The file is damaged or not a valid PDF (the %PDF header is missing).',
  },
  'doc.textCut': { id: '[SOLAR: teks dipotong pada {n} karakter]', en: '[SOLAR: text cut at {n} characters]' },
  'doc.veryLong': {
    id: 'Dokumen sangat panjang; hanya {n} karakter pertama yang disimpan.',
    en: 'The document is very long; only the first {n} characters were kept.',
  },
  'doc.noTextPdf': {
    id: 'Tidak ada teks yang bisa dibaca (PDF hasil scan/gambar?). Gunakan PDF dengan teks atau sertakan versi Word.',
    en: 'There is no readable text (a scanned or image-only PDF?). Use a PDF with text or attach the Word version.',
  },
  'doc.noText': { id: 'Dokumen tidak berisi teks.', en: 'The document contains no text.' },
  'doc.seconds': { id: '{n} detik', en: (p: { n: number }) => count(p.n, 'second') },
  'doc.timeout': {
    id: 'Membaca dokumen melebihi batas waktu {time}; dokumen terlalu besar atau terlalu rumit. Pecah menjadi beberapa file.',
    en: 'Reading the document took longer than the limit of {time}; it is too large or too complex. Split it into several files.',
  },

  // ---- worker (documents/isolated.ts) ------------------------------------------------------------------------
  'doc.worker.memory': {
    id: '"{file}" terlalu besar atau rumit untuk dibaca (batas memori). Pecah dokumen menjadi beberapa file.',
    en: '"{file}" is too large or too complex to read (memory limit). Split the document into several files.',
  },
  'doc.worker.timeout': {
    id: 'Membaca "{file}" melebihi batas waktu {seconds} detik. Pecah dokumen menjadi beberapa file.',
    en: 'Reading "{file}" took longer than the limit of {seconds} seconds. Split the document into several files.',
  },
  'doc.worker.failed': { id: '"{file}" tidak bisa dibaca: {error}', en: '"{file}" could not be read: {error}' },
  'doc.worker.stopped': { id: 'Pembaca dokumen berhenti tak terduga (kode {code}).', en: 'The document reader stopped unexpectedly (code {code}).' },

  // ---- upload (tasks/attachmentService.ts) ---------------------------------------------------------------------------
  'doc.nameEmpty': { id: 'Nama file kosong.', en: 'The file name is empty.' },
  'doc.tooLarge': { id: '"{file}" terlalu besar (maks {mb} MB).', en: '"{file}" is too large (max {mb} MB).' },

  // ---- file types (documents/kind.ts, ole.ts, text.ts) --------------------------------------------------------------
  'doc.legacyFormat': {
    id: 'Format {format} belum didukung. Simpan ulang sebagai {ext}x (File → Save As) atau PDF, lalu lampirkan lagi.',
    en: 'The {format} format is not supported yet. Save it again as {ext}x (File → Save As) or PDF, then attach it again.',
  },
  'doc.unsupportedType': {
    id: 'Jenis file "{ext}" tidak didukung. Gunakan PDF, Word (.docx), Excel (.xlsx/.xlsm/.csv), PowerPoint (.pptx), Markdown (.md) atau teks (.txt).',
    en: 'The file type "{ext}" is not supported. Use PDF, Word (.docx), Excel (.xlsx/.xlsm/.csv), PowerPoint (.pptx), Markdown (.md) or text (.txt).',
  },
  'doc.ole.encrypted': {
    id: (p: { label: string }) =>
      `${capitalize(p.label)} ini dilindungi kata sandi (terenkripsi). Hapus kata sandinya di Office (File → Info → Protect → Encrypt with Password), simpan, lalu lampirkan lagi.`,
    en: (p: { label: string }) =>
      `This ${p.label} is password-protected (encrypted). Remove the password in Office (File → Info → Protect → Encrypt with Password), save it, then attach it again.`,
  },
  'doc.ole.doc': {
    id: 'Format Word 97-2003 (.doc) belum didukung. Buka di Word lalu simpan sebagai .docx (atau ekspor ke PDF), kemudian lampirkan lagi.',
    en: 'The Word 97-2003 format (.doc) is not supported yet. Open it in Word and save it as .docx (or export it to PDF), then attach it again.',
  },
  'doc.ole.xls': {
    id: 'Format Excel 97-2003 (.xls) belum didukung. Simpan sebagai .xlsx (atau .csv), kemudian lampirkan lagi.',
    en: 'The Excel 97-2003 format (.xls) is not supported yet. Save it as .xlsx (or .csv), then attach it again.',
  },
  'doc.ole.ppt': {
    id: 'Format PowerPoint 97-2003 (.ppt) belum didukung. Simpan sebagai .pptx (atau ekspor ke PDF), kemudian lampirkan lagi.',
    en: 'The PowerPoint 97-2003 format (.ppt) is not supported yet. Save it as .pptx (or export it to PDF), then attach it again.',
  },
  'doc.ole.other': {
    id: 'File ini berformat OLE2 (Office lama atau format lain) dan belum didukung. Simpan sebagai .docx, .xlsx, .pptx atau PDF.',
    en: 'This file is in the OLE2 format (old Office or another format), which is not supported yet. Save it as .docx, .xlsx, .pptx or PDF.',
  },
  'doc.text.binary': {
    id: 'File ini tampaknya file biner, bukan teks. Lampirkan PDF, Word, Excel, PowerPoint, Markdown, CSV atau teks biasa.',
    en: 'This file looks like a binary file, not text. Attach a PDF, Word, Excel, PowerPoint, Markdown, CSV or plain text file.',
  },
  'doc.csv.emptyNote': { id: '_(file CSV kosong)_', en: '_(empty CSV file)_' },
  'doc.csv.empty': { id: 'File CSV kosong.', en: 'The CSV file is empty.' },
  'doc.csv.rows': {
    id: 'CSV berisi lebih dari {max} baris data; hanya {max} baris pertama yang dibaca.',
    en: 'The CSV has more than {max} data rows; only the first {max} rows were read.',
  },
  'doc.csv.columns': {
    id: 'CSV berisi {width} kolom; hanya {max} kolom pertama yang dibaca.',
    en: 'The CSV has {width} columns; only the first {max} columns were read.',
  },
  'doc.csv.cells': {
    id: '{n} sel CSV berisi lebih dari {max} karakter dan dipotong.',
    en: (p: { n: string; cells: number; max: string }) => `${p.n} CSV ${p.cells === 1 ? 'cell had' : 'cells had'} more than ${p.max} characters and ${p.cells === 1 ? 'was' : 'were'} cut.`,
  },

  // ---- ZIP packages (documents/zip.ts) ------------------------------------------------------------------------
  'doc.zip.encrypted': {
    id: (p: { label: string }) => `${capitalize(p.label)} ini dilindungi kata sandi (entri ZIP terenkripsi). Hapus kata sandinya lalu lampirkan lagi.`,
    en: (p: { label: string }) => `This ${p.label} is password-protected (encrypted ZIP entries). Remove the password, then attach it again.`,
  },
  'doc.zip.tooManyEntries': { id: 'File berisi {n} entri ZIP (batas {max}).', en: 'The file has {n} ZIP entries (limit {max}).' },
  'doc.zip.tooLarge': { id: 'File terlalu besar: {detail}. Pecah dokumen menjadi beberapa file.', en: 'The file is too large: {detail}. Split the document into several files.' },
  'doc.zip.bomb': { id: 'File ditolak karena terindikasi zip bomb: {detail}.', en: 'The file was rejected as a possible zip bomb: {detail}.' },
  'doc.zip.noEnd': { id: 'akhir direktori ZIP tidak ditemukan', en: 'the end of the ZIP directory is missing' },
  'doc.zip.directoryOutside': { id: 'direktori ZIP berada di luar file', en: 'the ZIP directory lies outside the file' },
  'doc.zip.badEntry': { id: 'entri direktori ZIP tidak valid', en: 'invalid ZIP directory entry' },
  'doc.zip.entryCut': { id: 'entri direktori ZIP terpotong', en: 'truncated ZIP directory entry' },
  'doc.zip.zip64': { id: 'data ZIP64 tidak lengkap', en: 'incomplete ZIP64 data' },
  'doc.zip.method': { id: 'metode kompresi ZIP {method} tidak didukung untuk "{name}"', en: 'ZIP compression method {method} is not supported for "{name}"' },
  'doc.zip.expands': {
    id: '"{name}" mengembang menjadi {size} dari {compressed} (rasio {ratio}:1)',
    en: '"{name}" expands to {size} from {compressed} (ratio {ratio}:1)',
  },
  'doc.zip.partExpands': {
    id: 'bagian "{name}" mengembang menjadi {size} (batas {max} per bagian)',
    en: 'the part "{name}" expands to {size} (limit {max} per part)',
  },
  'doc.zip.totalExpands': { id: 'isinya mengembang lebih dari {max}', en: 'its content expands to more than {max}' },
  'doc.zip.localHeader': { id: 'header lokal "{name}" tidak valid', en: 'invalid local header of "{name}"' },
  'doc.zip.entryTruncated': { id: 'entri "{name}" terpotong', en: 'the entry "{name}" is truncated' },
  'doc.zip.partMissing': { id: 'bagian "{name}" tidak ada', en: 'the part "{name}" is missing' },
  'doc.zip.sizeInconsistent': { id: 'ukuran entri "{name}" tidak konsisten', en: 'inconsistent size of the entry "{name}"' },
  'doc.zip.partTooLarge': { id: 'bagian "{name}" lebih dari {max}', en: 'the part "{name}" is larger than {max}' },
  'doc.zip.beyondDeclared': {
    id: '"{name}" mengembang melebihi ukuran yang dinyatakan ({n} byte)',
    en: '"{name}" expands beyond its declared size ({n} bytes)',
  },
  'doc.zip.partExpandsBeyond': { id: 'bagian "{name}" mengembang lebih dari {max}', en: 'the part "{name}" expands to more than {max}' },
  'doc.zip.inflate': { id: '"{name}" tidak bisa didekompresi: {error}', en: '"{name}" could not be decompressed: {error}' },
  'doc.zip.sizeMismatch': {
    id: 'ukuran "{name}" tidak cocok (dinyatakan {declared}, hasil {actual})',
    en: 'the size of "{name}" does not match (declared {declared}, actual {actual})',
  },

  // ---- Word (documents/docx.ts, docxPrepare.ts) -----------------------------------------------------------------
  'doc.docx.unreadable': {
    id: 'File Word ini berisi struktur yang tidak bisa dibaca (referensi atau elemen rusak). Coba buka di Word lalu simpan ulang.',
    en: 'This Word file has a structure that cannot be read (broken references or elements). Try opening it in Word and saving it again.',
  },
  'doc.docx.unknownElements': { id: 'Sebagian elemen Word tidak dikenali dan dilewati.', en: 'Some Word elements were not recognised and were skipped.' },
  'doc.docx.htmlCut': {
    id: 'Dokumen dipotong: hanya {shown} dari {total} karakter hasil konversi (~{percent}%) yang dibaca.',
    en: 'The document was cut: only {shown} of {total} converted characters (~{percent}%) were read.',
  },
  'doc.docx.macros': { id: 'Dokumen berisi makro; makro diabaikan (tidak pernah dijalankan).', en: 'The document contains macros; they were ignored (never run).' },
  'doc.docx.badPart': {
    id: 'File rusak atau bukan dokumen Word yang valid (XML bagian "{part}" tidak lengkap atau tidak valid).',
    en: 'The file is damaged or not a valid Word document (the XML of the part "{part}" is incomplete or invalid).',
  },
  'doc.docx.noMainPart': {
    id: 'File rusak atau bukan dokumen Word yang valid (bagian utama dokumen tidak ditemukan).',
    en: 'The file is damaged or not a valid Word document (the main document part is missing).',
  },
  'doc.docx.relsTooLarge': {
    id: 'Daftar tautan dan gambar dokumen terlalu besar ({size}); tautan dibaca sebagai teks biasa.',
    en: "The document's list of links and images is too large ({size}); links are read as plain text.",
  },
  'doc.docx.stylesTooLarge': { id: 'Bagian gaya dokumen terlalu besar ({size}) dan dilewati.', en: 'The styles part of the document is too large ({size}) and was skipped.' },
  'doc.docx.numberingTooLarge': {
    id: 'Bagian penomoran dokumen terlalu besar ({size}) dan dilewati.',
    en: 'The numbering part of the document is too large ({size}) and was skipped.',
  },
  'doc.docx.footnotesLong': {
    id: 'Catatan kaki dokumen sangat panjang; hanya {size} pertama yang dibaca.',
    en: 'The footnotes of the document are very long; only the first {size} were read.',
  },
  'doc.docx.endnotesLong': {
    id: 'Catatan akhir dokumen sangat panjang; hanya {size} pertama yang dibaca.',
    en: 'The endnotes of the document are very long; only the first {size} were read.',
  },
  'doc.docx.tooLarge': {
    id: 'Dokumen terlalu besar ({size} isi XML) dan tidak bisa dipotong dengan aman. Pecah dokumen menjadi beberapa file.',
    en: 'The document is too large ({size} of XML content) and cannot be cut safely. Split it into several files.',
  },
  'doc.docx.cut': {
    id: 'Dokumen dipotong: hanya {cut} pertama dari {total} isi dokumen (~{percent}%) yang dibaca.',
    en: 'The document was cut: only the first {cut} of its {total} of content (~{percent}%) were read.',
  },

  // ---- PDF (documents/pdf.ts) ------------------------------------------------------------------------------------
  'doc.pdf.scanNote': { id: '_(tidak ada teks yang bisa dibaca di halaman ini — gambar/hasil scan?)_', en: '_(no readable text on this page — an image or a scan?)_' },
  'doc.pdf.brokenNote': { id: '_(halaman ini rusak dan tidak bisa dibaca)_', en: '_(this page is damaged and cannot be read)_' },
  'doc.pdf.morePages': { id: '{pages} dan {more} lainnya', en: '{pages} and {more} more' },
  'doc.pdf.password': {
    id: 'PDF ini dilindungi kata sandi (terenkripsi). Lampirkan salinan tanpa kata sandi.',
    en: 'This PDF is password-protected (encrypted). Attach a copy without the password.',
  },
  'doc.pdf.certificate': {
    id: 'PDF ini dilindungi sertifikat/enkripsi khusus. Lampirkan salinan tanpa perlindungan.',
    en: 'This PDF is protected with a certificate or special encryption. Attach an unprotected copy.',
  },
  'doc.pdf.corrupt': { id: 'File rusak atau bukan PDF yang valid ({error}).', en: 'The file is damaged or not a valid PDF ({error}).' },
  'doc.pdf.restricted': {
    id: 'PDF ini memiliki pembatasan penggunaan (owner password); teksnya tetap dibaca untuk analisis.',
    en: 'This PDF has usage restrictions (owner password); its text is still read for analysis.',
  },
  'doc.pdf.noPages': { id: 'File rusak: tidak ada halaman PDF yang bisa dibaca.', en: 'The file is damaged: no PDF page could be read.' },
  'doc.pdf.noTextLayer': {
    id: 'PDF tidak memiliki lapisan teks (hasil scan/gambar?); OCR belum didukung. Lampirkan PDF dengan teks atau versi Word-nya.',
    en: 'The PDF has no text layer (a scan or images?); OCR is not supported yet. Attach a PDF with text or its Word version.',
  },
  'doc.pdf.pagesWithoutText': {
    id: 'Halaman {pages} tidak memiliki lapisan teks (gambar/hasil scan?); OCR belum didukung.',
    en: (p: { pages: string; n: number }) =>
      `${p.n === 1 ? 'Page' : 'Pages'} ${p.pages} ${p.n === 1 ? 'has' : 'have'} no text layer (images or scans?); OCR is not supported yet.`,
  },
  'doc.pdf.brokenPages': {
    id: 'Halaman {pages} rusak dan dilewati.',
    en: (p: { pages: string; n: number }) => `${p.n === 1 ? 'Page' : 'Pages'} ${p.pages} ${p.n === 1 ? 'is' : 'are'} damaged and ${p.n === 1 ? 'was' : 'were'} skipped.`,
  },
  'doc.pdf.noUnicode': {
    id: 'Sebagian teks mungkin tidak terbaca dengan benar: PDF memakai font tanpa pemetaan Unicode.',
    en: 'Some text may not read correctly: the PDF uses fonts without a Unicode mapping.',
  },
  'doc.pdf.cut': { id: 'PDF dipotong setelah halaman {last} dari {total} ({reason}).', en: 'The PDF was cut after page {last} of {total} ({reason}).' },
  'doc.pdf.charLimit': { id: 'batas {n} karakter', en: 'limit of {n} characters' },
  'doc.pdf.pageLimit': { id: 'batas {n} halaman', en: 'limit of {n} pages' },

  // ---- PowerPoint (documents/pptx.ts) ------------------------------------------------------------------------------
  'doc.pptx.badPart': { id: 'Presentasi rusak (bagian {part} tidak bisa dibaca).', en: 'The presentation is damaged (the part {part} cannot be read).' },
  'doc.pptx.tableCutNote': {
    id: '_(tabel dipotong: maksimal {rows} baris × {columns} kolom)_',
    en: '_(table cut: at most {rows} rows × {columns} columns)_',
  },
  'doc.pptx.invalid': {
    id: 'File bukan presentasi PowerPoint yang valid (ppt/presentation.xml tidak ada).',
    en: 'The file is not a valid PowerPoint presentation (ppt/presentation.xml is missing).',
  },
  'doc.pptx.slideLimit': {
    id: 'Presentasi dipotong: hanya {limit} dari {total} slide pertama yang dibaca.',
    en: 'The presentation was cut: only the first {limit} of {total} slides were read.',
  },
  'doc.pptx.slideMissingNote': { id: '_(bagian slide tidak ada)_', en: '_(the slide part is missing)_' },
  'doc.pptx.cutAfter': {
    id: 'Presentasi dipotong setelah slide {slide} dari {total} (batas {max} karakter).',
    en: 'The presentation was cut after slide {slide} of {total} (limit of {max} characters).',
  },
  'doc.pptx.noSlides': { id: 'Presentasi tidak berisi slide.', en: 'The presentation has no slides.' },
  'doc.pptx.noText': {
    id: 'Tidak ada teks di slide mana pun (presentasi berisi gambar saja?).',
    en: 'None of the slides has any text (does the presentation contain only images?).',
  },
  'doc.pptx.tablesCut': {
    id: '{n} tabel lebih besar dari {rows} baris × {columns} kolom dan dipotong.',
    en: (p: { n: number; rows: number; columns: number }) =>
      `${count(p.n, 'table')} larger than ${p.rows} rows × ${p.columns} columns ${p.n === 1 ? 'was' : 'were'} cut.`,
  },
  'doc.pptx.chartsCut': {
    id: '{n} grafik berisi lebih dari {series} seri atau 200 kategori; hanya bagian awalnya yang dibaca.',
    en: (p: { n: number; series: number }) =>
      `${count(p.n, 'chart')} had more than ${p.series} series or 200 categories; only the first part was read.`,
  },
  'doc.pptx.cellsCut': {
    id: '{n} sel tabel berisi lebih dari {max} karakter dan dipotong.',
    en: (p: { n: string; cells: number; max: string }) =>
      `${p.n} table ${p.cells === 1 ? 'cell had' : 'cells had'} more than ${p.max} characters and ${p.cells === 1 ? 'was' : 'were'} cut.`,
  },
  'doc.pptx.macros': {
    id: 'Presentasi berisi makro; makro diabaikan (tidak pernah dijalankan).',
    en: 'The presentation contains macros; they were ignored (never run).',
  },

  // ---- Excel (documents/xlsx.ts) ------------------------------------------------------------------------------------
  'doc.xlsx.noWorkbook': {
    id: 'File bukan workbook Excel yang valid (xl/workbook.xml tidak ada).',
    en: 'The file is not a valid Excel workbook (xl/workbook.xml is missing).',
  },
  'doc.xlsx.noSheets': {
    id: 'File bukan workbook Excel yang valid (tidak berisi worksheet).',
    en: 'The file is not a valid Excel workbook (it has no worksheets).',
  },
  'doc.xlsx.macros': {
    id: 'Workbook berisi makro VBA; makro diabaikan (tidak pernah dijalankan).',
    en: 'The workbook contains VBA macros; they were ignored (never run).',
  },
  'doc.xlsx.sheetLimit': {
    id: 'Workbook dipotong: hanya {max} dari {total} sheet pertama yang dibaca.',
    en: 'The workbook was cut: only the first {max} of {total} sheets were read.',
  },
  'doc.xlsx.sharedStringTooLarge': {
    id: 'File terlalu besar: satu teks di shared strings melebihi 16 MB XML.',
    en: 'The file is too large: one shared-strings text exceeds 16 MB of XML.',
  },
  'doc.xlsx.rowTooLarge': {
    id: 'File terlalu besar: satu baris di sheet "{sheet}" melebihi 16 MB XML.',
    en: 'The file is too large: one row of the sheet "{sheet}" exceeds 16 MB of XML.',
  },
  'doc.xlsx.noSharedStrings': {
    id: 'Workbook merujuk shared strings, tetapi xl/sharedStrings.xml tidak ada; sebagian sel tampil kosong.',
    en: 'The workbook refers to shared strings, but xl/sharedStrings.xml is missing; some cells appear empty.',
  },
  'doc.xlsx.sheetLimitNote': { id: '_(tidak dibaca: batas jumlah sheet tercapai)_', en: '_(not read: sheet limit reached)_' },
  'doc.xlsx.chartSheetNote': { id: '_(sheet grafik — tidak ada data sel)_', en: '_(chart sheet — no cell data)_' },
  'doc.xlsx.sheetMissingNote': { id: '_(bagian sheet tidak ada)_', en: '_(the sheet part is missing)_' },
  'doc.xlsx.sheetMissing': {
    id: 'Sheet "{sheet}" tidak bisa dibaca (bagiannya tidak ada di file).',
    en: 'Sheet "{sheet}" could not be read (its part is missing from the file).',
  },
  'doc.xlsx.textLimitNote': { id: '_(tidak dibaca: batas panjang teks tercapai)_', en: '_(not read: text length limit reached)_' },
  'doc.xlsx.emptyNote': { id: '_(sheet kosong)_', en: '_(empty sheet)_' },
  'doc.xlsx.empty': { id: 'Sheet "{sheet}" kosong.', en: 'Sheet "{sheet}" is empty.' },
  'doc.xlsx.cutForChars': {
    id: 'Sheet "{sheet}" dipotong: hanya {rows} baris pertama yang ditampilkan (batas {max} karakter).',
    en: 'Sheet "{sheet}" was cut: only the first {rows} rows are shown (limit of {max} characters).',
  },
  'doc.xlsx.cutForCharsNote': {
    id: '_(dipotong: {rows} baris pertama ditampilkan, batas panjang teks tercapai)_',
    en: '_(cut: the first {rows} rows are shown, text length limit reached)_',
  },
  'doc.xlsx.of': { id: ' dari {n}', en: ' of {n}' },
  'doc.xlsx.ofAtLeast': { id: ' dari setidaknya {n}', en: ' of at least {n}' },
  'doc.xlsx.cutRows': {
    id: 'Sheet "{sheet}" dipotong: hanya {shown} baris pertama{of} yang ditampilkan.',
    en: 'Sheet "{sheet}" was cut: only the first {shown} rows{of} are shown.',
  },
  'doc.xlsx.cutRowsNote': { id: '_(dipotong: {shown} baris pertama{of} ditampilkan)_', en: '_(cut: the first {shown} rows{of} are shown)_' },
  'doc.xlsx.cutColumns': {
    id: 'Sheet "{sheet}" dipotong: hanya {max} kolom pertama yang ditampilkan.',
    en: 'Sheet "{sheet}" was cut: only the first {max} columns are shown.',
  },
  'doc.xlsx.formulas': {
    id: 'Sheet "{sheet}": {n} sel rumus belum punya nilai tersimpan (ditampilkan sebagai rumus): {cells}.',
    en: (p: { sheet: string; n: number; cells: string }) =>
      `Sheet "${p.sheet}": ${count(p.n, 'formula cell')} ${p.n === 1 ? 'has' : 'have'} no stored value (shown as ${p.n === 1 ? 'a formula' : 'formulas'}): ${p.cells}.`,
  },
  'doc.xlsx.cellsCut': {
    id: '{n} sel berisi lebih dari {max} karakter dan dipotong.',
    en: (p: { n: string; cells: number; max: string }) =>
      `${p.n} ${p.cells === 1 ? 'cell had' : 'cells had'} more than ${p.max} characters and ${p.cells === 1 ? 'was' : 'were'} cut.`,
  },
  'doc.xlsx.sheetsSkipped': {
    id: '{n} sheet terakhir tidak dibaca karena teks workbook sudah mencapai batas {max} karakter.',
    en: (p: { n: number; max: string }) =>
      `The last ${p.n === 1 ? 'sheet was' : `${p.n} sheets were`} not read because the workbook text reached the limit of ${p.max} characters.`,
  },
} as const satisfies Catalog;
