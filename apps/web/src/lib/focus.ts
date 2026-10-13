import { useEffect, type RefObject } from 'react';

/*
 * Keyboard focus for modal dialogs and drawers (aria-modal): Tab and Shift+Tab stay inside the topmost open one, and
 * focus returns to whatever opened it when it closes (if that is still on the page and nothing else took focus).
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** The elements Tab can reach inside `root`, in order (hidden ones left out). */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hidden && el.getClientRects().length > 0);
}

/** Open traps, innermost last: only the last one handles Tab. */
const stack: HTMLElement[] = [];

function onKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Tab' || e.defaultPrevented) return;
  const root = stack[stack.length - 1];
  if (!root) return;
  const items = focusableIn(root);
  if (!items.length) {
    e.preventDefault();
    return;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement;
  const inside = active instanceof HTMLElement && root.contains(active);
  if (e.shiftKey && (!inside || active === first)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (!inside || active === last)) {
    e.preventDefault();
    first.focus();
  }
}

/** Keeps Tab inside `ref` while `active`, and gives focus back to the opener afterwards. */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    stack.push(root);
    if (stack.length === 1) document.addEventListener('keydown', onKeyDown);
    return () => {
      const i = stack.lastIndexOf(root);
      if (i >= 0) stack.splice(i, 1);
      if (!stack.length) document.removeEventListener('keydown', onKeyDown);
      // back to the opener, unless focus already went somewhere on purpose
      const now = document.activeElement;
      const lost = !now || now === document.body || root.contains(now) || !now.isConnected;
      if (lost && opener?.isConnected && !(opener as HTMLButtonElement).disabled) opener.focus({ preventScroll: true });
    };
  }, [ref, active]);
}
