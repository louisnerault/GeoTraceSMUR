// Service worker : met en cache la coquille de l'appli (pas les données) et affiche les notifications push.
const VERSION = 'geotrace-v2';
const FICHIERS = ['./', 'index.html', 'push.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

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
  if (url.origin !== location.origin) return; // la web app Google et Firebase ne sont jamais mises en cache
  e.respondWith(fetch(e.request).then(r => {
    const copie = r.clone();
    caches.open(VERSION).then(c => c.put(e.request, copie));
    return r;
  }).catch(() => caches.match(e.request)));
});

// ---------- Notifications push (envoyées par le Raspberry Pi via Firebase, voir notifier.py) ----------
// Données reçues : titre, texte, clic (lien ouvert en touchant la notification),
// boutons (JSON [[libellé, lien], …]), priorite (1 à 5), tag (une notification par objet).
self.addEventListener('push', e => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch (err) { p = { texte: e.data ? e.data.text() : '' }; }
  const d = p.data || p.notification || p;
  let boutons = [];
  try { boutons = JSON.parse(d.boutons || '[]'); } catch (err) {}
  const clic = d.clic || './';
  const max = (self.Notification && Notification.maxActions) || 2;
  const liens = {};
  // Android n'affiche que 2 boutons : on retire celui qui fait doublon avec le toucher de la notification
  const actions = boutons.filter(b => b && b[1] && b[1] !== clic).slice(0, max).map((b, i) => {
    liens['b' + i] = b[1];
    return { action: 'b' + i, title: b[0] };
  });
  const titre = d.titre || 'GéoTrace SMUR';
  const texte = d.texte || '';
  const options = {
    body: texte,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { clic, liens },
    actions,
    requireInteraction: Number(d.priorite || 4) >= 4,
    vibrate: [200, 100, 200]
  };
  if (d.tag) { options.tag = d.tag; options.renotify = true; }

  e.waitUntil(Promise.all([
    self.registration.showNotification(titre, options),
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(liste => liste.forEach(c => c.postMessage({ type: 'geotrace-push', titre, texte, clic })))
  ]));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const d = e.notification.data || {};
  const cible = (e.action && d.liens && d.liens[e.action]) || d.clic || './';
  const url = new URL(cible, self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(liste => {
    if (url === self.registration.scope && liste.length) return liste[0].focus();
    return self.clients.openWindow(url);
  }));
});
