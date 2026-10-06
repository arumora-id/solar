import { useState } from 'react';
import { ConfirmationDialog } from './components/ConfirmationDialog';
import { SettingsDrawer } from './components/SettingsDrawer';
import { TopBar } from './components/TopBar';
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
