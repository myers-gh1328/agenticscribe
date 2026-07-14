const cacheName = 'agenticscribe-shell-__BUILD_ID__';
const fixedShell = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(cacheApplicationShell());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('agenticscribe-shell-') && key !== cacheName).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
    event.respondWith(fetch(request));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/')));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
});

async function cacheApplicationShell() {
  const cache = await caches.open(cacheName);
  try {
    const page = await fetch('/', { credentials: 'same-origin' });
    if (!page.ok) throw new Error('Application shell was unavailable.');
    const html = await page.clone().text();
    await cache.put('/', page);
    const assetUrls = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
      .map((match) => new URL(match[1], self.location.origin))
      .filter((url) => url.origin === self.location.origin)
      .map((url) => url.pathname);
    await cache.addAll([...new Set([...fixedShell.slice(1), ...assetUrls])]);
  } catch (error) {
    await caches.delete(cacheName);
    throw error;
  }
}
