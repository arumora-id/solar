import { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n';
import type { CharacterId } from './characters';
import { CharacterScene, type CharacterState } from './CharacterScene';

interface Props {
  character: CharacterId;
  state: CharacterState;
  onCharacterClick?: () => void;
}

/** React host for the three.js character. Falls back to a static illustration when WebGL is unavailable. */
export function CharacterStage({ character, state, onCharacterClick }: Props) {
  const t = useT();
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CharacterScene | null>(null);
  const clickRef = useRef(onCharacterClick);
  const stateRef = useRef(state);
  const [failed, setFailed] = useState(false);
  clickRef.current = onCharacterClick;
  stateRef.current = state;

  // a new scene per character; it starts in the current state
  useEffect(() => {
    if (!hostRef.current) return;
    try {
      const scene = new CharacterScene(hostRef.current, character);
      scene.onClick = () => clickRef.current?.();
      scene.setState(stateRef.current);
      sceneRef.current = scene;
      setFailed(false);
    } catch (err) {
      console.warn('WebGL not available, using the static character', err);
      setFailed(true);
    }
    return () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [character]);

  useEffect(() => {
    sceneRef.current?.setState(state);
  }, [state]);

  return (
    <div className="character-stage" ref={hostRef} data-state={state} data-character={character}>
      {failed && (
        <button type="button" className="character-fallback" onClick={() => onCharacterClick?.()} aria-label={t.character.fallbackLabel(t.character.characters[character].name)}>
          <img src={`/characters/${character}.svg`} alt="" width={160} height={160} />
        </button>
      )}
    </div>
  );
}
