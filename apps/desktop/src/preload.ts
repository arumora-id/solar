// Runs in the sandboxed renderer: expose a tiny marker so the UI knows it is the desktop app, and one call through
// which the UI reports its interface language (the menu and dialogs follow it).
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('solarDesktop', {
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
  setLanguage: (lang: string) => {
    if (lang === 'id' || lang === 'en') ipcRenderer.send('solar:set-language', lang);
  },
});
