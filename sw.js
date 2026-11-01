/* Offline cache. Bump VERSION whenever a cached file changes. Map tiles are never cached. */
const VERSION = 'photo-toolbox-v7';
const FILES = [
  './', 'index.html', 'manifest.json', 'assets/icon.svg',
  'css/style.css', 'vendor/fonts/fraunces.woff2', 'vendor/fonts/figtree.woff2',
  'js/core.js', 'js/exposure.js', 'js/analysis.js', 'js/jpeg.js', 'js/lab.js', 'js/fixer-core.js', 'js/logo-fit.js', 'js/wm-form.js',
  'js/metadata.js', 'js/whatif.js', 'js/watermark.js', 'js/tools.js', 'js/lab-ui.js', 'js/fixer.js',
  'vendor/exifr.full.umd.js', 'vendor/jszip.min.js', 'vendor/piexif.js', 'vendor/leaflet.js', 'vendor/leaflet.css',
  'vendor/images/marker-icon.png', 'vendor/images/marker-icon-2x.png', 'vendor/images/marker-shadow.png', 'vendor/images/layers.png',
];

self.addEventListener('install', e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));

// Same-origin files: network first (so edits show up), cache as the offline fallback.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(res => {
    const copy = res.clone();
    caches.open(VERSION).then(c => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
