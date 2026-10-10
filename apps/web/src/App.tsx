import { useState } from 'react';
import { ConfirmationDialog } from './components/ConfirmationDialog';
import { SettingsDrawer } from './components/SettingsDrawer';
import { TopBar } from './components/TopBar';
import { useLang, useT } from './lib/i18n';
import { applyUpdate, dismissUpdate, usePwa } from './lib/pwa';
import { usePath } from './lib/router';
import { SolarProvider, useSolar } from './lib/store';
import { AgentPage } from './pages/AgentPage';
import { MonitorPage } from './pages/MonitorPage';

function TokenGate() {
  const { submitToken } = useSolar();
  const t = useT();
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
        <h3>{t.app.tokenGate.title}</h3>
        <p className="hint">{t.app.tokenGate.hint}</p>
        <input
          className="input"
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          autoComplete="off"
          aria-label={t.app.tokenGate.tokenLabel}
        />
        <div className="modal-actions">
          <button type="submit" className="btn primary" disabled={!value.trim()}>
            {t.app.tokenGate.submit}
          </button>
        </div>
      </form>
    </div>
  );
}

/** A newer version of the UI was downloaded (installed app / service worker): offer to switch to it. */
function UpdateNotice() {
  const { updateReady } = usePwa();
  const t = useT();
  if (!updateReady) return null;
  return (
    <div className="pwa-update" role="status">
      <span>{t.app.update.available}</span>
      <button type="button" className="btn primary small" onClick={applyUpdate}>
        {t.common.reload}
      </button>
      <button type="button" className="btn ghost small" onClick={dismissUpdate}>
        {t.common.later}
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
  // subscribing at the root re-renders the whole tree on a language switch, so texts read with t() or formatted by
  // lib/format.ts while rendering follow it too (components that hold texts in state or memos use useT())
  useLang();
  return (
    <SolarProvider>
      <Shell />
    </SolarProvider>
  );
}
