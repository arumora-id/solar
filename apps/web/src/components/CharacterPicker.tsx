import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CHARACTER_EVENT, CHARACTERS, characterInfo, readCharacter, saveCharacter, type CharacterId } from '../character/characters';

/** The chosen character, kept in sync across the stage switcher and the settings panel. */
export function useCharacter(): CharacterId {
  const [id, setId] = useState<CharacterId>(readCharacter);
  useEffect(() => {
    const sync = () => setId(readCharacter());
    window.addEventListener(CHARACTER_EVENT, sync);
    // another window/tab of SOLAR AI AGENT changed it
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CHARACTER_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return id;
}

const thumb = (id: CharacterId) => `/characters/${id}.svg`;

/** Index after a navigation key (wrapping), or null for other keys. */
function moveIndex(key: string, index: number, count: number, vertical: boolean, horizontal: boolean): number | null {
  if ((vertical && key === 'ArrowDown') || (horizontal && key === 'ArrowRight')) return (index + 1) % count;
  if ((vertical && key === 'ArrowUp') || (horizontal && key === 'ArrowLeft')) return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/** Large cards for the settings drawer: a radio group (one tab stop, arrow keys move the selection). */
export function CharacterCards() {
  const current = useCharacter();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (e: KeyboardEvent, index: number) => {
    const next = moveIndex(e.key, index, CHARACTERS.length, true, true);
    if (next === null) return;
    e.preventDefault();
    saveCharacter(CHARACTERS[next]!.id);
    refs.current[next]?.focus();
  };
  return (
    <div className="character-cards" role="radiogroup" aria-label="Karakter">
      {CHARACTERS.map((c, i) => (
        <button
          key={c.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={current === c.id}
          tabIndex={current === c.id ? 0 : -1}
          className="character-card"
          onClick={() => saveCharacter(c.id)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          <img src={thumb(c.id)} alt="" width={72} height={72} />
          <span>
            <strong>{c.name}</strong>
            <small>{c.description}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Compact switcher on the stage: the current character, opening a small menu of all characters. */
export function CharacterSwitcher() {
  const current = useCharacter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  const onMenuKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
      return;
    }
    if (e.key === 'Tab') {
      close(false);
      return;
    }
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    const next = moveIndex(e.key, Math.max(0, items.indexOf(document.activeElement as HTMLElement)), items.length, true, false);
    if (next === null) return;
    e.preventDefault();
    items[next]?.focus();
  };

  return (
    <div className="character-switch" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        className="chip"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        title="Ganti karakter"
      >
        <img src={thumb(current)} alt="" width={20} height={20} />
        {characterInfo(current).name}
      </button>
      {open && (
        <div className="character-menu" role="menu" aria-label="Pilih karakter" ref={menuRef} onKeyDown={onMenuKeyDown}>
          {CHARACTERS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="menuitemradio"
              aria-checked={current === c.id}
              tabIndex={-1}
              onClick={() => {
                saveCharacter(c.id);
                close(true);
              }}
            >
              <img src={thumb(c.id)} alt="" width={30} height={30} />
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
