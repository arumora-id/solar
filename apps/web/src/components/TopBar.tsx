import { useState } from 'react';
import { navigate } from '../lib/router';
import { useSolar } from '../lib/store';
import { GearIcon, MoonIcon, SunIcon } from './Icons';
import { applyTheme, currentTheme } from './settings/SystemPanel';

function isDark(): boolean {
  const t = currentTheme();
  if (t !== 'system') return t === 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function TopBar({ path, onOpenSettings }: { path: string; onOpenSettings: () => void }) {
  const { connected, confirmations } = useSolar();
  const [dark, setDark] = useState(isDark);
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
        SOLAR <small>Solution Architect Rabbit</small>
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
      <button type="button" className="btn small" onClick={onOpenSettings}>
        <GearIcon size={16} /> Pengaturan
      </button>
    </header>
  );
}
