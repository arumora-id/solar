/*
 * SOLAR AI AGENT service worker. Template: apps/web/pwa/sw.js; the build (apps/web/pwa/plugin.ts) fills in VERSION
 * and PRECACHE and writes dist/sw.js.
 *
 * - The app shell (index, scripts, styles, icons) is cached per build and pages are served from it, so the UI opens
 *   offline (also when a reverse proxy answers 502 for a stopped server) and always matches this worker.
 * - /api is never touched: tasks, the event stream, uploads and downloads always go to the server.
 * - A new build installs next to the old one and waits; the page asks the user before switching (SKIP_WAITING), and
 *   it takes over by itself once every SOLAR window is closed.
 */
const VERSION = '__SOLAR_VERSION__';
const PRECACHE = __SOLAR_PRECACHE__;
const CACHE = `solar-shell-${VERSION}`;
const SHELL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // bypass the HTTP cache so the shell matches this build exactly
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('solar-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  // a page of the app (not a file such as /favicon.svg): this build's shell, so the page and its files always match
  // this worker; the server's page only when the shell is not cached
  if (request.mode === 'navigate' && !/\.[^/]*$/.test(url.pathname)) {
    event.respondWith(
      caches
        .open(CACHE)
        .then((cache) => cache.match(SHELL))
        .then((shell) => shell || fetch(request)),
    );
    return;
  }
  event.respondWith(
    caches
      .open(CACHE)
      .then((cache) => cache.match(request))
      .then((hit) => hit || fetch(request)),
  );
});
