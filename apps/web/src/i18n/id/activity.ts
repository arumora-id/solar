import type { ActivityOutcome } from '@solar/shared';
import { numId } from '../helpers';

/**
 * Settings → Aktivitas (components/settings/ActivityPanel.tsx). Action labels and the one-line summaries come from the
 * server in the interface language (GET /api/activity/actions, ActivityItem.summary).
 */
export const activity = {
  introAll: 'Jejak audit semua pengguna: siapa melakukan apa dan kapan. Terbaru di atas.',
  introOwn: 'Aktivitas akun Anda: login, task, persetujuan, serta perubahan knowledge dan skill. Terbaru di atas.',

  filters: {
    label: 'Filter aktivitas',
    search: 'Cari nama, target atau rincian…',
    searchLabel: 'Cari di aktivitas',
    actor: 'Pelaku',
    anyActor: 'Semua pelaku',
    me: 'Saya',
    action: 'Aksi',
    anyAction: 'Semua aksi',
    wholeGroup: (group: string) => `Semua: ${group}`,
    outcome: 'Hasil',
    from: 'Dari tanggal',
    to: 'Sampai tanggal',
    reset: 'Reset filter',
  },

  /** Names of the action groups (the part of the action code before its last dot). */
  groups: {
    auth: 'Login & akun sendiri',
    user: 'Administrasi pengguna',
    task: 'Task',
    confirmation: 'Persetujuan',
    knowledge: 'Knowledge base',
    skill: 'Skill',
    'settings.llm': 'Model AI',
    'settings.plugin': 'Plugin MCP',
    artifact: 'Artefak',
    activity: 'Log aktivitas',
  } as Record<string, string>,

  outcome: {
    success: 'Berhasil',
    failure: 'Gagal',
  } satisfies Record<ActivityOutcome, string>,

  /** Who acted, when it was not an account. */
  actorKind: {
    token: 'Token akses (skrip)',
    anonymous: 'Belum masuk',
    system: 'Sistem SOLAR',
  },

  today: 'Hari ini',
  yesterday: 'Kemarin',

  details: 'Rincian',
  target: 'Target',
  ip: 'Alamat IP',
  userAgent: 'Perangkat / browser',
  data: 'Data',

  loadMore: 'Muat lagi',
  loading: 'Memuat aktivitas…',
  /** A page came back with few or no matches but the log goes on (the server reads the log in bounded chunks). */
  scanned: 'Sebagian log sudah diperiksa. Muat lagi untuk mencari entri yang lebih lama.',
  end: 'Sudah sampai entri paling lama.',
  empty: 'Tidak ada aktivitas yang cocok dengan filter ini.',
  emptyNoFilter: 'Belum ada aktivitas tercatat.',
  shown: (n: number) => `${numId(n)} entri ditampilkan`,

  export: 'Ekspor CSV',
  exportTitle: 'Unduh hasil filter ini sebagai CSV (maks. 100.000 baris)',
};
