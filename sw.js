/* GeoMaster service worker — offline support.
   Bump CACHE (and the asset ?v= in index.html) on every deploy so clients refresh. */
const CACHE = 'geomaster-v10';
const CORE = [
  './', './index.html',
  './styles.css?v=10', './app.js?v=10', './extra.js?v=9', './world.geojson?v=4',
  './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
];
const RUNTIME = /flagcdn\.com|fonts\.gstatic\.com|fonts\.googleapis\.com/;

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(CORE.map(u => c.add(u)))));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Navigations: network-first so a new deploy is picked up, fall back to cached shell offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(r => { caches.open(CACHE).then(c => c.put(req, r.clone())); return r; })
        .catch(() => caches.match(req).then(m => m || caches.match('./index.html') || caches.match('./')))
    );
    return;
  }

  // Everything else (versioned assets, flags, fonts): cache-first, populate on miss.
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(r => {
      if (r && r.ok && (url.origin === self.location.origin || RUNTIME.test(url.host))) {
        const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy));
      }
      return r;
    }).catch(() => hit))
  );
});
