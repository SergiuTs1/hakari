/* 秤 hakari — service worker
 *
 * Стратегія: cache-first для оболонки застосунку. Дані тут не проходять
 * узагалі — вони живуть в IndexedDB і кеша не стосуються.
 *
 * Піднімай CACHE при кожній зміні файлів, інакше телефон показуватиме
 * стару версію.
 */

const CACHE = 'hakari-v10';

/* На localhost кеш вимкнено. Інакше під час розробки правиш CSS, оновлюєш
   сторінку — і бачиш стару версію, поки не здогадаєшся почистити кеш руками. */
const DEV = ['localhost', '127.0.0.1'].includes(location.hostname);

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/tokens.css',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/calc.js',
  './js/chart.js',
  './js/kou.js',
  './js/exif.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  if (DEV) { self.skipWaiting(); return; }
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (DEV) return;                       // під час розробки — завжди з мережі
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(hit => {
      if (hit) return hit;
      return fetch(e.request)
        .then(res => {
          // кладемо в кеш лише свої ж файли й лише вдалі відповіді
          if (res.ok && new URL(e.request.url).origin === location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'));   // офлайн — віддаємо оболонку
    })
  );
});
