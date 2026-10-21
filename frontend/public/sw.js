// Service worker: shows push notifications, and keeps the app's own files so it opens offline. Data and settings are
// never cached here (they come from the API and /config.json; the app keeps its own offline copy).
const FILES = 'tt-files-v1';

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname === '/config.json') return;
  if (request.mode === 'navigate') {
    // The page: always try the network first so a new deploy shows straight away.
    event.respondWith(
      fetch(request)
        .then(async (res) => {
          if (res.ok) (await caches.open(FILES)).put('/', res.clone());
          return res;
        })
        .catch(async () => (await caches.match('/')) || Response.error()),
    );
  } else if (url.pathname.startsWith('/assets/')) {
    // Hashed file names never change content: cache first.
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then(async (res) => {
            if (res.ok) (await caches.open(FILES)).put(request, res.clone());
            return res;
          }),
      ),
    );
  }
});

self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data && event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Tennis', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      // Drop hashed files from older deploys; the current page re-adds what it uses.
      const cache = await caches.open(FILES);
      for (const request of await cache.keys()) if (new URL(request.url).pathname.startsWith('/assets/')) await cache.delete(request);
      await self.clients.claim();
    })(),
  ),
);

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        try {
          return await open.navigate(url);
        } catch {
          return undefined;
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
