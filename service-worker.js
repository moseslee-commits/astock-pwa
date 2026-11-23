// A股智能选股系统 Service Worker（版本号由构建脚本同步）
const CACHE_VERSION = 'v473';
const CACHE_NAME = 'astock-pwa-' + CACHE_VERSION;
const STATIC_CACHE = 'astock-static-' + CACHE_VERSION;
const RUNTIME_CACHE = 'astock-runtime-' + CACHE_VERSION;
const API_CACHE = 'astock-api-' + CACHE_VERSION;

const CORE_ASSETS = [
  './',
  './manifest.json',
  './mobile.html',
  './dashboard.html',
  './stock-picker.html',
  './portfolio.html',
  './price-alert.html',
  './history.html',
  './app.html',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

const OFFLINE_PAGE = './mobile.html';
const API_CACHE_MAX = 50;
const API_CACHE_TTL = 5 * 60 * 1000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(CORE_ASSETS).catch(async () => {
        await Promise.all(CORE_ASSETS.map(url => cache.add(url).catch(() => null)));
      }))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith('astock-') && !name.includes(CACHE_VERSION))
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

function isCacheExpired(response) {
  if (!response) return true;
  const cachedTime = response.headers.get('sw-cache-time');
  if (!cachedTime) return true;
  return (Date.now() - parseInt(cachedTime)) > API_CACHE_TTL;
}

// 只缓存成功的 2xx 响应，避免把 404/501 固化 5 分钟
async function cacheApiResponse(request, response) {
  if (!response || !response.ok) return;
  const clone = response.clone();
  const headers = new Headers(clone.headers);
  headers.set('sw-cache-time', Date.now().toString());
  const cachedResponse = new Response(await clone.blob(), {
    status: clone.status,
    statusText: clone.statusText,
    headers: headers
  });
  const cache = await caches.open(API_CACHE);
  await cache.put(request, cachedResponse);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - API_CACHE_MAX; i++) await cache.delete(keys[i]);
}

// 离线骨架与调用方期望的 shape 对齐，避免静默跳过
function offlineFallback(url) {
  const path = url.pathname.toLowerCase();
  let payload;
  if (path.includes('kline') || path.includes('last.js')) payload = { klines: [], count: 0 };
  else if (path.includes('minute')) payload = { points: [], count: 0 };
  else if (path.includes('finance')) payload = { pe_dynamic: '-', pb: '-', degraded: true };
  else payload = { error: 'offline', data: [] };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'sw-offline': '1' }
  });
}

function isApiRequest(url) {
  const host = url.hostname;
  return url.pathname.startsWith('/api/') ||
    host.includes('eastmoney.com') || host.includes('push2') ||
    host.includes('sina') || host.includes('gtimg') || host.includes('10jqka');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (isApiRequest(url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) cacheApiResponse(request, response.clone());
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached && !isCacheExpired(cached)) return cached;
          return offlineFallback(url);
        })
    );
    return;
  }

  if (request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match(OFFLINE_PAGE)))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(self.registration.showNotification(data.title || '价格预警', {
    body: data.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: data.tag || 'astock-notification'
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes('mobile.html') && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('./mobile.html');
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'getOfflineStatus') {
    event.source.postMessage({
      type: 'offlineStatus',
      online: self.navigator.onLine,
      apiCacheSize: API_CACHE_MAX,
      cacheVersion: CACHE_VERSION
    });
  }
});
