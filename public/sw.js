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
const КЕШ = 'портал-оболочка-v1';

const ОБОЛОЧКА = [
  '/offline',
  '/styles.css',
  '/app.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(КЕШ)
      // addAll падает целиком, если хоть один файл не отдался, и тогда worker
      // не установится вовсе. Кладём по одному: офлайн-страница важнее полноты.
      .then((кеш) => Promise.allSettled(ОБОЛОЧКА.map((путь) => кеш.add(путь))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((имена) => Promise.all(имена.filter((и) => и !== КЕШ).map((и) => caches.delete(и))))
      .then(() => self.clients.claim())
  );
});

// Сеть в приоритете: содержимое портала меняется, и показывать вчерашнюю ленту
// вместо сегодняшней хуже, чем секунда ожидания. Кеш — запасной выход.
self.addEventListener('fetch', (event) => {
  const запрос = event.request;
  if (запрос.method !== 'GET') return;

  // Чужие домены не наше дело, а запросы к API кешировать нельзя вовсе:
  // ответ зависит от того, кто спрашивает.
  const адрес = new URL(запрос.url);
  if (адрес.origin !== self.location.origin || адрес.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(запрос)
      .then((ответ) => {
        if (ответ.ok) {
          const копия = ответ.clone();
          caches.open(КЕШ).then((кеш) => кеш.put(запрос, копия));
        }
        return ответ;
      })
      .catch(() =>
        caches.match(запрос).then((из_кеша) => из_кеша ?? caches.match('/offline'))
      )
  );
});

self.addEventListener('push', (event) => {
  let данные = {};
  try {
    данные = event.data ? event.data.json() : {};
  } catch {
    данные = { body: event.data && event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(данные.title || 'Solo AI Journey', {
      body: данные.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: данные.url || '/' }
    })
  );
});

// Нажатие на уведомление открывает уже открытую вкладку, если она есть, и
// только иначе новую: иначе у человека копятся вкладки одного и того же портала.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const адрес = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((окна) => {
      const открытое = окна.find((окно) => окно.url.includes(адрес));
      return открытое ? открытое.focus() : self.clients.openWindow(адрес);
    })
  );
});
