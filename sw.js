// ErstDu – Service Worker. Bei jeder Änderung an App-Dateien VERSION hochzählen.
const VERSION = 'lichtblick-v7';
const KERN = [
  './', 'index.html', 'app.js', 'api.js', 'tag.js', 'erinnerung.js', 'foto.js', 'config.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(KERN)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(n => Promise.all(n.filter(x => x !== VERSION).map(x => caches.delete(x))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Supabase-Daten nie zwischenspeichern.
  if (url.hostname.endsWith('supabase.co')) return;
  // Supabase-Bibliothek vom CDN: einmal holen, dann aus dem Speicher.
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.open(VERSION).then(async c =>
      (await c.match(e.request)) || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; })));
    return;
  }
  if (url.origin !== location.origin) return;
  // Eigene Dateien: erst Netz (damit Updates schnell ankommen), sonst Speicher.
  e.respondWith(fetch(e.request, { cache: 'no-cache' })
    .then(r => {
      if (r.ok) { const kopie = r.clone(); caches.open(VERSION).then(c => c.put(e.request, kopie)); }
      return r;
    })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});

// Erinnerung vom Server (supabase/functions/erinnern). iOS verlangt, dass jede
// Push-Nachricht sichtbar wird – deshalb immer eine Mitteilung zeigen.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'ErstDu', {
    body: d.body || 'Was war heute das Beste?',
    icon: 'icons/icon-192.png',
    tag: 'lichtblick-erinnerung',
    data: { url: d.url || './' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const ziel = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(fenster => {
    const offen = fenster.find(f => f.url.startsWith(self.registration.scope));
    return offen ? offen.focus() : self.clients.openWindow(ziel);
  }));
});
