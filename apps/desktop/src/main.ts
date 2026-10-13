import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
} from 'electron';
import envTemplate from '../../../.env.example';
import { isLang, langFromLocale, readStoredLang, STRINGS, storeLang, type Lang } from './i18n';

interface RunningServer {
  url: string;
  port: number;
  /**
   * The one-time first-superadmin setup code while no user account exists, else null (apps/server/src/server.ts).
   * Optional: a server bundle from before user accounts has none.
   */
  setupCode?(): string | null;
  close(): Promise<void>;
}

/** IPC channels of the preload bridge (preload.ts). */
const IPC_SET_LANGUAGE = 'solar:set-language';
const IPC_GET_SETUP_CODE = 'solar:get-setup-code';

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
/** Interface language chosen in the SOLAR UI (menu and dialogs follow it). */
const languageFile = join(paths.userData, 'language.json');

let server: RunningServer | null = null;
let win: BrowserWindow | null = null;
let mini = false;
/** Set once the app is ready (app.getLocale() needs it). */
let lang: Lang = 'id';
/** Whether the menu currently offers the setup code (rebuilt when that changes, see syncSetupMenu). */
let menuOffersSetupCode = false;
let setupWatch: NodeJS.Timeout | null = null;

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
  const m = STRINGS[lang].menu;
  menuOffersSetupCode = currentSetupCode() !== null;
  const template: MenuItemConstructorOptions[] = [
    {
      label: m.file,
      submenu: [
        { label: m.openEnv, click: () => void shell.openPath(envFile) },
        { label: m.openData, click: () => void shell.openPath(dataDir) },
        { type: 'separator' },
        { role: 'quit', label: m.quit },
      ],
    },
    {
      label: m.view,
      submenu: [
        { role: 'reload', label: m.reload },
        { role: 'toggleDevTools', label: m.devTools },
        { type: 'separator' },
        { role: 'resetZoom', label: m.resetZoom },
        { role: 'zoomIn', label: m.zoomIn },
        { role: 'zoomOut', label: m.zoomOut },
        { type: 'separator' },
        { role: 'togglefullscreen', label: m.fullscreen },
      ],
    },
    {
      label: m.window,
      submenu: [
        { label: m.mini, type: 'checkbox', checked: mini, click: (item) => setMini(item.checked) },
        { role: 'minimize', label: m.minimize },
      ],
    },
    {
      label: m.help,
      submenu: [
        { label: m.openInBrowser, click: () => void shell.openExternal(url) },
        { label: m.openMonitorInBrowser, click: () => void shell.openExternal(`${url}/monitor`) },
        // only while no account exists: for creating the first superadmin in a browser on this computer
        { label: m.setupCode, visible: menuOffersSetupCode, click: () => void showSetupCode(url) },
        { type: 'separator' },
        { label: `SOLAR AI AGENT ${app.getVersion()}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * True only for a message from the SOLAR UI itself: the top frame of the SOLAR window, showing a page of the local
 * server (URL and security origin), and not one of the server's API responses (artifact files and downloads live under
 * /api/ and are served with a sandbox CSP, i.e. an opaque origin). Never a page the window navigated to, an iframe, or
 * any other window.
 */
function fromSolarUi(event: IpcMainEvent | IpcMainInvokeEvent, origin: string): boolean {
  const frame = event.senderFrame;
  if (!win || win.isDestroyed() || event.sender !== win.webContents) return false;
  if (!frame || frame.detached || frame.parent !== null || frame.origin !== origin) return false;
  try {
    const at = new URL(frame.url);
    return at.origin === origin && !at.pathname.toLowerCase().startsWith('/api/');
  } catch {
    return false;
  }
}

/** The SOLAR UI reports its language (preload: solarDesktop.setLanguage): remember it and rebuild the menu. */
function listenForLanguage(url: string): void {
  const origin = new URL(url).origin;
  ipcMain.on(IPC_SET_LANGUAGE, (event, value: unknown) => {
    // only the SOLAR UI itself, never a page it navigated to
    if (!fromSolarUi(event, origin) || !isLang(value) || value === lang) return;
    lang = value;
    storeLang(languageFile, value);
    buildMenu(url);
  });
}

// ---- first superadmin --------------------------------------------------------------------------------------------

/**
 * The server's one-time setup code while no account exists, else null. Read live from the running server every time
 * and never kept here: the server forgets it (and deletes DATA_DIR/setup-code.txt) once the first superadmin exists.
 */
function currentSetupCode(): string | null {
  try {
    const code = server?.setupCode?.();
    return typeof code === 'string' && code.length > 0 ? code : null;
  } catch {
    return null;
  }
}

/**
 * The SOLAR UI asks for the setup code to prefill the first-superadmin form (preload: solarDesktop.getSetupCode).
 * Answered only for the SOLAR UI in this window (fromSolarUi); everyone else, and everyone once an account exists,
 * gets null.
 */
function serveSetupCode(url: string): void {
  const origin = new URL(url).origin;
  ipcMain.handle(IPC_GET_SETUP_CODE, (event): string | null => {
    const code = fromSolarUi(event, origin) ? currentSetupCode() : null;
    syncSetupMenu(url);
    return code;
  });
}

/** Rebuilds the menu when the setup code appeared or went away; while it exists, keeps checking (it goes with setup). */
function syncSetupMenu(url: string): void {
  const pending = currentSetupCode() !== null;
  if (pending !== menuOffersSetupCode) buildMenu(url);
  if (pending && !setupWatch) {
    setupWatch = setInterval(() => syncSetupMenu(url), 2_000);
    setupWatch.unref();
  } else if (!pending && setupWatch) {
    clearInterval(setupWatch);
    setupWatch = null;
  }
}

function messageBox(options: MessageBoxOptions): Promise<MessageBoxReturnValue> {
  return win && !win.isDestroyed() ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
}

/** Help -> setup code: for creating the first superadmin in a browser on this computer (the window fills it itself). */
async function showSetupCode(url: string): Promise<void> {
  const s = STRINGS[lang].setupCode;
  const code = currentSetupCode();
  if (!code) {
    syncSetupMenu(url);
    await messageBox({ type: 'info', title: s.title, message: s.doneMessage, detail: s.doneDetail, buttons: [s.close] });
    return;
  }
  const res = await messageBox({
    type: 'info',
    title: s.title,
    message: code,
    detail: s.detail(url),
    buttons: [s.copy, s.close],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  // still the same code (not used up while the dialog was open)
  if (res.response === 0 && currentSetupCode() === code) clipboard.writeText(code);
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
    lang = readStoredLang(languageFile) ?? langFromLocale(app.getLocale());
    const firstRun = prepareEnvironment();
    try {
      server = await bootServer();
    } catch (err) {
      dialog.showErrorBox(STRINGS[lang].startFailed, err instanceof Error ? err.stack ?? err.message : String(err));
      app.quit();
      return;
    }
    buildMenu(server.url);
    listenForLanguage(server.url);
    serveSetupCode(server.url);
    syncSetupMenu(server.url);
    createWindow(server.url);
    if (firstRun) {
      const s = STRINGS[lang].firstRun;
      const res = await dialog.showMessageBox({
        type: 'info',
        title: s.title,
        message: s.message,
        detail: s.detail(envFile),
        buttons: [s.openEnv, s.later],
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
    if (setupWatch) clearInterval(setupWatch);
    setupWatch = null;
    void s.close().finally(() => app.quit());
  });
}
