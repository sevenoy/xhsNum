// Service Worker - 自动更新缓存控制
// 版本号：每次更新代码时，修改下面的 VERSION 值即可强制更新

// ✅ 版本号格式：V + 年月日（6位） + . + 版本更改号
// 例如：V251213.8 表示 2025年12月13日第8次更新
const VERSION = 'V251213.44'; // ✅ 每次更新代码时，修改这个版本号
const CACHE_NAME = `xhsnum-cache-v${VERSION}`;

// 需要缓存的资源列表（关键资源）
const CRITICAL_RESOURCES = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './site.webmanifest',
  './update-log.json', // ✅ 添加更新日志文件到缓存列表
  './icon/icon-192.png',
  './icon/icon-512.png',
  'https://esm.sh/@supabase/supabase-js@2'
  // 注意：Supabase CDN 库不在 install 时缓存，而是在 fetch 时动态缓存
];

// 安装 Service Worker
self.addEventListener('install', (event) => {
  console.log('[SW] 安装中，版本:', VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] 缓存关键资源');
      return cache.addAll(CRITICAL_RESOURCES).catch((err) => {
        console.warn('[SW] 部分资源缓存失败:', err);
      });
    })
  );
  // ✅ 立即激活新的 Service Worker（但保留 installed 状态，让页面能检测到更新）
  // 注意：skipWaiting 会导致立即激活，但会在 installed 状态停留一下
  self.skipWaiting();
});

// 激活 Service Worker
self.addEventListener('activate', (event) => {
  console.log('[SW] 激活中，版本:', VERSION);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // 删除旧版本的缓存
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] 删除旧缓存:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // 立即控制所有客户端
  return self.clients.claim();
});

// 拦截网络请求
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // ✅ 允许缓存同源资源，以及 Supabase 的 CDN 资源（防止数据库连接失败）
  if (url.origin !== location.origin && !url.href.includes('esm.sh')) {
    return;
  }
  
  // ✅ 特殊处理：Supabase CDN 资源，使用缓存优先策略（确保数据库连接稳定）
  if (url.href.includes('esm.sh') && url.href.includes('@supabase/supabase-js')) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        // 如果有缓存，优先使用缓存（确保数据库连接稳定）
        if (cachedResponse) {
          return cachedResponse;
        }
        // 没有缓存，从网络获取并缓存
        return fetch(request).then((response) => {
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        }).catch(() => {
          // 网络失败时返回错误，不要返回空响应
          return new Response('网络错误：无法加载 Supabase 库', { status: 503 });
        });
      })
    );
    return;
  }

  // 对于 HTML 和关键资源，使用网络优先策略（确保获取最新版本）
  // ✅ 针对 js/app.js：强制从网络获取，不使用缓存（确保安卓设备获取最新代码）
  if (request.method === 'GET' && (
    request.destination === 'document' ||
    request.url.includes('.css') ||
    request.url.includes('.js') ||
    request.url.includes('manifest')
  )) {
    // ✅ 特殊处理：app.js 使用网络优先策略（优先从网络获取，失败时使用缓存）
    // 这样既能获取最新代码，又能在网络失败时使用缓存避免页面崩溃
    if (request.url.includes('app.js')) {
      event.respondWith(
        fetch(request, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
          }
        }).then((response) => {
          // 如果网络请求成功，更新缓存
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        }).catch(() => {
          // ✅ 网络失败时，尝试从缓存获取（避免页面崩溃）
          console.warn('[SW] app.js 网络请求失败，使用缓存版本');
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // 如果缓存也没有，返回错误（不应该发生，因为install时已经缓存了）
            return new Response('无法加载 app.js（网络和缓存都不可用）', { 
              status: 503,
              headers: { 'Content-Type': 'text/plain' }
            });
          });
        })
      );
      return;
    }
    
    event.respondWith(
      fetch(request)
        .then((response) => {
          // 如果网络请求成功，更新缓存
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          // 网络失败时，尝试从缓存获取
          return caches.match(request).then((cachedResponse) => {
            return cachedResponse || new Response('离线状态', { status: 503 });
          });
        })
    );
  } else {
    // 其他资源使用缓存优先策略
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        return cachedResponse || fetch(request).then((response) => {
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        });
      })
    );
  }
});

// 监听来自客户端的消息（用于手动更新）
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => caches.delete(cacheName))
        );
      })
    );
  }
});
