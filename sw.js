// NexTrade Service Worker — PWA offline support
var CACHE = 'nextrade-v4';
var STATIC = [
  '/',
  '/index.html',
  '/main.js',
  '/drawing.js',
  '/features.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;600;700;800;900&display=swap',
  'https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js'
];

// Install: cache static assets
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(STATIC.map(function(url) {
        return new Request(url, { mode: 'no-cors' });
      }));
    }).catch(function() {}) // don't fail install if some CDN assets miss
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// Fetch: network-first for API calls, cache-first for static
self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // Always go network for API / external data
  if (url.indexOf('yahoo.com') !== -1 ||
      url.indexOf('twelvedata.com') !== -1 ||
      url.indexOf('jina.ai') !== -1) {
    e.respondWith(
      fetch(e.request).catch(function() {
        return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
      })
    );
    return;
  }

  // Cache-first for everything else (app shell)
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      return cached || fetch(e.request).then(function(resp) {
        if (resp && resp.status === 200 && e.request.method === 'GET') {
          var clone = resp.clone();
          caches.open(CACHE).then(function(cache) { cache.put(e.request, clone); });
        }
        return resp;
      });
    }).catch(function() {
      // Offline fallback for navigation
      if (e.request.mode === 'navigate') {
        return caches.match('/index.html');
      }
    })
  );
});
