import gsap from 'gsap';
import { useLayoutEffect, useRef, useState } from 'react';
import { AuthScreen, AuthSplash } from './components/auth/AuthScreen';
import { ConfirmationDialog } from './components/ConfirmationDialog';
import { SettingsDrawer, type SettingsTab } from './components/SettingsDrawer';
import { TopBar } from './components/TopBar';
import { Announcer } from './lib/announce';
import { AuthProvider, useAuth } from './lib/auth';
import { useLang, useT } from './lib/i18n';
import { reducedMotion } from './lib/motion';
import { applyUpdate, dismissUpdate, usePwa } from './lib/pwa';
import { usePath } from './lib/router';
import { SolarProvider } from './lib/store';
import { AgentPage } from './pages/AgentPage';
import { MonitorPage } from './pages/MonitorPage';

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

export interface SettingsRequest {
  open: boolean;
  tab?: SettingsTab;
  /** Opened from the pending-approvals badge: the user list starts on "waiting". */
  usersFilter?: 'pending';
  /** Changes on every open, so the drawer applies `tab` again. */
  nonce: number;
}

function Shell() {
  const path = usePath();
  const { justEntered, markEntered } = useAuth();
  const [settings, setSettings] = useState<SettingsRequest>({ open: false, nonce: 0 });
  const monitorMatch = /^\/monitor(?:\/([A-Za-z0-9_-]+))?\/?$/.exec(path);
  const ref = useRef<HTMLDivElement>(null);

  // coming from the login screen: the app slides in (top bar from above, the page from below)
  useLayoutEffect(() => {
    if (!justEntered) return;
    markEntered();
    if (reducedMotion() || !ref.current) return;
    const ctx = gsap.context(() => {
      gsap
        .timeline({ defaults: { ease: 'power3.out' } })
        .from('.topbar', { y: -24, opacity: 0, duration: 0.5, clearProps: 'all' }, 0)
        .from('.app > main', { y: 22, opacity: 0, duration: 0.6, clearProps: 'all' }, 0.08);
    }, ref);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openSettings = (tab?: SettingsTab, usersFilter?: 'pending') => setSettings((s) => ({ open: true, tab, usersFilter, nonce: s.nonce + 1 }));

  return (
    <div className="app" ref={ref}>
      <TopBar path={path} onOpenSettings={openSettings} />
      {monitorMatch ? <MonitorPage selectedId={monitorMatch[1] ?? null} /> : <AgentPage />}
      <ConfirmationDialog />
      <SettingsDrawer request={settings} onClose={() => setSettings((s) => ({ ...s, open: false }))} />
      <UpdateNotice />
    </div>
  );
}

/** Login screens until someone is logged in; then the app, with its live stream, for that account. */
function Gate() {
  const auth = useAuth();
  if (auth.status === 'loading') return <AuthSplash />;
  if (auth.status !== 'signedIn' || !auth.me) return <AuthScreen />;
  return (
    // a new account (or the same one after logging in again) starts with fresh state: nothing of the previous one stays
    <SolarProvider
      key={auth.user?.id ?? 'token'}
      userId={auth.user?.id ?? null}
      watchUsers={auth.can('users.view')}
      onSignedOut={auth.sessionEnded}
      onAccountsChanged={auth.refreshMe}
    >
      <Shell />
    </SolarProvider>
  );
}

export function App() {
  // subscribing at the root re-renders the whole tree on a language switch, so texts read with t() or formatted by
  // lib/format.ts while rendering follow it too (components that hold texts in state or memos use useT())
  useLang();
  return (
    <AuthProvider>
      <Gate />
      <Announcer />
    </AuthProvider>
  );
}
