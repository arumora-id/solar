import { useState } from 'react';
import { ConfirmationDialog } from './components/ConfirmationDialog';
import { SettingsDrawer } from './components/SettingsDrawer';
import { TopBar } from './components/TopBar';
import { applyUpdate, dismissUpdate, usePwa } from './lib/pwa';
import { usePath } from './lib/router';
import { SolarProvider, useSolar } from './lib/store';
import { AgentPage } from './pages/AgentPage';
import { MonitorPage } from './pages/MonitorPage';

function TokenGate() {
  const { submitToken } = useSolar();
  const [value, setValue] = useState('');
  return (
    <div className="backdrop">
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          submitToken(value);
        }}
      >
        <h3>Token akses diperlukan</h3>
        <p className="hint">Server SOLAR ini dilindungi SOLAR_ACCESS_TOKEN. Masukkan token untuk melanjutkan.</p>
        <input className="input" type="password" value={value} onChange={(e) => setValue(e.target.value)} autoFocus autoComplete="off" aria-label="Token akses" />
        <div className="modal-actions">
          <button type="submit" className="btn primary" disabled={!value.trim()}>
            Masuk
          </button>
        </div>
      </form>
    </div>
  );
}

/** A newer version of the UI was downloaded (installed app / service worker): offer to switch to it. */
function UpdateNotice() {
  const { updateReady } = usePwa();
  if (!updateReady) return null;
  return (
    <div className="pwa-update" role="status">
      <span>Versi baru SOLAR AI AGENT tersedia.</span>
      <button type="button" className="btn primary small" onClick={applyUpdate}>
        Muat ulang
      </button>
      <button type="button" className="btn ghost small" onClick={dismissUpdate}>
        Nanti
      </button>
    </div>
  );
}

function Shell() {
  const path = usePath();
  const { authRequired } = useSolar();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const monitorMatch = /^\/monitor(?:\/([A-Za-z0-9_-]+))?\/?$/.exec(path);

  return (
    <div className="app">
      <TopBar path={path} onOpenSettings={() => setSettingsOpen(true)} />
      {monitorMatch ? <MonitorPage selectedId={monitorMatch[1] ?? null} /> : <AgentPage />}
      <ConfirmationDialog />
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <UpdateNotice />
      {authRequired && <TokenGate />}
    </div>
  );
}

export function App() {
  return (
    <SolarProvider>
      <Shell />
    </SolarProvider>
  );
}
