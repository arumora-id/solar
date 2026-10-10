import { useState } from 'react';
import { LANGUAGE_NATIVE_NAME, LANGUAGES, setLang, useLang, useT } from '../lib/i18n';
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

/** "ID | EN": switches the interface language at once; each option is named in its own language. */
export function LanguageSwitch({ className = 'lang-switch' }: { className?: string }) {
  const t = useT();
  const lang = useLang();
  return (
    <div className={className} role="group" aria-label={t.app.language.label}>
      {LANGUAGES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={lang === l}
          aria-label={LANGUAGE_NATIVE_NAME[l]}
          title={LANGUAGE_NATIVE_NAME[l]}
          onClick={() => setLang(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export function TopBar({ path, onOpenSettings }: { path: string; onOpenSettings: () => void }) {
  const { connected, confirmations } = useSolar();
  const t = useT();
  const [dark, setDark] = useState(isDark);
  const { canInstall } = usePwa();
  const link = (to: string, label: string, active: boolean, ariaLabel?: string) => (
    <a
      href={to}
      aria-current={active ? 'page' : undefined}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {label}
    </a>
  );
  const waiting = confirmations.length;

  return (
    <header className="topbar">
      <div className="brand">
        <img src="/favicon.svg" alt="" width={28} height={28} />
        SOLAR AI AGENT <small>{t.app.topbar.tagline}</small>
      </div>
      <nav className="nav" aria-label={t.app.topbar.navLabel}>
        {link('/', t.app.topbar.agent, path === '/')}
        {link(
          '/monitor',
          waiting ? t.app.topbar.monitorWaiting(waiting) : t.app.topbar.monitor,
          path.startsWith('/monitor'),
          waiting ? t.app.topbar.monitorWaitingLabel(waiting) : undefined,
        )}
      </nav>
      <div className="spacer" />
      <span className={`conn${connected ? ' on' : ''}`} role="status">
        <i aria-hidden="true" />
        <span>{connected ? t.app.topbar.connected : t.app.topbar.disconnected}</span>
      </span>
      {canInstall && (
        <button
          type="button"
          className="btn small install"
          onClick={() => void installApp()}
          title={t.app.topbar.installTitle}
          aria-label={t.app.topbar.install}
        >
          <InstallIcon size={16} /> <span className="label-wide">{t.app.topbar.install}</span>
        </button>
      )}
      <LanguageSwitch />
      <button
        type="button"
        className="btn ghost icon"
        aria-label={dark ? t.app.topbar.lightTheme : t.app.topbar.darkTheme}
        title={dark ? t.app.topbar.lightTheme : t.app.topbar.darkTheme}
        onClick={() => {
          applyTheme(dark ? 'light' : 'dark');
          setDark(!dark);
        }}
      >
        {dark ? <SunIcon /> : <MoonIcon />}
      </button>
      <button type="button" className="btn small" onClick={onOpenSettings} aria-label={t.app.topbar.settings}>
        <GearIcon size={16} /> <span className="label-wide">{t.app.topbar.settings}</span>
      </button>
    </header>
  );
}
