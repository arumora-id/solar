import type { UserStatus } from '@solar/shared';
import { numId } from '../helpers';

/** Settings → Pengguna (components/settings/UsersPanel.tsx). Role names come from ROLE_INFO (lib/auth.tsx roleName). */
export const users = {
  introAdmin: 'Kelola akun SOLAR: setujui pendaftaran, atur peran, nonaktifkan, reset password atau hapus akun.',
  introHead: 'Setujui pendaftaran (sebagai Staf Solar) dan nonaktifkan atau aktifkan akun staf. Perubahan lain dilakukan superadmin.',

  filters: {
    label: 'Status akun',
    pending: 'Menunggu',
    active: 'Aktif',
    disabled: 'Nonaktif',
    all: 'Semua',
  },
  search: {
    placeholder: 'Cari pengguna…',
    label: 'Cari pengguna',
  },

  status: {
    pending: 'Menunggu persetujuan',
    active: 'Aktif',
    disabled: 'Nonaktif',
  } satisfies Record<UserStatus, string>,

  you: 'Anda',
  joined: (date: string) => `Mendaftar ${date}`,
  lastLogin: (time: string) => `Terakhir masuk ${time}`,
  neverLoggedIn: 'Belum pernah masuk',
  count: (n: number) => `${numId(n)} akun`,

  empty: {
    pending: 'Tidak ada pendaftaran yang menunggu. Semua beres!',
    active: 'Belum ada akun aktif.',
    disabled: 'Tidak ada akun yang dinonaktifkan.',
    all: 'Belum ada akun.',
    search: 'Tidak ada akun yang cocok dengan pencarian.',
  },

  actions: {
    approve: 'Setujui',
    approveAs: 'Setujui sebagai',
    reject: 'Tolak',
    rejectTitle: 'Tolak pendaftaran (akun dinonaktifkan)',
    disable: 'Nonaktifkan',
    enable: 'Aktifkan',
    manage: 'Kelola',
    manageClose: 'Tutup',
    manageLabel: (name: string) => `Kelola akun ${name}`,
    role: 'Peran',
    saveRole: 'Ubah peran',
    roleHint: 'Mengubah peran mengakhiri semua sesi login akun ini.',
    rename: 'Nama tampilan',
    saveName: 'Simpan nama',
    resetPassword: 'Reset password',
    resetHint:
      'Password lama tidak pernah ditampilkan. Tetapkan password baru, sampaikan ke pemilik akun lewat jalur yang aman, lalu minta ia menggantinya. Semua sesi akun ini diakhiri.',
    resetDone: (name: string) => `Password baru sudah berlaku. Sampaikan ke ${name} lewat jalur yang aman; ia bisa menggantinya dari menu akunnya.`,
    generate: 'Buat password acak',
    delete: 'Hapus akun',
    deleteHint: 'Menghapus akun dan sesinya. Task-nya tetap ada dan tampil sebagai "Pengguna terhapus".',
    dangerZone: 'Tindakan berisiko',
    readOnly: 'Hanya superadmin yang bisa mengubah akun ini.',
    self: 'Ini akun Anda: peran, status, password dan penghapusannya tidak bisa diubah sendiri dari sini.',
  },

  /** Confirmations shown after an action (aria-live). */
  done: {
    approved: (name: string, role: string) => `${name} disetujui sebagai ${role}.`,
    rejected: (name: string) => `Pendaftaran ${name} ditolak; akunnya dinonaktifkan.`,
    disabled: (name: string) => `${name} dinonaktifkan dan sesi login-nya diakhiri.`,
    enabled: (name: string) => `${name} diaktifkan kembali.`,
    role: (name: string, role: string) => `Peran ${name} sekarang ${role}; sesi login-nya diakhiri.`,
    renamed: (name: string) => `Nama tampilan diubah menjadi ${name}.`,
    passwordReset: (name: string) => `Password ${name} direset dan semua sesinya diakhiri.`,
    deleted: (name: string) => `Akun ${name} dihapus.`,
    created: (name: string) => `Akun ${name} dibuat dan langsung aktif.`,
  },

  confirmDelete: {
    title: (name: string) => `Hapus akun ${name}?`,
    body: 'Akun dan semua sesi login-nya dihapus permanen. Task yang pernah dibuatnya tetap ada dan tampil sebagai "Pengguna terhapus". Tindakan ini tidak bisa dibatalkan.',
    confirm: 'Hapus permanen',
  },

  create: {
    button: 'Tambah pengguna',
    title: 'Pengguna baru',
    intro: 'Akun yang dibuat superadmin langsung aktif, tanpa menunggu persetujuan.',
    submit: 'Buat akun',
  },

  errors: {
    selfAction: 'Anda tidak bisa mengubah peran, menonaktifkan, mereset password atau menghapus akun Anda sendiri.',
    lastSuperadmin: 'Harus tetap ada minimal satu superadmin aktif. Jadikan pengguna lain superadmin terlebih dahulu.',
    forbidden: 'Peran Anda tidak diizinkan melakukan ini pada akun tersebut.',
    notPending: 'Akun ini sudah tidak menunggu persetujuan; mungkin sudah ditangani admin lain.',
    notFound: 'Akun ini sudah tidak ada; mungkin baru saja dihapus.',
  },

  /** The role list under the filters ("Tentang peran"). */
  rolesHelp: 'Tentang peran',
};
