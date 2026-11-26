// Offline-Cache nur für die App selbst. API-Aufrufe (OpenAI, Google) gehen immer direkt ins Netz.
const CACHE = 'baumprojekt-v6';
const FILES = ['./', 'index.html', 'css/style.css', 'config.js', 'js/app.js', 'js/workbook.js', 'js/services.js', 'vendor/exceljs.min.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Netz zuerst (damit Updates sofort ankommen), Cache als Rückfall
  e.respondWith(fetch(e.request.url, { cache: 'no-cache' }).then(r => { const copy = r.clone(); if (r.ok) caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
