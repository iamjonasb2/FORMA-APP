const VERSION = 'forma-offline-v1';
const SHELL_CACHE = VERSION + '-shell';
const MEDIA_CACHE = VERSION + '-media';
const APP_SHELL = [
  './index.html',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './three.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('forma-offline-') && key !== SHELL_CACHE && key !== MEDIA_CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'FORMA_CACHE_MEDIA') return;
  const urls = [...new Set((event.data.urls || []).filter(value => typeof value === 'string' && value.startsWith('https://huggingface.co/')))];
  event.waitUntil((async () => {
    const cache = await caches.open(MEDIA_CACHE);
    let done = 0;
    let saved = 0;
    for (const url of urls) {
      try {
        const request = new Request(url, { mode: 'no-cors' });
        if (await cache.match(request)) {
          saved++;
        } else {
          const response = await fetch(request);
          if (response.ok || response.type === 'opaque') {
            await cache.put(request, response.clone());
            saved++;
          }
        }
      } catch (_) {}
      done++;
      if (done % 5 === 0 || done === urls.length) {
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        clients.forEach(client => client.postMessage({ type: 'FORMA_CACHE_PROGRESS', done, saved, total: urls.length }));
      }
    }
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach(client => client.postMessage({ type: 'FORMA_CACHE_COMPLETE', done: urls.length, saved, total: urls.length }));
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin && request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const cache = await caches.open(SHELL_CACHE);
        cache.put('./index.html', response.clone()).catch(() => {});
        return response;
      } catch (_) {
        return (await caches.open(SHELL_CACHE)).match('./index.html');
      }
    })());
    return;
  }

  if (url.hostname === 'huggingface.co' && url.pathname.includes('/RepDB/exercise-dataset/') && request.destination === 'image') {
    event.respondWith((async () => {
      const cache = await caches.open(MEDIA_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok || response.type === 'opaque') event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
        return response;
      } catch (_) {
        return Response.error();
      }
    })());
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone()).catch(() => {});
      return response;
    })());
  }
});
