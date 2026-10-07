import { useSyncExternalStore } from 'react';

/**
 * Progressive Web App support: the service worker (offline app shell, see apps/web/pwa/sw.js), the browser's install
 * prompt and the "new version" prompt. The desktop app (Electron) loads the UI from its own server and updates with the
 * installer, so it registers no service worker.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PwaState {
  /** The browser offered to install the app (Chrome, Edge, Android); install() shows its dialog. */
  canInstall: boolean;
  /** Running as an installed app (own window, no browser tabs). */
  standalone: boolean;
  /** A newer version of the UI is downloaded and waits for applyUpdate(). */
  updateReady: boolean;
  /** iPhone/iPad Safari: installing works through Share → Add to Home Screen only. */
  iosManualInstall: boolean;
}

export const isElectron = typeof navigator !== 'undefined' && /\bElectron\//.test(navigator.userAgent);

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone);
}

function detectIosManualInstall(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && !detectStandalone();
}

let state: PwaState = { canInstall: false, standalone: detectStandalone(), updateReady: false, iosManualInstall: detectIosManualInstall() };
const listeners = new Set<() => void>();
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let waitingWorker: ServiceWorker | null = null;

function set(patch: Partial<PwaState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function usePwa(): PwaState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

/** Shows the browser's install dialog; resolves to true when the user installed the app. */
export async function installApp(): Promise<boolean> {
  const prompt = deferredPrompt;
  if (!prompt) return false;
  deferredPrompt = null;
  set({ canInstall: false });
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  return outcome === 'accepted';
}

/** Switches to the waiting version and reloads once it controls the page. */
export function applyUpdate(): void {
  if (!waitingWorker) return;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
}

export function dismissUpdate(): void {
  set({ updateReady: false });
}

function trackWaiting(reg: ServiceWorkerRegistration): void {
  const offer = (worker: ServiceWorker | null) => {
    // the first install has no previous version to replace: nothing to offer
    if (!worker || !navigator.serviceWorker.controller) return;
    waitingWorker = worker;
    set({ updateReady: true });
  };
  if (reg.waiting) offer(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed') offer(worker);
    });
  });
}

const UPDATE_CHECK_MS = 60 * 60 * 1000;

/** Registers the service worker and the install/update listeners (production builds in a browser only). */
export function setupPwa(): void {
  if (typeof window === 'undefined' || isElectron) return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    set({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    set({ canInstall: false, iosManualInstall: false });
  });
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', () => set({ standalone: detectStandalone() }));

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const register = () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        trackWaiting(reg);
        // an app left open for days still learns about new versions
        let lastCheck = Date.now();
        const check = () => {
          if (document.visibilityState !== 'visible' || Date.now() - lastCheck < UPDATE_CHECK_MS) return;
          lastCheck = Date.now();
          reg.update().catch(() => {});
        };
        document.addEventListener('visibilitychange', check);
        window.setInterval(check, UPDATE_CHECK_MS);
      })
      .catch(() => {
        // not a secure context (plain http on another host) or the server has no sw.js: the app works without it
      });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

/** Keeps the browser/app title bar in the colour of the top bar, also when the theme is switched in SOLAR. */
export function syncThemeColor(): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) return;
  const surface = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
  if (surface) meta.content = surface;
}
