/* Service worker портала: офлайн-оболочка и приём пушей.
 *
 * Задача — показать что-то осмысленное без сети и превратить пуш в уведомление
 * на экране. Зачем оболочка, а не кеш всего: уроки живут на площадках,
 * кешировать тут нечего — а вот пустой белый экран в метро выглядит как
 * сломанное приложение.
 * Регистрируется из public/app.js при загрузке любой страницы.
 */

// Имя кеша с версией: смена имени — это и есть выкат новой оболочки. Старый
// кеш удаляется в activate, иначе они копятся до конца жизни устройства.
const CACHE = 'портал-оболочка-v1';

const SHELL = [
  '/offline',
  '/styles.css',
  '/app.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll падает целиком, если хоть один файл не отдался, и тогда worker
      // не установится вовсе. Кладём по одному: офлайн-страница важнее полноты.
      .then((cache) => Promise.allSettled(SHELL.map((path) => cache.add(path))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

// Сеть в приоритете: содержимое портала меняется, и показывать вчерашнюю ленту
// вместо сегодняшней хуже, чем секунда ожидания. Кеш — запасной выход.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  // Чужие домены не наше дело, а запросы к API кешировать нельзя вовсе:
  // ответ зависит от того, кто спрашивает.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request)
      .then((answer) => {
        if (answer.ok) {
          const copy = answer.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return answer;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached ?? caches.match('/offline'))
      )
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data && event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Solo AI Journey', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/' }
    })
  );
});

// Нажатие на уведомление открывает уже открытую вкладку, если она есть, и
// только иначе новую: иначе у человека копятся вкладки одного и того же портала.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const openWindow = windows.find((win) => win.url.includes(url));
      return openWindow ? openWindow.focus() : self.clients.openWindow(url);
    })
  );
});
