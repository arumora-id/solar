import { useEffect, useRef, useState } from 'react';
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

/** Large cards for the settings drawer. */
export function CharacterCards() {
  const current = useCharacter();
  return (
    <div className="character-cards" role="radiogroup" aria-label="Karakter">
      {CHARACTERS.map((c) => (
        <button key={c.id} type="button" role="radio" aria-checked={current === c.id} className="character-card" onClick={() => saveCharacter(c.id)}>
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

/** Compact switcher on the stage: the current character, opening a small menu of the others. */
export function CharacterSwitcher() {
  const current = useCharacter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="character-switch" ref={ref}>
      {open && (
        <div className="character-menu" role="menu" aria-label="Pilih karakter">
          {CHARACTERS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="menuitemradio"
              aria-checked={current === c.id}
              onClick={() => {
                saveCharacter(c.id);
                setOpen(false);
              }}
            >
              <img src={thumb(c.id)} alt="" width={30} height={30} />
              {c.name}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="chip" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Ganti karakter">
        <img src={thumb(current)} alt="" width={20} height={20} />
        {characterInfo(current).name}
      </button>
    </div>
  );
}
