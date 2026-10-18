// Service worker minimal : met en cache la coquille de l'appli (pas les données).
const VERSION = 'geotrace-v1';
const FICHIERS = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FICHIERS)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== VERSION).map(n => caches.delete(n)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // la web app Google n'est jamais mise en cache
  e.respondWith(fetch(e.request).then(r => {
    const copie = r.clone();
    caches.open(VERSION).then(c => c.put(e.request, copie));
    return r;
  }).catch(() => caches.match(e.request)));
});
