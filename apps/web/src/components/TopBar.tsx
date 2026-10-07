import { useState } from 'react';
import { navigate } from '../lib/router';
import { installApp, usePwa } from '../lib/pwa';
import { useSolar } from '../lib/store';
import { GearIcon, InstallIcon, MoonIcon, SunIcon } from './Icons';
import { applyTheme, currentTheme } from './settings/SystemPanel';

function isDark(): boolean {
  const t = currentTheme();
  if (t !== 'system') return t === 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function TopBar({ path, onOpenSettings }: { path: string; onOpenSettings: () => void }) {
  const { connected, confirmations } = useSolar();
  const [dark, setDark] = useState(isDark);
  const { canInstall } = usePwa();
  const link = (to: string, label: string, active: boolean) => (
    <a
      href={to}
      aria-current={active ? 'page' : undefined}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {label}
    </a>
  );

  return (
    <header className="topbar">
      <div className="brand">
        <img src="/favicon.svg" alt="" width={28} height={28} />
        SOLAR AI AGENT <small>Solution Architect</small>
      </div>
      <nav className="nav" aria-label="Navigasi utama">
        {link('/', 'Agent', path === '/')}
        {link('/monitor', `Monitor${confirmations.length ? ` (${confirmations.length})` : ''}`, path.startsWith('/monitor'))}
      </nav>
      <div className="spacer" />
      <span className={`conn${connected ? ' on' : ''}`} role="status">
        <i aria-hidden="true" />
        <span>{connected ? 'Terhubung' : 'Terputus'}</span>
      </span>
      {canInstall && (
        <button type="button" className="btn small" onClick={() => void installApp()} title="Pasang SOLAR AI AGENT sebagai aplikasi">
          <InstallIcon size={16} /> <span className="label-wide">Pasang aplikasi</span>
        </button>
      )}
      <button
        type="button"
        className="btn ghost icon"
        aria-label={dark ? 'Tema terang' : 'Tema gelap'}
        onClick={() => {
          applyTheme(dark ? 'light' : 'dark');
          setDark(!dark);
        }}
      >
        {dark ? <SunIcon /> : <MoonIcon />}
      </button>
      <button type="button" className="btn small" onClick={onOpenSettings} aria-label="Pengaturan">
        <GearIcon size={16} /> <span className="label-wide">Pengaturan</span>
      </button>
    </header>
  );
}
