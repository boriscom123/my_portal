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
import { pushRoutes } from './routes/push.js';
import { uploadRoutes } from './routes/upload.js';
import { integrationRoutes } from './routes/integrations.js';
import { clientErrorRoutes } from './routes/client-errors.js';
import { createWebPushChannel } from './services/notify/webpush.js';
import { createTelegramChannel } from './services/notify/telegram.js';
import { lessonRoutes } from './routes/lessons.js';
import { feedbackRoutes } from './routes/feedback.js';
import { ideaRoutes } from './routes/ideas.js';

/**
 * Собирает приложение: прослойки и маршруты.
 * Возвращает приложение БЕЗ замыкающих обработчиков — их ставит finalize,
 * чтобы тест мог дописать свой маршрут после сборки.
 */
export function createApp({ config, pool, fetchImpl, queue = null }) {
  const app = express();

  // За общим nginx настоящий адрес клиента приходит заголовком; без этого в
  // логах и ограничителях частоты будет адрес контейнера nginx для всех.
  app.set('trust proxy', 1);

  // Пригодится роутам и сервисам, чтобы не тащить конфиг импортом отовсюду.
  app.locals.config = config;
  app.locals.pool = pool;

  // Каналы собираются один раз на приложение: web-push настраивается
  // глобально, а повторная настройка на каждый запрос — лишняя работа и
  // лишний повод разойтись конфигурациям. Тест подменяет app.locals.channels.
  // Очередь приходит снаружи, а не создаётся здесь: она открывает соединение
  // с Redis, и приложение, создающее его само, невозможно поднять в тесте —
  // соединения копятся и процесс не завершается. Исполняет задачи воркер,
  // приложение только ставит.
  app.locals.queue = queue;

  app.locals.channels = {
    webpush: createWebPushChannel(config, pool),
    telegram: createTelegramChannel(config)
  };

  // Сессия разбирается до всех маршрутов: дальше по цепочке req.user есть
  // везде, в том числе у страниц — им нужно знать, показывать «Войти» или имя.
  app.use(sessionMiddleware(config));

  // Загрузка со своим разбором тела и ДО общего express.json: куски приходят
  // потоком байт, и общий разбор попытался бы прочитать восемь мегабайт видео
  // как JSON. Сессия при этом уже разобрана выше — без неё маршруты не узнали
  // бы, кто пришёл, и отвечали бы «нужно войти». Порядок здесь не
  // косметический: обе перестановки уже ломали загрузку.
  app.use('/api/upload', express.json({ limit: '8kb' }), uploadRoutes(config, pool));

  // Общий разбор тела — после загрузки, для всех остальных маршрутов.
  app.use(express.json({ limit: '64kb' }));

  app.use('/api/auth', authRoutes(config, pool));
  app.use('/api/integrations', integrationRoutes(config, pool, fetchImpl));
  app.use('/api', lessonRoutes(config, pool));
  app.use('/api', feedbackRoutes(config, pool));
  app.use('/api', ideaRoutes(config, pool));
  app.use('/api/push', pushRoutes(config, pool));
  app.use('/api', clientErrorRoutes());

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
