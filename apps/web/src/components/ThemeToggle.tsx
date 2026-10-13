import { useEffect, useState } from 'react';
import { useT } from '../lib/i18n';
import { MoonIcon, SunIcon } from './Icons';
import { applyTheme, currentTheme } from './settings/SystemPanel';

function isDark(): boolean {
  const t = currentTheme();
  if (t !== 'system') return t === 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/** Light / dark switch (top bar and login screens); "follow the system" is in Settings → Sistem. */
export function ThemeToggle({ className = 'btn ghost icon' }: { className?: string }) {
  const t = useT();
  const [dark, setDark] = useState(isDark);
  // the system theme can change while the page is open (and Settings → Sistem can switch it)
  useEffect(() => {
    const m = window.matchMedia?.('(prefers-color-scheme: dark)');
    const sync = () => setDark(isDark());
    m?.addEventListener?.('change', sync);
    window.addEventListener('solar:theme', sync);
    return () => {
      m?.removeEventListener?.('change', sync);
      window.removeEventListener('solar:theme', sync);
    };
  }, []);
  const label = dark ? t.app.topbar.lightTheme : t.app.topbar.darkTheme;
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      title={label}
      onClick={() => {
        applyTheme(dark ? 'light' : 'dark');
        setDark(!dark);
      }}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
