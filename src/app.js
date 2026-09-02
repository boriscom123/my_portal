// Сборка HTTP-приложения. Задача — собрать в одном месте порядок прослоек и
// маршрутов: он важен (сессия раньше защит, ошибки последними) и должен
// читаться целиком с одного экрана. Зачем принимает config и pool аргументами:
// приложение не лезет в окружение и в глобальные соединения само, поэтому в
// тесте поднимается с подставными. Вызывается из src/server.js и из тестов.
import express from 'express';
import { version } from './version.js';
import { notFound, errorHandler } from './middleware/errors.js';
import { stubPage } from './views/stub.js';

/**
 * Собирает приложение: прослойки и маршруты.
 * Возвращает приложение БЕЗ замыкающих обработчиков — их ставит finalize,
 * чтобы тест мог дописать свой маршрут после сборки.
 */
export function createApp({ config, pool }) {
  const app = express();

  // За общим nginx настоящий адрес клиента приходит заголовком; без этого в
  // логах и ограничителях частоты будет адрес контейнера nginx для всех.
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '64kb' }));

  // Пригодится роутам и сервисам, чтобы не тащить конфиг импортом отовсюду.
  app.locals.config = config;
  app.locals.pool = pool;

  // Проба живости для docker и для человека: адрес открылся — значит дошло до
  // приложения, а не остановилось на nginx.
  app.get('/healthz', (req, res) => res.json({ status: 'ok', version }));

  // Заглушка до этапа 2. Заменится настоящей витриной вместе с src/views/stub.js.
  app.get('/', (req, res) => res.type('html').send(stubPage()));

  return app;
}

/**
 * Ставит замыкающие обработчики: 404 и ошибки.
 * Зачем отдельно от createApp: в Express порядок решает всё — эти двое обязаны
 * стоять после всех маршрутов, включая те, что добавит тест.
 * Вызывается из src/server.js и из тестов перед listen.
 */
export function finalize(app) {
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
