/* BNB Analytics — offline cache.
   Stale-while-revalidate: the cached copy answers immediately (so the app
   opens with no network at all), and a background refetch updates the cache
   for next time. That way edits to the app actually arrive on the following
   load instead of being pinned forever by a cache-first strategy.
   Bump CACHE below to force an immediate full refresh. */
var CACHE = 'bnb-analytics-v6';

var ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/css/app.css',
  'assets/icon.svg',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-maskable-512.png',
  'assets/vendor/sql-wasm-binary.js',
  'assets/vendor/sql-wasm.js',
  'assets/vendor/flatpickr.min.js',
  'assets/vendor/flatpickr.min.css',
  'assets/js/util.js',
  'assets/js/datepicker.js',
  'assets/js/store.js',
  'assets/js/db.js',
  'assets/js/csv.js',
  'assets/js/exporter.js',
  'assets/js/charts.js',
  'assets/js/analytics.js',
  'assets/js/views-dashboard.js',
  'assets/js/views-reservations.js',
  'assets/js/views-charges.js',
  'assets/js/views-expenses.js',
  'assets/js/views-import.js',
  'assets/js/views-data.js',
  'assets/js/app.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      // addAll is all-or-nothing; add individually so one miss can't break install
      .then(function (c) {
        return Promise.all(ASSETS.map(function (url) {
          return c.add(new Request(url, { cache: 'reload' })).catch(function () { return null; });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;

  e.respondWith(
    caches.match(req).then(function (hit) {
      var network = fetch(req).then(function (res) {
        // stash successful same-origin GETs for the next run
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });

      if (hit) {
        // serve the cached copy now; let the refetch update it quietly
        e.waitUntil(network.catch(function () { /* offline: keep the cached copy */ }));
        return hit;
      }

      return network.catch(function () {
        // a navigation with no network falls back to the cached shell
        if (req.mode === 'navigate') return caches.match('index.html');
        throw new Error('offline');
      });
    })
  );
});
