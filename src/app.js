// Сборка HTTP-приложения. Задача — собрать в одном месте порядок прослоек и
// маршрутов: он важен (сессия раньше защит, ошибки последними) и должен
// читаться целиком с одного экрана. Зачем принимает config и pool аргументами:
// приложение не лезет в окружение и в глобальные соединения само, поэтому в
// тесте поднимается с подставными. Вызывается из src/server.js и из тестов.
import express from 'express';
import { version } from './version.js';
import { notFound, errorHandler } from './middleware/errors.js';
import { sessionMiddleware } from './middleware/session.js';
import { authRoutes } from './routes/auth.js';
import { pageRoutes } from './routes/pages.js';
import { pwaRoutes } from './routes/pwa.js';
import { lessonRoutes } from './routes/lessons.js';
import { feedbackRoutes } from './routes/feedback.js';

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

  // Сессия разбирается до всех маршрутов: дальше по цепочке req.user есть
  // везде, в том числе у страниц — им нужно знать, показывать «Войти» или имя.
  app.use(sessionMiddleware(config));
  app.use('/api/auth', authRoutes(config, pool));
  app.use('/api', lessonRoutes(config, pool));
  app.use('/api', feedbackRoutes(config, pool));

  // Проба живости для docker и для человека: адрес открылся — значит дошло до
  // приложения, а не остановилось на nginx.
  app.get('/healthz', (req, res) => res.json({ status: 'ok', version }));

  // Манифест и service worker — раньше статики: оба отдаются кодом, а не
  // файлом с диска, и по своим правилам кеширования.
  app.use('/', pwaRoutes(config));

  // Статика раньше страниц: файл с диска не должен попадать в обработчик
  // маршрута, а /styles.css и /fonts/ нужны каждой странице.
  app.use(express.static(new URL('../public', import.meta.url).pathname, { maxAge: '1h' }));
  app.use('/', pageRoutes(config, pool));

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
