// Service worker: shows push notifications, and keeps the app's own files so it opens offline. Data and settings are
// never cached here (they come from the API and /config.json; the app keeps its own offline copy).
const FILES = 'tt-files-v1';
const SHELL = ['/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

/** Keep the page, the files it names and the icons; drop scripts and styles from older deploys. */
async function keepShell(html) {
  const cache = await caches.open(FILES);
  const named = [...html.matchAll(/\/assets\/[\w.-]+/g)].map((m) => m[0]);
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    if (/\.(js|css)$/.test(path) && path.startsWith('/assets/') && !named.includes(path)) await cache.delete(request);
  }
  await cache.addAll([...named, ...SHELL]).catch(() => undefined);
}

const isAsset = (res) => res.ok && !(res.headers.get('content-type') || '').includes('text/html'); // never keep the app's fallback page as a script

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname === '/config.json') return;
  if (request.mode === 'navigate') {
    // The page: always try the network first so a new deploy shows straight away.
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            event.waitUntil(
              (async () => {
                await (await caches.open(FILES)).put('/', copy.clone());
                await keepShell(await copy.text());
              })().catch(() => undefined),
            );
          }
          return res;
        })
        .catch(async () => (await caches.match('/')) || Response.error()),
    );
  } else if (url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname)) {
    // Hashed file names never change content: cache first.
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (isAsset(res)) {
              const copy = res.clone();
              event.waitUntil(caches.open(FILES).then((cache) => cache.put(request, copy)).catch(() => undefined));
            }
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
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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
