import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, Menu, session, shell, type MenuItemConstructorOptions } from 'electron';
import envTemplate from '../../../.env.example';

interface RunningServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

// user data (settings, .env, tasks, artifacts) in %APPDATA%/SOLAR instead of the package name; the folder keeps the
// pre-rename name so existing settings and data stay where they are
app.setName('SOLAR AI AGENT');
app.setPath('userData', join(app.getPath('appData'), 'SOLAR'));

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const packaged = app.isPackaged;
const resources = packaged ? process.resourcesPath : repoRoot;

const paths = {
  server: packaged ? join(resources, 'server', 'server.mjs') : join(repoRoot, 'apps', 'server', 'dist', 'server.mjs'),
  web: packaged ? join(resources, 'web') : join(repoRoot, 'apps', 'web', 'dist'),
  skills: packaged ? join(resources, 'skills') : join(repoRoot, 'skills'),
  plugins: packaged ? join(resources, 'config', 'plugins.default.json') : join(repoRoot, 'config', 'plugins.default.json'),
  userData: app.getPath('userData'),
};
// Packaged: settings and data live in %APPDATA%\SOLAR. Development: the repository's .env and data/.
const envFile = packaged ? join(paths.userData, '.env') : join(repoRoot, '.env');
const dataDir = packaged ? join(paths.userData, 'data') : join(repoRoot, 'data');

let server: RunningServer | null = null;
let win: BrowserWindow | null = null;
let mini = false;

function prepareEnvironment(): boolean {
  mkdirSync(dataDir, { recursive: true });
  let firstRun = false;
  if (packaged && !existsSync(envFile)) {
    mkdirSync(paths.userData, { recursive: true });
    writeFileSync(envFile, envTemplate.replace(/\r?\n/g, process.platform === 'win32' ? '\r\n' : '\n'));
    firstRun = true;
  }
  process.env.SOLAR_ROOT = resources;
  process.env.SOLAR_ENV_FILE = envFile;
  process.env.DATA_DIR = dataDir;
  process.env.SKILLS_DIR = paths.skills;
  process.env.WEB_DIST_DIR = paths.web;
  process.env.PLUGINS_DEFAULT_FILE = paths.plugins;
  process.env.HOST = '127.0.0.1';
  return firstRun;
}

async function bootServer(): Promise<RunningServer> {
  const mod = (await import(pathToFileURL(paths.server).href)) as {
    startServer(options?: { port?: number }): Promise<RunningServer>;
  };
  try {
    // a stable port keeps the UI preferences (stored per origin) across restarts
    return await mod.startServer();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
    return mod.startServer({ port: 0 });
  }
}

function setMini(on: boolean): void {
  if (!win) return;
  mini = on;
  if (on) {
    win.setAlwaysOnTop(true, 'floating');
    win.setMinimumSize(380, 560);
    win.setSize(420, 720);
  } else {
    win.setAlwaysOnTop(false);
    win.setMinimumSize(900, 620);
    win.setSize(1360, 860);
    win.center();
  }
}

function buildMenu(url: string): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'Buka file .env (kredensial)', click: () => void shell.openPath(envFile) },
        { label: 'Buka folder data & artefak', click: () => void shell.openPath(dataDir) },
        { type: 'separator' },
        { role: 'quit', label: 'Keluar' },
      ],
    },
    {
      label: 'Tampilan',
      submenu: [
        { role: 'reload', label: 'Muat ulang' },
        { role: 'toggleDevTools', label: 'Developer tools' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Ukuran normal' },
        { role: 'zoomIn', label: 'Perbesar' },
        { role: 'zoomOut', label: 'Perkecil' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Layar penuh' },
      ],
    },
    {
      label: 'Jendela',
      submenu: [
        { label: 'Mode mini (selalu di atas)', type: 'checkbox', checked: mini, click: (item) => setMini(item.checked) },
        { role: 'minimize', label: 'Minimalkan' },
      ],
    },
    {
      label: 'Bantuan',
      submenu: [
        { label: 'Buka SOLAR AI AGENT di browser', click: () => void shell.openExternal(url) },
        { label: 'Buka Monitor Task di browser', click: () => void shell.openExternal(`${url}/monitor`) },
        { type: 'separator' },
        { label: `SOLAR AI AGENT ${app.getVersion()}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(url: string): void {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 620,
    title: 'SOLAR AI AGENT',
    backgroundColor: '#f9f9f7',
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  const origin = new URL(url).origin;
  // microphone for voice commands, only for the SOLAR UI itself
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const fromApp = (details.requestingUrl ?? wc.getURL()).startsWith(origin);
    callback(fromApp && (permission === 'media' || permission === 'clipboard-sanitized-write'));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return requestingOrigin.startsWith(origin) && (permission === 'media' || permission === 'clipboard-sanitized-write');
  });

  // external links open in the default browser; the app never opens new Electron windows
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//.test(target)) void shell.openExternal(target);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(origin)) {
      event.preventDefault();
      if (/^https?:\/\//.test(target)) void shell.openExternal(target);
    }
  });

  void win.loadURL(url);
  win.on('closed', () => {
    win = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    const firstRun = prepareEnvironment();
    try {
      server = await bootServer();
    } catch (err) {
      dialog.showErrorBox('SOLAR AI AGENT gagal dijalankan', err instanceof Error ? err.stack ?? err.message : String(err));
      app.quit();
      return;
    }
    buildMenu(server.url);
    createWindow(server.url);
    if (firstRun) {
      const res = await dialog.showMessageBox({
        type: 'info',
        title: 'Selamat datang di SOLAR AI AGENT',
        message: 'Isi kredensial di file .env terlebih dahulu',
        detail:
          `File konfigurasi dibuat di:\n${envFile}\n\n` +
          'Isi minimal OPENAI_API_KEY. Opsional: DATABASE_URL (Neon), S3_* (object storage), GITHUB_TOKEN, PLANE_* dan VP_MCP_*. ' +
          'Simpan file lalu jalankan ulang SOLAR AI AGENT.',
        buttons: ['Buka file .env', 'Nanti'],
        defaultId: 0,
      });
      if (res.response === 0) void shell.openPath(envFile);
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  let closing = false;
  app.on('before-quit', (event) => {
    if (closing || !server) return;
    closing = true;
    event.preventDefault();
    const s = server;
    server = null;
    void s.close().finally(() => app.quit());
  });
}
