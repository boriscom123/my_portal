// Серверные страницы. Задача — отдать поисковику и мессенджеру готовый HTML с
// тегами превью; вся живая логика идёт отдельно, через JSON API.
// Подключается в src/app.js после маршрутов API.
import { Router } from 'express';
import { loginPage } from '../views/login.js';
import { stubPage } from '../views/stub.js';
import { offlinePage } from '../views/offline.js';
import { telegramReturnPage } from '../views/telegram-return.js';
import { adminUploadPage } from '../views/admin-upload.js';
import { requireAdmin } from '../middleware/guards.js';
import { feedPage } from '../views/feed.js';
import { lessonPage } from '../views/lesson.js';
import { ideasPage } from '../views/ideas.js';
import { listIdeas } from '../services/ideas.js';
import { listLessons, getLessonBySlug, listNews } from '../services/lessons.js';
import {
  listComments,
  countReactions,
  ratingSummary,
  getViewerReaction
} from '../services/feedback.js';
import { PublicError } from '../middleware/errors.js';

/**
 * Текущий пользователь для шаблона: только имя и роль.
 * Зачем отдельной функцией: то же самое нужно каждой странице, а тащить в
 * шаблон весь req незачем — вид не должен знать про HTTP.
 * Вызывается из обработчиков этого файла.
 */
async function currentUser(pool, req) {
  if (!req.user || !pool) return null;
  const { rows } = await pool.query('SELECT display_name, role FROM users WHERE id = $1', [
    req.user.id
  ]);
  return rows.length ? { displayName: rows[0].display_name, role: rows[0].role } : null;
}

export function pageRoutes(config, pool) {
  const router = Router();

  // Содержимое страниц зависит от того, кто смотрит: вошедший видит своё имя.
  // Без этого заголовка общий кеш по дороге может отдать страницу одного
  // человека другому. no-cache не запрещает хранить, а требует переспросить.
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-cache');
    next();
  });

  router.get('/', async (req, res) => {
    const user = await currentUser(pool, req);
    const lessons = await listLessons(pool, { includeDrafts: user?.role === 'admin' });
    // Пока уроков нет вовсе, показываем заглушку с рассказом о проекте:
    // пустая лента на новом сайте читается как сломанная страница.
    if (!lessons.length) {
      res.type('html').send(stubPage(config, user));
      return;
    }
    const news = await listNews(pool, {});
    res.type('html').send(feedPage({ config, lessons, news, user }));
  });

  router.get('/tag/:slug', async (req, res) => {
    const user = await currentUser(pool, req);
    const lessons = await listLessons(pool, { tag: req.params.slug });
    res.type('html').send(feedPage({ config, lessons, news: [], user, tag: req.params.slug }));
  });

  router.get('/lesson/:slug', async (req, res) => {
    const user = await currentUser(pool, req);
    const lesson = await getLessonBySlug(pool, req.params.slug, {
      includeDrafts: user?.role === 'admin'
    });
    if (!lesson) throw new PublicError('Урок не найден', 404);

    const object = { objectType: 'lesson', objectId: lesson.id };
    lesson.reactions = await countReactions(pool, object);
    const rating = await ratingSummary(pool, object);
    const comments = await listComments(pool, {
      ...object,
      viewerId: req.user?.id ?? null,
      isAdmin: user?.role === 'admin'
    });
    const viewerReaction = await getViewerReaction(pool, {
      ...object,
      userId: req.user?.id ?? null
    });
    res.type('html').send(lessonPage({ config, lesson, comments, user, viewerReaction, rating }));
  });

  // Кабинет автора: загрузка исходника. Под requireAdmin — исходники грузит
  // один человек, и посторонним тут нечего смотреть.
  router.get('/admin/upload', requireAdmin, async (req, res) => {
    const user = await currentUser(pool, req);
    const lessons = await listLessons(pool, { includeDrafts: true });
    // Подключён ли Диск, узнаём одним запросом: показывать список файлов или
    // кнопку подключения — решается здесь, а не мельканием в браузере.
    const { rows } = await pool.query(`SELECT 1 FROM integrations WHERE name = 'yandex-disk'`);
    res.type('html').send(
      adminUploadPage({ config, user, lessons, diskConnected: rows.length > 0 })
    );
  });

  router.get('/ideas', async (req, res) => {
    const user = await currentUser(pool, req);
    const ideas = await listIdeas(pool, { viewerId: req.user?.id ?? null });
    res.type('html').send(ideasPage({ config, ideas, user }));
  });

  // Telegram возвращает человека сюда после подтверждения входа.
  router.get('/auth/telegram/return', (req, res) => {
    res.type('html').send(telegramReturnPage(config));
  });

  router.get('/offline', (req, res) => {
    res.type('html').send(offlinePage(config));
  });

  router.get('/login', async (req, res) => {
    const user = await currentUser(pool, req);
    res.type('html').send(loginPage({ config, user }));
  });

  return router;
}
