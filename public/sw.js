// Service worker: офлайн-оболочка, кэш статики и push-уведомления.
const CACHE = 'mba-v38';
const SHELL = ['/', '/css/app.css', '/js/app.js', '/js/core.js', '/js/views.js', '/js/admin.js', '/js/places.js', '/js/push.js', '/vendor/leaflet.js', '/vendor/leaflet.css', '/assets/logo-256.png', '/assets/logo.png', '/assets/icon-192.png', '/assets/badge-96.png', '/manifest.webmanifest', '/fonts/golos.css', '/fonts/golos-cyrillic.woff2', '/fonts/golos-latin.woff2'];

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
// ---------- push ----------
// Сервер присылает: title, body, url, type, tag (склейка по чату/заявке), n (непрочитанных — счётчик на иконке приложения)
const setBadge = (n) => { try { if (n > 0 && self.navigator.setAppBadge) return self.navigator.setAppBadge(n); if (self.navigator.clearAppBadge) return self.navigator.clearAppBadge(); } catch (e) { /* не поддерживается */ } return Promise.resolve(); };
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (er) { d = { body: e.data ? e.data.text() : '' }; }
  const url = new URL(d.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    await setBadge(Number(d.n) || 0);
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const seen = wins.filter((c) => c.visibilityState === 'visible' && c.focused);
    // человек сейчас в этом же чате — сообщение он уже видит, системное уведомление не нужно
    if (d.type === 'chat' && seen.some((c) => c.url === url)) return;
    // сайт открыт и перед глазами — там появится своё всплывающее уведомление; push не дублируем (кроме экстренных и проверки)
    if (seen.length && !['emergency', 'test'].includes(d.type)) return;
    await self.registration.showNotification(d.title || 'Мой лучший агент', {
      body: d.body || '', icon: d.icon || '/assets/icon-192.png', badge: d.badge || '/assets/badge-96.png',
      tag: d.tag || 'mba', renotify: !!d.tag, timestamp: d.ts || Date.now(), lang: 'ru',
      vibrate: d.type === 'emergency' ? [300, 120, 300, 120, 300] : [120, 60, 120],
      requireInteraction: d.type === 'emergency', data: { url, type: d.type || '' }
    });
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || new URL('/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const own = wins.filter((c) => c.url.startsWith(self.location.origin));
    const win = own.find((c) => c.focused) || own.find((c) => c.visibilityState === 'visible') || own[0];
    if (win) {
      await win.focus();
      win.postMessage({ url }); // вкладка сама переходит на нужный экран (без перезагрузки)
      return;
    }
    await self.clients.openWindow(url);
  })());
});
// Браузер обновил подписку (истекла / сменились ключи) — переподписываемся и сообщаем серверу новый адрес
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    const cfg = await fetch('/api/config', { credentials: 'same-origin' }).then((r) => r.json());
    const key = cfg.vapidPublic;
    const raw = atob((key + '='.repeat((4 - key.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
    const sub = (e.newSubscription) || await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) });
    await fetch('/api/push/subscribe', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'mba' },
      body: JSON.stringify({ subscription: sub.toJSON(), oldEndpoint: e.oldSubscription ? e.oldSubscription.endpoint : undefined }) });
  })().catch(() => {}));
});
// Страница сообщает число непрочитанных — счётчик на иконке приложения
self.addEventListener('message', (e) => { if (e.data && e.data.type === 'badge') e.waitUntil(setBadge(Number(e.data.n) || 0)); });
