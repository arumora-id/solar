import { count, type Catalog } from './helpers.js';

/**
 * Request-scoped text of the login, registration and user administration API (shown on the login screen and in the
 * user list of the web UI).
 */
export const AUTH_MESSAGES = {
  // ---- authentication -----------------------------------------------------------------------------------------
  'auth.unauthenticated': { id: 'Silakan masuk terlebih dahulu', en: 'Please log in first' },
  'auth.invalidToken': { id: 'Token akses SOLAR tidak valid', en: 'Invalid SOLAR access token' },
  'auth.invalidCredentials': {
    id: 'Username/email atau password salah',
    en: 'Wrong username/email or password',
  },
  'auth.accountPending': {
    id: 'Akun Anda masih menunggu persetujuan superadmin atau Head of IT Solar. Silakan coba lagi setelah disetujui.',
    en: 'Your account is waiting for approval by a superadmin or the Head of IT Solar. Please try again once it is approved.',
  },
  'auth.accountDisabled': {
    id: 'Akun Anda dinonaktifkan. Hubungi superadmin atau Head of IT Solar.',
    en: 'Your account is disabled. Contact a superadmin or the Head of IT Solar.',
  },
  'auth.rateLimited': {
    id: (p: { minutes: number }) => `Terlalu banyak percobaan. Coba lagi dalam ${p.minutes} menit.`,
    en: (p: { minutes: number }) => `Too many attempts. Try again in ${count(p.minutes, 'minute')}.`,
  },
  'auth.busy': {
    id: 'Server sedang sibuk memeriksa banyak login sekaligus. Coba lagi dalam beberapa detik.',
    en: 'The server is busy checking many logins at once. Try again in a few seconds.',
  },
  'auth.forbidden': { id: 'Peran Anda tidak diizinkan melakukan ini', en: 'Your role is not allowed to do this' },
  'auth.sessionOnly': {
    id: 'Hanya untuk pengguna yang masuk dengan akun (bukan token akses)',
    en: 'Only for users logged in with an account (not the access token)',
  },

  // ---- registration and passwords -------------------------------------------------------------------------------
  'auth.usernameTaken': { id: 'Username "{username}" sudah dipakai', en: 'The username "{username}" is taken' },
  'auth.emailTaken': {
    id: 'Email ini sudah terdaftar. Silakan masuk, atau hubungi administrator bila lupa password.',
    en: 'This email is already registered. Log in, or ask an administrator if you forgot your password.',
  },
  'auth.registrationClosed': {
    id: 'Pendaftaran dibuka setelah superadmin pertama dibuat',
    en: 'Registration opens once the first superadmin has been created',
  },
  'auth.username.invalid': {
    id: 'username: 3-32 karakter, hanya huruf kecil a-z, angka, titik (.), garis bawah (_) dan tanda hubung (-)',
    en: 'username: 3-32 characters, only lower-case letters a-z, digits, dot (.), underscore (_) and dash (-)',
  },
  'auth.email.invalid': { id: 'email: alamat email tidak valid', en: 'email: not a valid email address' },
  'auth.name.invalid': {
    id: 'name: 1-80 karakter, tanpa karakter kontrol',
    en: 'name: 1-80 characters, no control characters',
  },
  'auth.password.tooShort': { id: 'password: minimal {min} karakter', en: 'password: at least {min} characters' },
  'auth.password.tooLong': { id: 'password: maksimal {max} karakter', en: 'password: at most {max} characters' },
  'auth.password.blank': { id: 'password: tidak boleh hanya spasi', en: 'password: must not be only spaces' },
  'auth.password.sameAsIdentity': {
    id: 'password: tidak boleh sama dengan username atau email',
    en: 'password: must not be the username or the email address',
  },
  'auth.wrongPassword': { id: 'Password saat ini salah', en: 'The current password is wrong' },

  // ---- first superadmin ------------------------------------------------------------------------------------------
  'auth.setupDone': {
    id: 'Superadmin pertama sudah dibuat. Silakan masuk.',
    en: 'The first superadmin has already been created. Please log in.',
  },
  'auth.setupCodeInvalid': {
    id: 'Kode penyiapan salah atau belum diisi. Kode ini tercetak di log server saat SOLAR dijalankan dan tersimpan di file setup-code.txt di folder data SOLAR.',
    en: 'The setup code is wrong or missing. It is printed in the server log when SOLAR starts and stored in setup-code.txt in the SOLAR data folder.',
  },
  'auth.setupForbidden': {
    id: 'Superadmin pertama hanya bisa dibuat dari komputer server ini (localhost) atau dengan SOLAR_ACCESS_TOKEN.',
    en: 'The first superadmin can only be created from the server computer itself (localhost) or with SOLAR_ACCESS_TOKEN.',
  },

  // ---- user administration ---------------------------------------------------------------------------------------
  'users.notFound': { id: 'Pengguna tidak ditemukan', en: 'User not found' },
  'users.notPending': { id: 'Akun ini tidak sedang menunggu persetujuan', en: 'This account is not waiting for approval' },
  'users.forbiddenTarget': {
    id: 'Anda tidak boleh mengubah akun ini atau memberi peran tersebut',
    en: 'You may not change this account or give that role',
  },
  'users.selfAction': {
    id: 'Anda tidak bisa mengubah peran, menonaktifkan, mereset password atau menghapus akun Anda sendiri',
    en: 'You cannot change the role of, disable, reset the password of or delete your own account',
  },
  'users.lastSuperadmin': {
    id: 'Harus tetap ada minimal satu superadmin aktif',
    en: 'At least one active superadmin must remain',
  },
  'users.cannotSetPending': {
    id: 'status: hanya "active" atau "disabled"',
    en: 'status: only "active" or "disabled"',
  },
  'users.deletedOwner': { id: 'Pengguna terhapus', en: 'Deleted user' },
  'users.tokenOwner': { id: 'Token akses (SOLAR_ACCESS_TOKEN)', en: 'Access token (SOLAR_ACCESS_TOKEN)' },
} as const satisfies Catalog;
