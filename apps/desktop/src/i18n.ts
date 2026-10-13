import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Language of the desktop shell (menu and dialogs). It follows the language chosen in the SOLAR UI, which reports it
 * through the preload bridge (solarDesktop.setLanguage) and is remembered in a small file in the user data folder;
 * until then it follows the operating system (Indonesian or Malay -> Indonesian, English -> English, else Indonesian,
 * the same rule as the web UI).
 */
export type Lang = 'id' | 'en';

export function isLang(value: unknown): value is Lang {
  return value === 'id' || value === 'en';
}

export function langFromLocale(locale: string): Lang {
  const primary = locale.toLowerCase().split(/[-_]/)[0];
  return primary === 'en' ? 'en' : 'id';
}

/** The remembered language, or null when the file is missing or unreadable. */
export function readStoredLang(file: string): Lang | null {
  try {
    const value = (JSON.parse(readFileSync(file, 'utf8')) as { language?: unknown }).language;
    return isLang(value) ? value : null;
  } catch {
    return null;
  }
}

export function storeLang(file: string, lang: Lang): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ language: lang }, null, 2)}\n`);
  } catch {
    // the menu still switches for this run
  }
}

const id = {
  menu: {
    file: 'File',
    openEnv: 'Buka file .env (kredensial)',
    openData: 'Buka folder data & artefak',
    quit: 'Keluar',
    view: 'Tampilan',
    reload: 'Muat ulang',
    devTools: 'Developer tools',
    resetZoom: 'Ukuran normal',
    zoomIn: 'Perbesar',
    zoomOut: 'Perkecil',
    fullscreen: 'Layar penuh',
    window: 'Jendela',
    mini: 'Mode mini (selalu di atas)',
    minimize: 'Minimalkan',
    help: 'Bantuan',
    openInBrowser: 'Buka SOLAR AI AGENT di browser',
    openMonitorInBrowser: 'Buka Monitor Task di browser',
    setupCode: 'Kode penyiapan superadmin pertama…',
  },
  startFailed: 'SOLAR AI AGENT gagal dijalankan',
  firstRun: {
    title: 'Selamat datang di SOLAR AI AGENT',
    message: 'Isi kredensial di file .env terlebih dahulu',
    detail: (envFile: string) =>
      `File konfigurasi dibuat di:\n${envFile}\n\n` +
      'Isi minimal OPENAI_API_KEY. Opsional: DATABASE_URL (Neon), S3_* (object storage), GITHUB_TOKEN, PLANE_* dan VP_MCP_*. ' +
      'Simpan file lalu jalankan ulang SOLAR AI AGENT.\n\n' +
      'Akun superadmin pertama Anda buat langsung di jendela SOLAR; kode penyiapannya terisi otomatis.',
    openEnv: 'Buka file .env',
    later: 'Nanti',
  },
  setupCode: {
    title: 'Kode penyiapan',
    detail: (url: string) =>
      'Kode sekali pakai untuk membuat akun superadmin pertama. Jendela SOLAR mengisinya otomatis; kode ini hanya ' +
      `perlu diketik bila Anda membuat akun itu di browser pada komputer ini (${url}).\n\n` +
      'Kode tidak berlaku lagi setelah superadmin pertama dibuat. Jangan bagikan kode ini.',
    copy: 'Salin kode',
    close: 'Tutup',
    doneMessage: 'Superadmin pertama sudah dibuat',
    doneDetail: 'Kode penyiapan tidak diperlukan lagi. Masuk dengan username atau email dan password Anda.',
  },
};

type DesktopDict = typeof id;

const en: DesktopDict = {
  menu: {
    file: 'File',
    openEnv: 'Open .env file (credentials)',
    openData: 'Open data & artifacts folder',
    quit: 'Exit',
    view: 'View',
    reload: 'Reload',
    devTools: 'Developer tools',
    resetZoom: 'Actual size',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fullscreen: 'Full screen',
    window: 'Window',
    mini: 'Mini mode (always on top)',
    minimize: 'Minimize',
    help: 'Help',
    openInBrowser: 'Open SOLAR AI AGENT in the browser',
    openMonitorInBrowser: 'Open the task monitor in the browser',
    setupCode: 'First superadmin setup code…',
  },
  startFailed: 'SOLAR AI AGENT could not start',
  firstRun: {
    title: 'Welcome to SOLAR AI AGENT',
    message: 'Fill in your credentials in the .env file first',
    detail: (envFile: string) =>
      `The configuration file was created at:\n${envFile}\n\n` +
      'Set at least OPENAI_API_KEY. Optional: DATABASE_URL (Neon), S3_* (object storage), GITHUB_TOKEN, PLANE_* and VP_MCP_*. ' +
      'Save the file, then restart SOLAR AI AGENT.\n\n' +
      'You create the first superadmin account right in the SOLAR window; its setup code is filled in for you.',
    openEnv: 'Open .env file',
    later: 'Later',
  },
  setupCode: {
    title: 'Setup code',
    detail: (url: string) =>
      'A one-time code for creating the first superadmin account. The SOLAR window fills it in for you; you only need to ' +
      `type it when you create that account in a browser on this computer (${url}).\n\n` +
      'The code stops working once the first superadmin exists. Do not share it.',
    copy: 'Copy code',
    close: 'Close',
    doneMessage: 'The first superadmin already exists',
    doneDetail: 'The setup code is no longer needed. Sign in with your username or email and password.',
  },
};

export const STRINGS: Record<Lang, DesktopDict> = { id, en };
