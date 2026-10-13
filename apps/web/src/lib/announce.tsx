import { useSyncExternalStore } from 'react';

/*
 * One polite live region that stays mounted for the whole page (outside the login screens and the app shell), for
 * moments whose own screen goes away: entering the app after logging in. A live region that mounts together with its
 * text is often not read out, so the text is set after the region exists, and cleared first, so the same words can
 * be announced twice.
 */

let message = '';
let timer: number | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

export function announce(text: string): void {
  window.clearTimeout(timer);
  message = '';
  emit();
  timer = window.setTimeout(() => {
    message = text;
    emit();
  }, 60);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function Announcer() {
  const text = useSyncExternalStore(
    subscribe,
    () => message,
    () => '',
  );
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {text}
    </div>
  );
}
