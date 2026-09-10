// A股智能选股系统 Service Worker
const CACHE_NAME = 'astock-pwa-v2';
const ASSETS_TO_CACHE = [
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

// 安装：缓存核心资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(ASSETS_TO_CACHE).catch(err => {
          console.log('部分资源缓存失败:', err);
        });
      })
      .then(() => self.skipWaiting())
  );
});

// 激活：清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// 请求拦截：缓存优先策略
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 只缓存GET请求
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API请求不缓存（行情数据需要实时）
  if (url.pathname.startsWith('/api/') ||
      url.hostname.includes('eastmoney.com') ||
      url.hostname.includes('push2')) {
    return; // 走网络，不缓存
  }

  // 静态资源：缓存优先，网络更新
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request).then((response) => {
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      }).catch(() => cached);

      return cached || networkFetch;
    })
  );
});
