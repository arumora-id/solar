import { numId } from '../helpers';

/**
 * Shared words used all over the app: buttons, states and field names. Feature namespaces use these instead of
 * repeating them, so "Batal" / "Cancel" reads the same everywhere.
 */
export const common = {
  // actions
  cancel: 'Batal',
  save: 'Simpan',
  close: 'Tutup',
  delete: 'Hapus',
  remove: 'Hapus',
  download: 'Unduh',
  upload: 'Unggah',
  edit: 'Edit',
  add: 'Tambah',
  create: 'Buat',
  import: 'Impor',
  export: 'Ekspor',
  copy: 'Salin',
  copied: 'Disalin',
  send: 'Kirim',
  open: 'Buka',
  view: 'Lihat',
  preview: 'Pratinjau',
  search: 'Cari',
  select: 'Pilih',
  replace: 'Ganti',
  rename: 'Ganti nama',
  attach: 'Lampirkan',
  reload: 'Muat ulang',
  refresh: 'Segarkan',
  retry: 'Coba lagi',
  later: 'Nanti',
  next: 'Lanjut',
  back: 'Kembali',
  start: 'Mulai',
  stop: 'Hentikan',
  approve: 'Setujui',
  reject: 'Tolak',
  confirm: 'Konfirmasi',
  test: 'Tes',
  showMore: 'Tampilkan lebih banyak',
  showLess: 'Tampilkan lebih sedikit',

  // answers and states
  yes: 'Ya',
  no: 'Tidak',
  ok: 'OK',
  active: 'Aktif',
  inactive: 'Nonaktif',
  required: 'Wajib',
  optional: 'opsional',
  all: 'Semua',
  none: 'Tidak ada',
  auto: 'Otomatis',
  loading: 'Memuat…',
  saving: 'Menyimpan…',
  deleting: 'Menghapus…',
  uploading: 'Mengunggah…',
  done: 'Selesai',
  failed: 'Gagal',
  success: 'Berhasil',
  error: 'Kesalahan',
  unknown: 'Tidak diketahui',

  // field names
  name: 'Nama',
  type: 'Jenis',
  title: 'Judul',
  description: 'Deskripsi',
  details: 'Rincian',
  status: 'Status',
  progress: 'Progres',
  duration: 'Durasi',
  cost: 'Biaya',
  file: 'File',
  folder: 'Folder',
  path: 'Path',
  version: 'Versi',
  language: 'Bahasa',

  // counts
  files: (n: number) => `${numId(n)} file`,
  characters: (n: number) => `${numId(n)} karakter`,

  /** Language names in the current interface language (the switch itself shows each language in its own name). */
  languageName: {
    id: 'Bahasa Indonesia',
    en: 'Bahasa Inggris',
  },
};
