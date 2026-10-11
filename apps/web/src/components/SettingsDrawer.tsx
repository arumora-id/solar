import gsap from 'gsap';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n';
import { CharacterCards } from './CharacterPicker';
import { XIcon } from './Icons';
import { KnowledgePanel } from './settings/KnowledgePanel';
import { ModelsPanel } from './settings/ModelsPanel';
import { PluginsPanel } from './settings/PluginsPanel';
import { SkillsPanel } from './settings/SkillsPanel';
import { SystemPanel } from './settings/SystemPanel';
import { VoicePanel } from './settings/VoicePanel';

type Tab = 'character' | 'models' | 'knowledge' | 'skills' | 'plugins' | 'voice' | 'system';

const TABS: Tab[] = ['character', 'models', 'knowledge', 'skills', 'plugins', 'voice', 'system'];

export function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('skills');
  const ref = useRef<HTMLElement>(null);
  // parents pass a new onClose on every render; keep the effect keyed on `open` only
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    // fromTo with explicit end values: a re-run can never freeze the drawer half-transparent
    if (ref.current) gsap.fromTo(ref.current, { x: 60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, ease: 'power3.out', overwrite: true });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

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
        <div className="tabs" role="tablist">
          {TABS.map((id) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {t.app.settings.tabs[id]}
            </button>
          ))}
        </div>
        <div className="drawer-body" role="tabpanel">
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
          {tab === 'plugins' && <PluginsPanel />}
          {tab === 'voice' && <VoicePanel />}
          {tab === 'system' && <SystemPanel />}
        </div>
      </aside>
    </>
  );
}
