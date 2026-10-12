import { count, type Catalog } from './helpers.js';

/**
 * What a summary of an activity-log entry is built from: the actor and target as people read them (names already
 * resolved, in the language of the request), the role names of the entry, the entry's details and its outcome.
 */
export interface ActivitySummaryParams {
  actor: string;
  target: string;
  outcome: 'success' | 'failure';
  /** The entry's details (never secrets). */
  d: Record<string, unknown>;
  /** Display name of a role code in the language of the request (for `d.role`, `d.from`, `d.to`). */
  role: (code: unknown) => string;
}

type S = ActivitySummaryParams;

const str = (v: unknown, fallback = '-'): string => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : fallback);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const viaAgent = (p: S) => p.d.via === 'agent';

/** The reason of a refusal as people read it (unknown codes are shown as they are). */
const REASONS_ID: Record<string, string> = {
  wrong_password: 'password salah',
  pending: 'akun masih menunggu persetujuan',
  disabled: 'akun dinonaktifkan',
  rate_limited: 'terlalu banyak percobaan',
  forbidden: 'tidak diizinkan',
  self_action: 'akun sendiri',
  last_superadmin: 'superadmin aktif terakhir',
  not_pending: 'tidak sedang menunggu persetujuan',
  user_not_found: 'pengguna tidak ditemukan',
  setup_forbidden: 'bukan dari komputer server',
  setup_code_invalid: 'kode penyiapan salah',
  setup_not_available: 'sudah ada akun',
  invalid_input: 'isian tidak valid',
  weak_password: 'password terlalu lemah',
  username_taken: 'username sudah dipakai',
  email_taken: 'email sudah terdaftar',
  error: 'error',
};
const REASONS_EN: Record<string, string> = {
  wrong_password: 'wrong password',
  pending: 'the account is waiting for approval',
  disabled: 'the account is disabled',
  rate_limited: 'too many attempts',
  forbidden: 'not allowed',
  self_action: 'own account',
  last_superadmin: 'last active superadmin',
  not_pending: 'not waiting for approval',
  user_not_found: 'user not found',
  setup_forbidden: 'not from the server computer',
  setup_code_invalid: 'wrong setup code',
  setup_not_available: 'an account already exists',
  invalid_input: 'invalid input',
  weak_password: 'password too weak',
  username_taken: 'username taken',
  email_taken: 'email already registered',
  error: 'error',
};
const reasonId = (p: S) => REASONS_ID[str(p.d.reason, 'error')] ?? str(p.d.reason);
const reasonEn = (p: S) => REASONS_EN[str(p.d.reason, 'error')] ?? str(p.d.reason);

/** A refused administrative action: "Ditolak: <what was tried> (<reason>)". */
const refusedId = (p: S, what: string) => (p.outcome === 'failure' ? `Ditolak: ${what} (${reasonId(p)})` : what);
const refusedEn = (p: S, what: string) => (p.outcome === 'failure' ? `Refused: ${what} (${reasonEn(p)})` : what);
const failedId = (p: S, what: string) => (p.outcome === 'failure' ? `Gagal: ${what}${p.d.reason ? ` (${reasonId(p)})` : ''}` : what);
const failedEn = (p: S, what: string) => (p.outcome === 'failure' ? `Failed: ${what}${p.d.reason ? ` (${reasonEn(p)})` : ''}` : what);
/** A change its route refused before it ran (no permission); any other outcome reads as the action itself. */
const forbiddenId = (p: S, what: string) => (p.outcome === 'failure' && p.d.reason === 'forbidden' ? `Ditolak: ${what} (${reasonId(p)})` : what);
const forbiddenEn = (p: S, what: string) => (p.outcome === 'failure' && p.d.reason === 'forbidden' ? `Refused: ${what} (${reasonEn(p)})` : what);
const agentId = (p: S) => (viaAgent(p) ? ' (lewat agen)' : '');
const agentEn = (p: S) => (viaAgent(p) ? ' (through the agent)' : '');

/**
 * The activity log in both languages: a label per action code (filter dropdown, CSV) and a one-line summary per entry
 * (`summary` of `GET /api/activity`). Request-scoped: written in the language of the request that reads the log.
 */
export const ACTIVITY_MESSAGES = {
  // ---- labels of the action codes -------------------------------------------------------------------------------
  'activity.action.auth.login': { id: 'Masuk', en: 'Login' },
  'activity.action.auth.login_failed': { id: 'Login gagal', en: 'Failed login' },
  'activity.action.auth.logout': { id: 'Keluar', en: 'Logout' },
  'activity.action.auth.register': { id: 'Pendaftaran', en: 'Registration' },
  'activity.action.auth.setup': { id: 'Penyiapan superadmin pertama', en: 'First-superadmin setup' },
  'activity.action.auth.password_change': { id: 'Ganti password sendiri', en: 'Own password change' },
  'activity.action.auth.session_revoked': { id: 'Sesi login diakhiri', en: 'Login sessions ended' },
  'activity.action.user.create': { id: 'Akun dibuat', en: 'Account created' },
  'activity.action.user.approve': { id: 'Pendaftaran disetujui', en: 'Registration approved' },
  'activity.action.user.role_change': { id: 'Peran diubah', en: 'Role changed' },
  'activity.action.user.disable': { id: 'Akun dinonaktifkan', en: 'Account disabled' },
  'activity.action.user.enable': { id: 'Akun diaktifkan', en: 'Account enabled' },
  'activity.action.user.password_reset': { id: 'Password direset', en: 'Password reset' },
  'activity.action.user.delete': { id: 'Akun dihapus', en: 'Account deleted' },
  'activity.action.user.rename': { id: 'Nama akun diubah', en: 'Account renamed' },
  'activity.action.task.create': { id: 'Task dibuat', en: 'Task created' },
  'activity.action.task.cancel': { id: 'Task dibatalkan', en: 'Task cancelled' },
  'activity.action.confirmation.approve': { id: 'Aksi disetujui', en: 'Action approved' },
  'activity.action.confirmation.reject': { id: 'Aksi ditolak', en: 'Action declined' },
  'activity.action.knowledge.write': { id: 'Knowledge disimpan', en: 'Knowledge file saved' },
  'activity.action.knowledge.import_artifact': { id: 'Artefak disimpan ke knowledge', en: 'Artifact saved to knowledge' },
  'activity.action.knowledge.delete': { id: 'Knowledge dihapus', en: 'Knowledge file deleted' },
  'activity.action.knowledge.revert': { id: 'Knowledge dikembalikan ke bawaan', en: 'Knowledge file reverted to built-in' },
  'activity.action.knowledge.table_import': { id: 'Impor tabel ke knowledge', en: 'Table imported to knowledge' },
  'activity.action.knowledge.document_import': { id: 'Impor dokumen ke knowledge', en: 'Document imported to knowledge' },
  'activity.action.skill.create': { id: 'Skill dibuat', en: 'Skill created' },
  'activity.action.skill.update': { id: 'Skill diubah', en: 'Skill updated' },
  'activity.action.skill.delete': { id: 'Skill dihapus', en: 'Skill deleted' },
  'activity.action.skill.enable': { id: 'Skill diaktifkan', en: 'Skill enabled' },
  'activity.action.skill.disable': { id: 'Skill dinonaktifkan', en: 'Skill disabled' },
  'activity.action.settings.llm.provider_create': { id: 'Provider AI ditambahkan', en: 'AI provider added' },
  'activity.action.settings.llm.provider_update': { id: 'Provider AI diubah', en: 'AI provider changed' },
  'activity.action.settings.llm.provider_delete': { id: 'Provider AI dihapus', en: 'AI provider removed' },
  'activity.action.settings.llm.route_change': { id: 'Rute model AI diubah', en: 'AI model routes changed' },
  'activity.action.settings.llm.provider_test': { id: 'Tes koneksi provider AI', en: 'AI provider connection test' },
  'activity.action.settings.plugin.create': { id: 'Plugin MCP ditambahkan', en: 'MCP plugin added' },
  'activity.action.settings.plugin.update': { id: 'Plugin MCP diubah', en: 'MCP plugin changed' },
  'activity.action.settings.plugin.delete': { id: 'Plugin MCP dihapus', en: 'MCP plugin removed' },
  'activity.action.settings.plugin.reconnect': { id: 'Plugin MCP disambung ulang', en: 'MCP plugin reconnected' },
  'activity.action.artifact.docx_export': { id: 'Ekspor Word (.docx)', en: 'Word (.docx) export' },
  'activity.action.artifact.publish_github': { id: 'Publish ke GitHub', en: 'Published to GitHub' },
  'activity.action.activity.export': { id: 'Ekspor log aktivitas', en: 'Activity log export' },

  // ---- one-line summaries of entries ----------------------------------------------------------------------------
  'activity.summary.auth.login': { id: (p: S) => `${p.actor} masuk`, en: (p: S) => `${p.actor} logged in` },
  'activity.summary.auth.login_failed': {
    id: (p: S) => {
      if (p.d.reason === 'rate_limited') return `Login diblokir sementara${p.d.identifier ? ` untuk ${p.target}` : ''}: terlalu banyak percobaan`;
      if (!p.d.identifier) return 'Login gagal: username/email atau password salah';
      return `Login gagal untuk ${p.target}: ${reasonId(p)}`;
    },
    en: (p: S) => {
      if (p.d.reason === 'rate_limited') return `Login blocked for a while${p.d.identifier ? ` for ${p.target}` : ''}: too many attempts`;
      if (!p.d.identifier) return 'Failed login: wrong username/email or password';
      return `Failed login for ${p.target}: ${reasonEn(p)}`;
    },
  },
  'activity.summary.auth.logout': { id: (p: S) => `${p.actor} keluar`, en: (p: S) => `${p.actor} logged out` },
  'activity.summary.auth.register': {
    id: (p: S) => `${p.actor} mendaftar (menunggu persetujuan)`,
    en: (p: S) => `${p.actor} registered (waiting for approval)`,
  },
  'activity.summary.auth.setup': {
    id: (p: S) =>
      p.outcome === 'failure'
        ? `Penyiapan superadmin pertama ditolak (${reasonId(p)})`
        : `Superadmin pertama ${p.target} dibuat${p.d.via === 'env' ? ' (dari SOLAR_ADMIN_* saat server mulai)' : ''}`,
    en: (p: S) =>
      p.outcome === 'failure'
        ? `First-superadmin setup refused (${reasonEn(p)})`
        : `First superadmin ${p.target} created${p.d.via === 'env' ? ' (from SOLAR_ADMIN_* at server start)' : ''}`,
  },
  'activity.summary.auth.password_change': {
    id: (p: S) => (p.outcome === 'failure' ? `${p.actor} gagal mengganti password (${reasonId(p)})` : `${p.actor} mengganti password`),
    en: (p: S) => (p.outcome === 'failure' ? `${p.actor} could not change their password (${reasonEn(p)})` : `${p.actor} changed their password`),
  },
  'activity.summary.auth.session_revoked': {
    id: (p: S) => `${num(p.d.sessions)} sesi login ${p.target} diakhiri`,
    en: (p: S) => `Ended ${count(num(p.d.sessions), 'login session')} of ${p.target}`,
  },
  'activity.summary.user.create': {
    id: (p: S) => refusedId(p, `${p.actor} membuat akun ${p.target} (${p.role(p.d.role)})`),
    en: (p: S) => refusedEn(p, `${p.actor} created the account ${p.target} (${p.role(p.d.role)})`),
  },
  'activity.summary.user.approve': {
    id: (p: S) => refusedId(p, `${p.actor} menyetujui ${p.target} sebagai ${p.role(p.d.role)}`),
    en: (p: S) => refusedEn(p, `${p.actor} approved ${p.target} as ${p.role(p.d.role)}`),
  },
  'activity.summary.user.role_change': {
    id: (p: S) => refusedId(p, `${p.actor} mengubah peran ${p.target}: ${p.role(p.d.from)} → ${p.role(p.d.to)}`),
    en: (p: S) => refusedEn(p, `${p.actor} changed the role of ${p.target}: ${p.role(p.d.from)} → ${p.role(p.d.to)}`),
  },
  'activity.summary.user.disable': {
    id: (p: S) => refusedId(p, `${p.actor} menonaktifkan ${p.target}`),
    en: (p: S) => refusedEn(p, `${p.actor} disabled ${p.target}`),
  },
  'activity.summary.user.enable': {
    id: (p: S) => refusedId(p, `${p.actor} mengaktifkan kembali ${p.target}`),
    en: (p: S) => refusedEn(p, `${p.actor} enabled ${p.target}`),
  },
  'activity.summary.user.password_reset': {
    id: (p: S) => refusedId(p, `${p.actor} mereset password ${p.target}`),
    en: (p: S) => refusedEn(p, `${p.actor} reset the password of ${p.target}`),
  },
  'activity.summary.user.delete': {
    id: (p: S) => refusedId(p, `${p.actor} menghapus akun ${p.target}`),
    en: (p: S) => refusedEn(p, `${p.actor} deleted the account ${p.target}`),
  },
  'activity.summary.user.rename': {
    id: (p: S) => refusedId(p, `${p.actor} mengganti nama ${p.target}: "${str(p.d.from)}" → "${str(p.d.to)}"`),
    en: (p: S) => refusedEn(p, `${p.actor} renamed ${p.target}: "${str(p.d.from)}" → "${str(p.d.to)}"`),
  },
  'activity.summary.task.create': {
    id: (p: S) => `${p.actor} membuat task "${p.target}"`,
    en: (p: S) => `${p.actor} created the task "${p.target}"`,
  },
  'activity.summary.task.cancel': {
    id: (p: S) => `${p.actor} membatalkan task "${p.target}"`,
    en: (p: S) => `${p.actor} cancelled the task "${p.target}"`,
  },
  'activity.summary.confirmation.approve': {
    id: (p: S) => `${p.actor} menyetujui aksi "${p.target}"`,
    en: (p: S) => `${p.actor} approved "${p.target}"`,
  },
  'activity.summary.confirmation.reject': {
    id: (p: S) => `${p.actor} menolak aksi "${p.target}"`,
    en: (p: S) => `${p.actor} declined "${p.target}"`,
  },
  'activity.summary.knowledge.write': {
    id: (p: S) => `${p.actor} menyimpan knowledge ${p.target}${agentId(p)}`,
    en: (p: S) => `${p.actor} saved the knowledge file ${p.target}${agentEn(p)}`,
  },
  'activity.summary.knowledge.import_artifact': {
    id: (p: S) => `${p.actor} menyimpan artefak ${str(p.d.artifactName, str(p.d.artifactId))} ke knowledge ${p.target}${agentId(p)}`,
    en: (p: S) => `${p.actor} saved the artifact ${str(p.d.artifactName, str(p.d.artifactId))} to the knowledge file ${p.target}${agentEn(p)}`,
  },
  'activity.summary.knowledge.delete': {
    id: (p: S) => `${p.actor} menghapus knowledge ${p.target}`,
    en: (p: S) => `${p.actor} deleted the knowledge file ${p.target}`,
  },
  'activity.summary.knowledge.revert': {
    id: (p: S) => `${p.actor} mengembalikan knowledge ${p.target} ke versi bawaan`,
    en: (p: S) => `${p.actor} reverted the knowledge file ${p.target} to the built-in version`,
  },
  'activity.summary.knowledge.table_import': {
    id: (p: S) => `${p.actor} mengimpor tabel ${str(p.d.file)} ke ${p.target} (${num(p.d.written)} file ditulis, ${num(p.d.removed)} dihapus)`,
    en: (p: S) =>
      `${p.actor} imported the table ${str(p.d.file)} into ${p.target} (${count(num(p.d.written), 'file')} written, ${num(p.d.removed)} removed)`,
  },
  'activity.summary.knowledge.document_import': {
    id: (p: S) => `${p.actor} mengimpor dokumen ${str(p.d.file)} ke ${p.target} (${num(p.d.written)} file ditulis, ${num(p.d.removed)} dihapus)`,
    en: (p: S) =>
      `${p.actor} imported the document ${str(p.d.file)} into ${p.target} (${count(num(p.d.written), 'file')} written, ${num(p.d.removed)} removed)`,
  },
  'activity.summary.skill.create': {
    id: (p: S) => `${p.actor} membuat skill ${p.target}${p.d.via === 'import' ? ' (impor)' : ''}`,
    en: (p: S) => `${p.actor} created the skill ${p.target}${p.d.via === 'import' ? ' (import)' : ''}`,
  },
  'activity.summary.skill.update': { id: (p: S) => `${p.actor} mengubah skill ${p.target}`, en: (p: S) => `${p.actor} updated the skill ${p.target}` },
  'activity.summary.skill.delete': {
    id: (p: S) => (p.d.result === 'reverted' ? `${p.actor} mengembalikan skill ${p.target} ke versi bawaan` : `${p.actor} menghapus skill ${p.target}`),
    en: (p: S) => (p.d.result === 'reverted' ? `${p.actor} reverted the skill ${p.target} to the built-in version` : `${p.actor} deleted the skill ${p.target}`),
  },
  'activity.summary.skill.enable': { id: (p: S) => `${p.actor} mengaktifkan skill ${p.target}`, en: (p: S) => `${p.actor} enabled the skill ${p.target}` },
  'activity.summary.skill.disable': {
    id: (p: S) => `${p.actor} menonaktifkan skill ${p.target}`,
    en: (p: S) => `${p.actor} disabled the skill ${p.target}`,
  },
  'activity.summary.settings.llm.provider_create': {
    id: (p: S) => forbiddenId(p, `${p.actor} menambah provider AI ${p.target}`),
    en: (p: S) => forbiddenEn(p, `${p.actor} added the AI provider ${p.target}`),
  },
  'activity.summary.settings.llm.provider_update': {
    id: (p: S) => forbiddenId(p, `${p.actor} mengubah provider AI ${p.target}`),
    en: (p: S) => forbiddenEn(p, `${p.actor} changed the AI provider ${p.target}`),
  },
  'activity.summary.settings.llm.provider_delete': {
    id: (p: S) => forbiddenId(p, `${p.actor} menghapus provider AI ${p.target}`),
    en: (p: S) => forbiddenEn(p, `${p.actor} removed the AI provider ${p.target}`),
  },
  'activity.summary.settings.llm.route_change': {
    id: (p: S) => forbiddenId(p, `${p.actor} mengubah rute model AI`),
    en: (p: S) => forbiddenEn(p, `${p.actor} changed the AI model routes`),
  },
  'activity.summary.settings.llm.provider_test': {
    id: (p: S) =>
      p.d.reason === 'forbidden'
        ? forbiddenId(p, `${p.actor} menguji koneksi provider AI ${p.target}`)
        : `${p.actor} menguji koneksi provider AI ${p.target}: ${p.outcome === 'success' ? 'berhasil' : 'gagal'}`,
    en: (p: S) =>
      p.d.reason === 'forbidden'
        ? forbiddenEn(p, `${p.actor} tested the AI provider ${p.target}`)
        : `${p.actor} tested the AI provider ${p.target}: ${p.outcome === 'success' ? 'connected' : 'failed'}`,
  },
  'activity.summary.settings.plugin.create': {
    id: (p: S) => forbiddenId(p, `${p.actor} menambah plugin MCP ${p.target}`),
    en: (p: S) => forbiddenEn(p, `${p.actor} added the MCP plugin ${p.target}`),
  },
  'activity.summary.settings.plugin.update': {
    id: (p: S) => forbiddenId(p, `${p.actor} mengubah plugin MCP ${p.target}`),
    en: (p: S) => forbiddenEn(p, `${p.actor} changed the MCP plugin ${p.target}`),
  },
  'activity.summary.settings.plugin.delete': {
    id: (p: S) => forbiddenId(p, `${p.actor} menghapus plugin MCP ${p.target}`),
    en: (p: S) => forbiddenEn(p, `${p.actor} removed the MCP plugin ${p.target}`),
  },
  'activity.summary.settings.plugin.reconnect': {
    id: (p: S) => forbiddenId(p, `${p.actor} menyambung ulang plugin MCP ${p.target}`),
    en: (p: S) => forbiddenEn(p, `${p.actor} reconnected the MCP plugin ${p.target}`),
  },
  'activity.summary.artifact.docx_export': {
    id: (p: S) => `${p.actor} membuat file Word dari ${p.target}`,
    en: (p: S) => `${p.actor} exported ${p.target} as a Word file`,
  },
  'activity.summary.artifact.publish_github': {
    id: (p: S) => failedId(p, `${p.actor} mem-publish ${num(p.d.files)} artefak ke GitHub ${p.target}${agentId(p)}`),
    en: (p: S) => failedEn(p, `${p.actor} published ${count(num(p.d.files), 'artifact')} to GitHub ${p.target}${agentEn(p)}`),
  },
  'activity.summary.activity.export': {
    id: (p: S) => (p.d.reason === 'forbidden' ? forbiddenId(p, `${p.actor} mengekspor log aktivitas (CSV)`) : `${p.actor} mengekspor log aktivitas (CSV, ${num(p.d.rows)} baris)`),
    en: (p: S) =>
      p.d.reason === 'forbidden' ? forbiddenEn(p, `${p.actor} exported the activity log (CSV)`) : `${p.actor} exported the activity log (CSV, ${count(num(p.d.rows), 'row')})`,
  },

  // ---- names used in summaries and the CSV ----------------------------------------------------------------------
  'activity.actor.anonymous': { id: 'Seseorang (belum masuk)', en: 'Someone (not logged in)' },
  'activity.actor.token': { id: 'Token akses (SOLAR_ACCESS_TOKEN)', en: 'Access token (SOLAR_ACCESS_TOKEN)' },
  'activity.actor.system': { id: 'SOLAR', en: 'SOLAR' },
  'activity.actor.unknown': { id: 'Pengguna tak dikenal', en: 'Unknown user' },
  'activity.target.none': { id: '-', en: '-' },
  'activity.invalidCursor': { id: 'cursor: tidak valid', en: 'cursor: invalid' },
  'activity.invalidDate': { id: '{field}: tanggal tidak valid (pakai ISO 8601, mis. 2026-10-12)', en: '{field}: invalid date (use ISO 8601, e.g. 2026-10-12)' },
  'activity.unknownAction': { id: 'action: "{action}" tidak dikenal', en: 'action: unknown "{action}"' },
} as const satisfies Catalog;
