// Offline support: serve the app shell from cache when the network is down.
// Network first, so a new deploy shows up on the next load.
const CACHE = 'cyberrevision-v2';
const SHELL = ['./', 'styles.css', 'app.js', 'logo.svg', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request)
    .then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); }
      return response;
    })
    .catch(() => caches.match(event.request, { ignoreSearch: true }).then(hit => hit || caches.match('./'))));
});
