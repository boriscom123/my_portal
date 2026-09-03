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
import { assetUrl } from '../lib/assets.js';

export function pwaRoutes(config) {
  const router = Router();

  router.get('/manifest.webmanifest', (req, res) => {
    // Манифест задаёт имя и иконку приложения. Без указания кеша браузер
    // хранит его по своему усмотрению — иногда сутками, и правка имени не
    // доезжает до человека. no-cache не запрещает хранить, а требует спросить.
    res.set('Cache-Control', 'no-cache');
    res.type('application/manifest+json').json({
      // Полное имя. Держим коротким: разные версии iOS подставляют под иконку
      // то short_name, то name, и длинное здесь вылезало на домашний экран.
      name: 'Solo AI Journey',
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
    const source = await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8');

    // Отпечатки клиентских файлов подмешиваются в текст worker'а.
    //
    // Зачем: браузер считает worker новым, только если изменились его БАЙТЫ.
    // Пока правились лишь app.js и styles.css, worker оставался прежним, новая
    // версия не вступала в силу, и установленное приложение неделями крутило
    // старый код — человек нажимал кнопку и получал ошибку, которой в
    // репозитории уже не было. Теперь любая правка клиента меняет worker.
    const stamp = [assetUrl('/app.js'), assetUrl('/styles.css'), assetUrl('/push-key.js')].join(' ');
    const code = `// версия клиента: ${stamp}\n${source}`;
    // Долгий кеш здесь опасен: закешированный worker означает, что старая
    // версия приложения живёт у человека ещё час после выката, включая
    // старую логику пушей. Браузер и так перепроверяет его при каждой загрузке.
    res.set('Cache-Control', 'no-cache').type('application/javascript').send(code);
  });

  return router;
}
