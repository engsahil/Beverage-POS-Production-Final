// Beverage POS service worker.
// Caches only safe static/application-shell resources.
// - API requests are NEVER cached (business data is always fresh).
// - Navigation requests are network-first; the cache is only an
//   offline fallback and only stores successful (ok) responses.
// - No session data or credentials are ever stored here.
const CACHE = 'beverage-pos-shell-v2';

const SHELL = [
  '/',
  '/login',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // never cache business data

  // Page navigations: network first. Only the static shell paths may be
  // stored, so dynamic pages (POS, sales, admin...) are NEVER served stale.
  if (request.mode === 'navigate') {
    const shellHit = SHELL.includes(url.pathname) || url.pathname === '';
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok && shellHit) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() =>
          shellHit
            ? caches.match(request).then((hit) => hit || caches.match('/'))
            : Promise.reject(new Error('offline'))
        )
    );
    return;
  }

  // Static build assets: cache first, then network. Only content-hashed
  // _next/static files, the manifest and icons are ever cached. RSC
  // payloads (?_rsc=) carry business data and are ALWAYS network.
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname.startsWith('/icon')
  ) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(request, copy));
            }
            return res;
          })
      )
    );
    return;
  }

  // Everything else (RSC payloads, unknown paths): default network handling.
});
