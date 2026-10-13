import gsap from 'gsap';
import { useEffect, useRef } from 'react';
import { useAuth } from '../lib/auth';
import { LANGUAGE_NATIVE_NAME, LANGUAGES, setLang, useLang, useT } from '../lib/i18n';
import { reducedMotion } from '../lib/motion';
import { navigate } from '../lib/router';
import { installApp, usePwa } from '../lib/pwa';
import { useSolar } from '../lib/store';
import { GearIcon, InstallIcon, UserPlusIcon } from './Icons';
import type { SettingsTab } from './SettingsDrawer';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

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

/** Approvers see how many registrations wait; a click opens Settings → Users on "waiting". */
function PendingBadge({ onOpen }: { onOpen: () => void }) {
  const { pendingCount } = useSolar();
  const t = useT();
  const ref = useRef<HTMLButtonElement>(null);
  const last = useRef(pendingCount);
  // a new registration arriving: the badge bounces once
  useEffect(() => {
    if (pendingCount > last.current && ref.current && !reducedMotion()) {
      gsap.fromTo(ref.current, { scale: 0.7 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1.1, 0.45)', clearProps: 'scale' });
    }
    last.current = pendingCount;
  }, [pendingCount]);
  if (pendingCount <= 0) return null;
  return (
    <button ref={ref} type="button" className="btn small pending-badge" onClick={onOpen} aria-label={t.auth.pendingBadge.label(pendingCount)} title={t.auth.pendingBadge.title}>
      <UserPlusIcon size={16} />
      <span className="count">{pendingCount}</span>
    </button>
  );
}

export function TopBar({ path, onOpenSettings }: { path: string; onOpenSettings: (tab?: SettingsTab, usersFilter?: 'pending') => void }) {
  const { connected, confirmations } = useSolar();
  const { can } = useAuth();
  const t = useT();
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
        <span className="brand-name">SOLAR AI AGENT</span> <small>{t.app.topbar.tagline}</small>
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
      <ThemeToggle />
      {can('users.approve') && <PendingBadge onOpen={() => onOpenSettings('users', 'pending')} />}
      <button type="button" className="btn small" onClick={() => onOpenSettings()} aria-label={t.app.topbar.settings}>
        <GearIcon size={16} /> <span className="label-wide">{t.app.topbar.settings}</span>
      </button>
      <UserMenu />
    </header>
  );
}
