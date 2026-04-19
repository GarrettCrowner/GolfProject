// client/public/sw.js
// Service Worker — Skins Tracker
// Handles: offline caching, push notifications

const CACHE_NAME    = 'gimme-v1';
const OFFLINE_URL   = '/offline.html';

// Static assets to cache on install
const PRECACHE = [
  '/',
  '/offline.html',
  '/src/styles/base.css',
  '/src/styles/components.css',
];

// ── Install ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// ── Activate ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch — network-first, fall back to cache ──
self.addEventListener('fetch', event => {
  // Skip non-GET and API/WS requests
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/api/') || event.request.url.includes('/ws')) return;

  event.respondWith(
    fetch(event.request)
      .then(res => {
        // Cache successful responses for app shell
        if (res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(() =>
        caches.match(event.request).then(cached => cached || caches.match(OFFLINE_URL))
      )
  );
});

// ── Push notifications ──
self.addEventListener('push', event => {
  let data = { title: '⛳ Gimme', body: 'Something happened in your round!' };
  try { data = event.data.json(); } catch {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:    data.body,
      icon:    '/icons/icon-192.png',
      badge:   '/icons/icon-192.png',
      tag:     data.tag    || 'skins-notif',
      data:    data.url    ? { url: data.url } : undefined,
      actions: data.actions || [],
      vibrate: [100, 50, 100],
    })
  );
});

// ── Notification click — open/focus the app ──
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      const existing = clientList.find(c => c.url.includes(self.location.origin));
      if (existing) { existing.focus(); existing.navigate(url); }
      else clients.openWindow(url);
    })
  );
});
