// Runs in the sandboxed renderer of the SOLAR window: exposes `window.solarDesktop`, a tiny bridge to the desktop shell.
// The main process answers only the SOLAR UI itself (main.ts, fromSolarUi): the window's top frame on the local
// server's origin, never a page it navigated to, an iframe or an API response.
import { contextBridge, ipcRenderer } from 'electron';

/** IPC channels, kept in sync with main.ts. */
const IPC_SET_LANGUAGE = 'solar:set-language';
const IPC_GET_SETUP_CODE = 'solar:get-setup-code';

/**
 * `window.solarDesktop` - present only in the desktop app (the web UI checks for it with optional chaining, e.g.
 * `window.solarDesktop?.getSetupCode?.()`, so it keeps working in a browser and with an older desktop shell).
 */
export interface SolarDesktopApi {
  /** `process.platform` of the desktop app (`win32`, `darwin`, `linux`). */
  platform: string;
  versions: { electron: string; chrome: string };
  /** Tells the desktop shell the interface language; its menu and dialogs follow it. Other values are ignored. */
  setLanguage(lang: 'id' | 'en'): void;
  /**
   * The one-time setup code for creating the first superadmin (`POST /api/auth/setup`, field `setupCode`), so the
   * setup form can prefill it.
   *
   * Resolves to the code (`XXXX-XXXX-XXXX-XXXX`) while no user account exists, and to `null` otherwise: once any
   * account exists, outside the SOLAR UI page, or when the desktop shell cannot tell. Never rejects. The code is read
   * from the in-process server at every call (never cached by the shell), so after the first superadmin is created it
   * resolves to `null`. Callers ask again whenever they need it and keep it only in memory (never in storage, the URL
   * or logs); the user may still edit the prefilled value.
   */
  getSetupCode(): Promise<string | null>;
}

const api: SolarDesktopApi = {
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
  setLanguage: (lang) => {
    if (lang === 'id' || lang === 'en') ipcRenderer.send(IPC_SET_LANGUAGE, lang);
  },
  getSetupCode: async () => {
    try {
      const code: unknown = await ipcRenderer.invoke(IPC_GET_SETUP_CODE);
      return typeof code === 'string' && code.length > 0 && code.length <= 64 ? code : null;
    } catch {
      return null;
    }
  },
};

contextBridge.exposeInMainWorld('solarDesktop', api);
