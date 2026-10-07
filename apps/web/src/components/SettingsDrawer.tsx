import gsap from 'gsap';
import { useEffect, useRef, useState } from 'react';
import { CharacterCards } from './CharacterPicker';
import { XIcon } from './Icons';
import { PluginsPanel } from './settings/PluginsPanel';
import { SkillsPanel } from './settings/SkillsPanel';
import { SystemPanel } from './settings/SystemPanel';
import { VoicePanel } from './settings/VoicePanel';

type Tab = 'character' | 'skills' | 'plugins' | 'voice' | 'system';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'character', label: 'Karakter' },
  { id: 'skills', label: 'Skills' },
  { id: 'plugins', label: 'Plugin MCP' },
  { id: 'voice', label: 'Suara' },
  { id: 'system', label: 'Sistem' },
];

export function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
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
      <aside className="drawer" ref={ref} role="dialog" aria-modal="true" aria-label="Pengaturan">
        <div className="drawer-head">
          <h2>Pengaturan</h2>
          <button type="button" className="btn ghost icon" onClick={onClose} aria-label="Tutup">
            <XIcon />
          </button>
        </div>
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="drawer-body" role="tabpanel">
          {tab === 'character' && (
            <div>
              <p className="muted" style={{ marginTop: 0 }}>
                Pilih tampilan SOLAR AI AGENT. Animasinya sama untuk semua karakter: mendengarkan, berpikir, bekerja, berbicara,
                bertanya, senang dan sedih. Pilihan disimpan di perangkat ini.
              </p>
              <CharacterCards />
            </div>
          )}
          {tab === 'skills' && <SkillsPanel />}
          {tab === 'plugins' && <PluginsPanel />}
          {tab === 'voice' && <VoicePanel />}
          {tab === 'system' && <SystemPanel />}
        </div>
      </aside>
    </>
  );
}
