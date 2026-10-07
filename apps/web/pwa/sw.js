/*
 * SOLAR AI AGENT service worker. Template: apps/web/pwa/sw.js; the build (apps/web/pwa/plugin.ts) fills in VERSION
 * and PRECACHE and writes dist/sw.js.
 *
 * - The app shell (index, scripts, styles, icons) is cached per build, so the UI opens offline and loads fast.
 * - /api is never touched: tasks, the event stream, uploads and downloads always go to the server.
 * - A new build installs next to the old one and waits; the page asks the user before switching (SKIP_WAITING).
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

  if (request.mode === 'navigate') {
    // the server's page first (it may be newer); the cached shell when the server cannot be reached
    event.respondWith(
      fetch(request).catch(() => caches.open(CACHE).then((cache) => cache.match(SHELL)).then((shell) => shell || Response.error())),
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
