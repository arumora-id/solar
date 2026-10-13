import gsap from 'gsap';
import { useSyncExternalStore, type PointerEvent } from 'react';

/*
 * Motion helpers for GSAP. Every animation of the auth screens, the user menu and the admin panels goes through
 * reducedMotion(): with the operating system's "reduce motion" setting nothing moves (elements are put in their end
 * state at once), only colours may still change.
 */

const QUERY = '(prefers-reduced-motion: reduce)';

function media(): MediaQueryList | null {
  return typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(QUERY) : null;
}

/** The user asked the system for less motion. Read it when animating (it can change while the page is open). */
export function reducedMotion(): boolean {
  return media()?.matches ?? false;
}

function subscribe(listener: () => void): () => void {
  const m = media();
  m?.addEventListener?.('change', listener);
  return () => m?.removeEventListener?.('change', listener);
}

/** reducedMotion() for components: re-renders when the setting changes. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, reducedMotion, () => false);
}

/** A short horizontal shake (wrong password, refused action); nothing under reduced motion. */
export function shake(target: gsap.TweenTarget): void {
  if (!target || reducedMotion()) return;
  gsap.killTweensOf(target, 'x');
  gsap.fromTo(target, { x: 0 }, { keyframes: { x: [0, -9, 8, -6, 5, -2, 0] }, duration: 0.45, ease: 'power1.out', clearProps: 'x' });
}

/** Presses a button down and lets it spring back (pointer down / up). */
export function pressHandlers(): { onPointerDown: (e: PointerEvent<HTMLElement>) => void; onPointerUp: (e: PointerEvent<HTMLElement>) => void; onPointerLeave: (e: PointerEvent<HTMLElement>) => void } {
  const release = (e: PointerEvent<HTMLElement>) => {
    if (reducedMotion()) return;
    gsap.to(e.currentTarget, { scale: 1, duration: 0.35, ease: 'back.out(3)', overwrite: 'auto', clearProps: 'scale' });
  };
  return {
    onPointerDown: (e) => {
      if (reducedMotion() || (e.currentTarget as HTMLButtonElement).disabled) return;
      gsap.to(e.currentTarget, { scale: 0.96, duration: 0.1, ease: 'power2.out', overwrite: 'auto' });
    },
    onPointerUp: release,
    onPointerLeave: release,
  };
}

/** Fades and slides a list's items in, one after the other (new filter, reload). */
export function staggerIn(targets: ArrayLike<Element>, options: { y?: number; stagger?: number } = {}): void {
  const list = Array.from(targets);
  if (!list.length) return;
  if (reducedMotion()) {
    gsap.set(list, { clearProps: 'opacity,transform' });
    return;
  }
  gsap.fromTo(
    list,
    { opacity: 0, y: options.y ?? 8 },
    { opacity: 1, y: 0, duration: 0.32, ease: 'power2.out', stagger: Math.min(options.stagger ?? 0.035, 0.6 / list.length), overwrite: true, clearProps: 'opacity,transform' },
  );
}

/** Collapses an element away (an item leaving a list); resolves when it is gone. */
export function collapseOut(el: HTMLElement | null): Promise<void> {
  if (!el || reducedMotion()) return Promise.resolve();
  return new Promise((resolve) => {
    gsap.to(el, {
      opacity: 0,
      x: 24,
      height: 0,
      paddingTop: 0,
      paddingBottom: 0,
      marginBottom: 0,
      borderWidth: 0,
      duration: 0.32,
      ease: 'power2.in',
      onComplete: () => resolve(),
    });
  });
}

/** Pops a menu / dialog in from slightly smaller and above. */
export function popIn(el: HTMLElement | null, from: { y?: number; scale?: number } = {}): void {
  if (!el) return;
  if (reducedMotion()) {
    gsap.set(el, { clearProps: 'opacity,transform' });
    return;
  }
  gsap.fromTo(el, { opacity: 0, y: from.y ?? -6, scale: from.scale ?? 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.22, ease: 'power2.out', overwrite: true, clearProps: 'opacity,transform' });
}
