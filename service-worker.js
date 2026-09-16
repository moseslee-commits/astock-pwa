// A股智能选股系统 Service Worker v3
const CACHE_NAME = 'astock-pwa-v3';
const STATIC_CACHE = 'astock-static-v3';
const RUNTIME_CACHE = 'astock-runtime-v3';

// 核心静态资源（安装时缓存）
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
  './icons/icon-512.png',
  './icons/icon-1024.png'
];

// 离线回退页面
const OFFLINE_PAGE = './mobile.html';

// 安装：缓存核心资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        return cache.addAll(CORE_ASSETS).catch(err => {
          console.log('部分资源缓存失败:', err);
          // 逐个缓存，避免一个失败导致全部失败
          return Promise.all(CORE_ASSETS.map(url => 
            cache.add(url).catch(e => console.log('缓存失败:', url, e))
          ));
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
          .filter((name) => !name.includes('v3'))
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// 请求拦截：智能缓存策略
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 只缓存GET请求
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API请求不缓存（行情数据需要实时）
  if (url.pathname.startsWith('/api/') ||
      url.hostname.includes('eastmoney.com') ||
      url.hostname.includes('push2') ||
      url.hostname.includes('sina')) {
    return; // 走网络，不缓存
  }

  // HTML页面：网络优先，失败回退缓存
  if (request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // 动态缓存成功的页面
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // 网络失败，尝试缓存
          return caches.match(request).then((cached) => {
            return cached || caches.match(OFFLINE_PAGE);
          });
        })
    );
    return;
  }

  // 静态资源（CSS/JS/图片/字体）：缓存优先，网络更新
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request).then((response) => {
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      }).catch(() => cached);

      return cached || networkFetch;
    })
  );
});

// 监听推送消息（预留，未来可接入Web Push）
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || '价格预警', {
        body: data.body || '',
        icon: './icons/icon-192.png',
        badge: './icons/icon-192.png',
        tag: data.tag || 'astock-notification'
      })
    );
  }
});

// 点击通知聚焦页面
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('mobile.html') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('./mobile.html');
      }
    })
  );
});
