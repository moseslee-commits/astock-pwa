// A股智能选股系统 Service Worker v4
const CACHE_NAME = 'astock-pwa-v4';
const STATIC_CACHE = 'astock-static-v4';
const RUNTIME_CACHE = 'astock-runtime-v4';
const API_CACHE = 'astock-api-v4';

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

// API缓存最大数量和过期时间（毫秒）
const API_CACHE_MAX = 50;
const API_CACHE_TTL = 5 * 60 * 1000; // 5分钟

// 安装：缓存核心资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        return cache.addAll(CORE_ASSETS).catch(err => {
          console.log('部分资源缓存失败:', err);
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
          .filter((name) => !name.includes('v4'))
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// 检查缓存是否过期
function isCacheExpired(response) {
  if (!response) return true;
  const cachedTime = response.headers.get('sw-cache-time');
  if (!cachedTime) return true;
  return (Date.now() - parseInt(cachedTime)) > API_CACHE_TTL;
}

// 缓存API响应（带时间戳）
async function cacheApiResponse(request, response) {
  if (!response || response.status !== 200) return;
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
  
  // 清理过期缓存，控制缓存数量
  const keys = await cache.keys();
  if (keys.length > API_CACHE_MAX) {
    for (let i = 0; i < keys.length - API_CACHE_MAX; i++) {
      await cache.delete(keys[i]);
    }
  }
}

// 请求拦截：智能缓存策略
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 只缓存GET请求
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API请求：网络优先，失败回退缓存（Stale-While-Revalidate）
  const isApiRequest = url.pathname.startsWith('/api/') ||
      url.hostname.includes('eastmoney.com') ||
      url.hostname.includes('push2') ||
      url.hostname.includes('sina');
  
  if (isApiRequest) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // 缓存成功的API响应
          cacheApiResponse(request, response.clone());
          return response;
        })
        .catch(async () => {
          // 网络失败，尝试缓存
          const cached = await caches.match(request);
          if (cached) {
            // 返回缓存数据，即使过期也返回（离线时总比没有好）
            return cached;
          }
          // 返回空数据响应
          return new Response(JSON.stringify({ error: 'offline', data: [] }), {
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }

  // HTML页面：网络优先，失败回退缓存
  if (request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
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

// 监听推送消息
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

// 离线状态检测：通知页面
self.addEventListener('message', (event) => {
  if (event.data === 'getOfflineStatus') {
    event.source.postMessage({
      type: 'offlineStatus',
      online: self.navigator.onLine,
      apiCacheSize: API_CACHE_MAX
    });
  }
});
