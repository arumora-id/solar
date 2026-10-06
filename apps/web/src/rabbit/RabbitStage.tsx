import { useEffect, useRef, useState } from 'react';
import { RabbitScene, type RabbitState } from './RabbitScene';

interface Props {
  state: RabbitState;
  onRabbitClick?: () => void;
}

/** React host for the three.js rabbit. Falls back to a static illustration when WebGL is unavailable. */
export function RabbitStage({ state, onRabbitClick }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<RabbitScene | null>(null);
  const clickRef = useRef(onRabbitClick);
  const [failed, setFailed] = useState(false);
  clickRef.current = onRabbitClick;

  useEffect(() => {
    if (!hostRef.current) return;
    try {
      const scene = new RabbitScene(hostRef.current);
      scene.onClick = () => clickRef.current?.();
      sceneRef.current = scene;
    } catch (err) {
      console.warn('WebGL not available, using the static rabbit', err);
      setFailed(true);
    }
    return () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setState(state);
  }, [state]);

  return (
    <div className="rabbit-stage" ref={hostRef} data-state={state}>
      {failed && (
        <button type="button" className="rabbit-fallback" onClick={() => onRabbitClick?.()} aria-label="SOLAR">
          <img src="/favicon.svg" alt="" width={160} height={160} />
        </button>
      )}
    </div>
  );
}
