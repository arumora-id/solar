import gsap from 'gsap';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Permission } from '@solar/shared';
import type { SettingsRequest } from '../App';
import { useAuth } from '../lib/auth';
import { useFocusTrap } from '../lib/focus';
import { useT } from '../lib/i18n';
import { reducedMotion } from '../lib/motion';
import { CharacterCards } from './CharacterPicker';
import { XIcon } from './Icons';
import { ActivityPanel } from './settings/ActivityPanel';
import { ContentProposalsPanel } from './settings/ContentProposalsPanel';
import { KnowledgePanel } from './settings/KnowledgePanel';
import { ModelsPanel } from './settings/ModelsPanel';
import { PluginsPanel } from './settings/PluginsPanel';
import { SkillsPanel } from './settings/SkillsPanel';
import { SystemPanel } from './settings/SystemPanel';
import { UsersPanel } from './settings/UsersPanel';
import { VoicePanel } from './settings/VoicePanel';

export type SettingsTab = 'character' | 'models' | 'knowledge' | 'skills' | 'proposals' | 'plugins' | 'voice' | 'users' | 'activity' | 'system';

/**
 * The tabs in order, with the permission each needs (the server refuses the rest anyway; a tab the role cannot use
 * is not shown, instead of a screen full of "forbidden"). Settings → Sistem is for everyone (theme, language, the
 * installed app); its server configuration part is the superadmin's.
 */
const TABS: Array<{ id: SettingsTab; needs?: Permission }> = [
  { id: 'character' },
  { id: 'models', needs: 'settings.manage' },
  { id: 'knowledge', needs: 'knowledge.read' },
  { id: 'skills', needs: 'skills.read' },
  { id: 'proposals' },
  { id: 'plugins', needs: 'settings.manage' },
  { id: 'voice' },
  { id: 'users', needs: 'users.view' },
  { id: 'activity', needs: 'activity.view_own' },
  { id: 'system' },
];

export function SettingsDrawer({ request, onClose }: { request: SettingsRequest; onClose: () => void }) {
  const t = useT();
  const { can } = useAuth();
  const tabs = TABS.filter((tab) => !tab.needs || can(tab.needs));
  const [chosen, setChosen] = useState<SettingsTab>('skills');
  const tab = tabs.some((x) => x.id === chosen) ? chosen : (tabs[0]?.id ?? 'character');
  const ref = useRef<HTMLElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const open = request.open;
  // parents pass a new onClose on every render; keep the effect keyed on `open` only
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // a modal drawer: Tab stays in it, and closing it gives the focus back to the button that opened it
  useFocusTrap(ref, open);

  // a request for a tab (pending-approvals badge) picks it on every open
  useEffect(() => {
    if (request.open && request.tab) setChosen(request.tab);
  }, [request.nonce, request.open, request.tab]);

  useEffect(() => {
    if (!open) return;
    // fromTo with explicit end values: a re-run can never freeze the drawer half-transparent
    if (ref.current) {
      if (reducedMotion()) gsap.set(ref.current, { x: 0, opacity: 1 });
      else gsap.fromTo(ref.current, { x: 60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, ease: 'power3.out', overwrite: true });
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // the chosen tab scrolls into view (the tab strip scrolls sideways on phones); the panel fades in
  useEffect(() => {
    if (!open) return;
    tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (bodyRef.current && !reducedMotion()) gsap.fromTo(bodyRef.current, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.22, ease: 'power2.out', clearProps: 'all' });
  }, [tab, open]);

  // arrow keys move between the tabs (WAI-ARIA tabs pattern)
  const onTabKey = (e: ReactKeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const i = tabs.findIndex((x) => x.id === tab);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    setChosen(tabs[next]!.id);
    requestAnimationFrame(() => tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
  };

  if (!open) return null;
  return (
    <>
      <div className="backdrop" style={{ zIndex: 39 }} onClick={onClose} aria-hidden="true" />
      <aside className="drawer" ref={ref} role="dialog" aria-modal="true" aria-label={t.app.settings.title}>
        <div className="drawer-head">
          <h2>{t.app.settings.title}</h2>
          <button type="button" className="btn ghost icon" onClick={onClose} aria-label={t.common.close}>
            <XIcon />
          </button>
        </div>
        <div className="tabs" role="tablist" ref={tabsRef} onKeyDown={onTabKey}>
          {tabs.map(({ id }) => (
            <button
              key={id}
              id={`settings-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls="settings-panel"
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setChosen(id)}
            >
              {t.app.settings.tabs[id]}
            </button>
          ))}
        </div>
        <div className="drawer-body" role="tabpanel" id="settings-panel" aria-labelledby={`settings-tab-${tab}`} ref={bodyRef}>
          {tab === 'character' && (
            <div>
              <p className="muted" style={{ marginTop: 0 }}>
                {t.app.settings.characterIntro}
              </p>
              <CharacterCards />
            </div>
          )}
          {tab === 'models' && <ModelsPanel />}
          {tab === 'knowledge' && <KnowledgePanel />}
          {tab === 'skills' && <SkillsPanel />}
          {tab === 'proposals' && <ContentProposalsPanel />}
          {tab === 'plugins' && <PluginsPanel />}
          {tab === 'voice' && <VoicePanel />}
          {tab === 'users' && <UsersPanel initialFilter={request.usersFilter} key={request.nonce} />}
          {tab === 'activity' && <ActivityPanel />}
          {tab === 'system' && <SystemPanel />}
        </div>
      </aside>
    </>
  );
}
