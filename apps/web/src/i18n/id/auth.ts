import { numId } from '../helpers';

/**
 * Login, self-registration and first-superadmin setup (components/auth/*), the user menu and the change-password
 * dialog of the top bar (components/UserMenu.tsx). Role names come from ROLE_INFO (packages/shared) via lib/auth.tsx.
 */
export const auth = {
  /** The panel with Robo next to the form (desktop) and the short header above it (phones). */
  hero: {
    tagline: 'Asisten AI Solution Architect',
    pointDiagrams: 'Model ArchiMate dan sequence diagram',
    pointDocuments: 'Technical Specification Document, siap sebagai Word',
    pointKnowledge: 'Knowledge base dan skill bersama tim',
    robotLabel: 'Robo, maskot SOLAR AI AGENT',
  },

  /** Robo's speech bubble, per screen and moment. */
  say: {
    login: 'Halo! Saya Robo. Silakan masuk untuk mulai bekerja.',
    register: 'Senang berkenalan! Isi data Anda, ya.',
    registered: 'Pendaftaran Anda sudah saya terima.',
    setup: 'Server baru! Mari buat akun superadmin pertama.',
    pending: 'Akun Anda masih ditinjau.',
    disabled: 'Akun ini sedang dinonaktifkan.',
    unreachable: 'Saya belum bisa menghubungi server.',
    error: 'Hmm, ada yang belum pas.',
    password: 'Tenang, saya tidak mengintip.',
    welcome: (name: string) => `Selamat datang, ${name}!`,
  },

  fields: {
    identifier: 'Username atau email',
    identifierPlaceholder: 'budi.santoso atau budi@kantor.co.id',
    username: 'Username',
    usernameHint: '3-32 karakter: huruf kecil a-z, angka, titik (.), garis bawah (_) atau tanda hubung (-).',
    usernamePlaceholder: 'budi.santoso',
    email: 'Email',
    emailPlaceholder: 'budi@kantor.co.id',
    name: 'Nama tampilan',
    nameHint: 'Nama yang dilihat rekan kerja Anda di SOLAR.',
    namePlaceholder: 'Budi Santoso',
    password: 'Password',
    newPassword: 'Password baru',
    confirmPassword: 'Ulangi password',
    currentPassword: 'Password saat ini',
    setupCode: 'Kode penyiapan',
    showPassword: 'Tampilkan password',
    hidePassword: 'Sembunyikan password',
    capsLock: 'Caps Lock aktif',
    remember: 'Ingat username/email saya di perangkat ini',
  },

  login: {
    title: 'Masuk ke SOLAR',
    subtitle: 'Gunakan username atau email dan password akun Anda.',
    submit: 'Masuk',
    submitting: 'Memeriksa…',
    /** On the disabled submit button while a rate limit lasts ("Coba lagi dalam 14:32"). */
    waitButton: (time: string) => `Coba lagi dalam ${time}`,
    noAccount: 'Belum punya akun?',
    register: 'Daftar sekarang',
    forgot: 'Lupa password? Minta superadmin untuk meresetnya.',
  },

  /** Shown above the login form: why it appeared. */
  notice: {
    loggedOut: 'Anda sudah keluar. Sampai jumpa lagi!',
    sessionEnded: 'Sesi Anda berakhir. Silakan masuk lagi untuk melanjutkan.',
    setupDone: 'Superadmin pertama sudah dibuat. Silakan masuk.',
  },

  errors: {
    invalidCredentials: 'Username/email atau password salah.',
    rateLimited: (time: string) => `Terlalu banyak percobaan. Coba lagi dalam ${time}.`,
    /** With the live countdown on the submit button (the text itself has no time, so it never goes stale). */
    rateLimitedWait: 'Terlalu banyak percobaan. Tombol di bawah aktif lagi setelah hitungan mundurnya selesai.',
    /** Registrations are counted per network address (an office behind one address shares the limit). */
    registerRateLimited:
      'Sudah banyak pendaftaran dari jaringan ini dalam satu jam terakhir. Tombol Daftar aktif lagi setelah hitungan mundurnya selesai, atau minta superadmin membuatkan akun untuk Anda.',
    busy: 'Server sedang sibuk memeriksa banyak login. Coba lagi dalam beberapa detik.',
    required: 'Wajib diisi.',
    /** The rule itself is the field's hint, right below. */
    usernameFormat: 'Format username belum sesuai.',
    emailFormat: 'Alamat email tidak valid.',
    nameLength: 'Nama tampilan 1-80 karakter.',
    passwordShort: (min: number) => `Minimal ${numId(min)} karakter.`,
    passwordLong: (max: number) => `Maksimal ${numId(max)} karakter.`,
    passwordBlank: 'Password tidak boleh hanya spasi.',
    passwordSameAsIdentity: 'Password tidak boleh sama dengan username atau email.',
    mismatch: 'Kedua password tidak sama.',
    usernameTaken: 'Username ini sudah dipakai. Pilih yang lain.',
    emailTaken: 'Email ini sudah terdaftar. Silakan masuk, atau minta superadmin mereset password Anda.',
    registrationClosed: 'Pendaftaran dibuka setelah superadmin pertama dibuat.',
    setupCodeInvalid: 'Kode penyiapan salah. Periksa lagi log server atau file setup-code.txt.',
    setupForbidden: 'Superadmin pertama hanya bisa dibuat dari komputer yang menjalankan server SOLAR (localhost).',
    wrongPassword: 'Password saat ini salah.',
    fixFields: 'Periksa lagi kolom yang ditandai.',
  },

  /** Remaining waiting time of a rate limit, in words. */
  time: {
    seconds: (s: number) => `${numId(s)} detik`,
    minutes: (m: number) => `${numId(m)} menit`,
    minutesSeconds: (m: number, s: number) => `${numId(m)} menit ${numId(s)} detik`,
  },

  register: {
    title: 'Buat akun',
    subtitle: 'Daftar sendiri, lalu tunggu persetujuan.',
    submit: 'Daftar',
    submitting: 'Mengirim pendaftaran…',
    haveAccount: 'Sudah punya akun?',
    login: 'Masuk',
    nextTitle: 'Yang terjadi setelah mendaftar',
    next: 'Akun Anda menunggu persetujuan Superadmin atau Head of IT Solar. Anda bisa masuk begitu akun disetujui.',
    closed: 'Pendaftaran belum dibuka karena superadmin pertama belum dibuat.',
  },

  registered: {
    title: 'Pendaftaran terkirim',
    body: (username: string) => `Akun "${username}" sudah dibuat dan sekarang menunggu persetujuan.`,
    step1: 'Superadmin atau Head of IT Solar meninjau pendaftaran Anda.',
    step2: 'Setelah disetujui, masuk dengan username atau email dan password tadi.',
    step3: 'Butuh cepat? Hubungi Head of IT Solar.',
    back: 'Ke halaman masuk',
  },

  pending: {
    title: 'Akun menunggu persetujuan',
    body: 'Password Anda benar, tetapi akun ini belum disetujui. Superadmin atau Head of IT Solar akan meninjaunya; setelah itu Anda bisa langsung masuk.',
    back: 'Kembali ke halaman masuk',
  },

  disabled: {
    title: 'Akun dinonaktifkan',
    body: 'Akun ini sedang dinonaktifkan sehingga tidak bisa dipakai masuk. Hubungi superadmin atau Head of IT Solar bila menurut Anda ini keliru.',
    back: 'Kembali ke halaman masuk',
  },

  setup: {
    title: 'Siapkan SOLAR',
    subtitle: 'Belum ada akun di server ini. Buat akun superadmin pertama; pengguna lain bisa mendaftar sesudahnya.',
    submit: 'Buat superadmin dan masuk',
    submitting: 'Menyiapkan…',
    codeHint:
      'Kode sekali pakai (XXXX-XXXX-XXXX-XXXX) yang tercetak di log server saat SOLAR dijalankan dan tersimpan di file setup-code.txt di folder data SOLAR. Huruf besar/kecil, spasi dan tanda hubung tidak berpengaruh.',
    codePrefilled: 'Diisi otomatis oleh aplikasi desktop.',
    codeRefreshed: 'Kode penyiapan tadi sudah tidak berlaku. Aplikasi desktop sudah mengisi kode yang berlaku sekarang: kirim lagi.',
    codePlaceholder: 'XXXX-XXXX-XXXX-XXXX',
    localOnly: 'Penyiapan hanya bisa dilakukan dari komputer yang menjalankan server SOLAR.',
    roleNote: 'Superadmin memegang semua akses: akun pengguna, model AI, plugin MCP dan konfigurasi.',
  },

  unreachable: {
    title: 'Server tidak terjangkau',
    body: 'SOLAR tidak bisa menghubungi server. Pastikan server berjalan dan jaringan tersambung, lalu coba lagi.',
    retry: 'Coba lagi',
    stillDown: (time: string) => `Server masih belum terjangkau (dicoba pukul ${time}).`,
  },

  loading: 'Menyiapkan SOLAR…',

  strength: {
    label: 'Kekuatan password',
    level0: 'Terlalu pendek',
    level1: 'Lemah',
    level2: 'Cukup',
    level3: 'Baik',
    level4: 'Kuat',
    tip: 'Kalimat panjang yang mudah Anda ingat lebih kuat daripada kata pendek yang rumit.',
  },

  policy: {
    label: 'Syarat password',
    length: (min: number, max: number) => `${numId(min)}-${numId(max)} karakter`,
    notIdentity: 'Tidak sama dengan username atau email',
    match: 'Kedua password sama',
    met: 'terpenuhi',
    notMet: 'belum terpenuhi',
  },

  /** The account button and menu in the top bar. */
  menu: {
    button: (name: string) => `Akun: ${name}`,
    signedInAs: 'Masuk sebagai',
    changePassword: 'Ganti password',
    logout: 'Keluar',
    logoutUnreachable: 'Gagal keluar: server tidak dapat dihubungi. Anda masih masuk di perangkat ini; coba lagi.',
    logoutFailed: 'Gagal keluar. Anda masih masuk di perangkat ini; coba lagi sebentar lagi.',
    tokenUser: 'Token akses (SOLAR_ACCESS_TOKEN)',
  },

  changePassword: {
    title: 'Ganti password',
    intro: 'Setelah diganti, sesi Anda di perangkat lain diakhiri; sesi di sini tetap berjalan.',
    submit: 'Simpan password baru',
    done: 'Password berhasil diganti. Sesi di perangkat lain sudah diakhiri.',
    sameAsCurrent: 'Password baru harus berbeda dari password saat ini.',
  },

  /** Top bar button of approvers: registrations waiting. */
  pendingBadge: {
    label: (n: number) => `${numId(n)} pendaftaran menunggu persetujuan`,
    title: 'Buka daftar pendaftaran yang menunggu',
  },

  /** The entrance into the app after logging in (screen reader, after the welcome). */
  entering: 'Masuk ke SOLAR…',
};
