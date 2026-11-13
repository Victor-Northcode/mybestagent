// Service worker: офлайн-оболочка, кэш статики и push-уведомления.
const CACHE = 'mba-v30';
const SHELL = ['/', '/css/app.css', '/js/app.js', '/js/core.js', '/js/views.js', '/js/admin.js', '/js/places.js', '/vendor/leaflet.js', '/vendor/leaflet.css', '/assets/logo-256.png', '/assets/logo.png', '/assets/icon-192.png', '/manifest.webmanifest', '/fonts/golos.css', '/fonts/golos-cyrillic.woff2', '/fonts/golos-latin.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.pathname.startsWith('/api/')) return; // API — всегда сеть
  if (u.origin !== location.origin) return; // сторонние ресурсы (карта, шрифты, CDN) — напрямую браузером
  if (r.mode === 'navigate') { e.respondWith(fetch(r).catch(() => caches.match('/'))); return; }
  if (!u.pathname.startsWith('/uploads/')) {
    // свой код: сначала сеть (свежие версии), при офлайне — кэш
    e.respondWith(fetch(r).then((res) => { const c = res.clone(); caches.open(CACHE).then((ca) => ca.put(r, c)); return res; }).catch(() => caches.match(r)));
    return;
  }
  e.respondWith(caches.match(r).then((hit) => hit || fetch(r).then((res) => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then((ca) => ca.put(r, c)); } return res; })));
});
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data.json(); } catch (er) { d = { title: 'Мой лучший агент', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Мой лучший агент', {
    body: d.body || '', icon: '/assets/icon-192.png', badge: '/assets/favicon.png', data: { url: d.url || '/' }, vibrate: [120, 60, 120], tag: d.url || 'mba'
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data.url || '/', location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(location.origin)) { c.focus(); c.postMessage({ url }); return; }
    return self.clients.openWindow(url);
  }));
});
