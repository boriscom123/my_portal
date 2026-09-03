// Обвязка приложения: манифест и service worker.
//
// Задача — отдать оба с корня сайта и с правильными заголовками. Зачем
// манифест собирается кодом: в нём есть адрес портала, а адрес живёт только в
// окружении — статический файл пришлось бы править руками при каждом переезде.
// Зачем sw.js отдаётся маршрутом, а не статикой: область действия worker'а
// равна каталогу, из которого он отдан, и из /public/ он не смог бы
// перехватывать запросы к корню.
// Подключается в src/app.js до статики.
import { Router } from 'express';
import { readFile } from 'node:fs/promises';

export function pwaRoutes(config) {
  const router = Router();

  router.get('/manifest.webmanifest', (req, res) => {
    res.type('application/manifest+json').json({
      name: 'Solo AI Journey — портал видеоуроков',
      // Имя под иконкой на домашнем экране. iOS обрезает его примерно на
      // двенадцати знаках, поэтому короче некуда — и так лучше.
      short_name: 'Solo',
      description: 'Видеоуроки о разработке с ИИ, новости и борд идей.',
      start_url: `${config.publicBaseUrl}/`,
      scope: `${config.publicBaseUrl}/`,
      // standalone — приложение открывается без адресной строки браузера.
      // Без этого iOS не считает страницу приложением и не даёт Web Push.
      display: 'standalone',
      background_color: '#0c0a20',
      theme_color: '#0c0a20',
      lang: 'ru',
      dir: 'ltr',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        // maskable Android обрезает по своей маске; у этой иконки заложены
        // поля, поэтому знак не съедается по краям.
        {
          src: '/icons/icon-512-maskable.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable'
        }
      ]
    });
  });

  router.get('/sw.js', async (req, res) => {
    const код = await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8');
    // Долгий кеш здесь опасен: закешированный worker означает, что старая
    // версия приложения живёт у человека ещё час после выката, включая
    // старую логику пушей. Браузер и так перепроверяет его при каждой загрузке.
    res.set('Cache-Control', 'no-cache').type('application/javascript').send(код);
  });

  return router;
}
