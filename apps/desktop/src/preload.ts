// Runs in the sandboxed renderer: expose a tiny, read-only marker so the UI knows it is the desktop app.
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('solarDesktop', {
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
});
