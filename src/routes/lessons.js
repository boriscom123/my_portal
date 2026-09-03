// API витрины. Задача — отдать клиентам уроки и новости и дать автору их
// править. Зачем тонкий: всё, что решает, кому что показывать, живёт в
// src/services/lessons.js; здесь только разбор запроса и коды ответа.
// Подключается в src/app.js по префиксу /api.
import { Router } from 'express';
import {
  listLessons,
  getLessonBySlug,
  listNews,
  saveLesson,
  setLessonTags
} from '../services/lessons.js';
import { countReactions, ratingSummary } from '../services/feedback.js';
import { requireAdmin } from '../middleware/guards.js';
import { PublicError } from '../middleware/errors.js';
import { notify } from '../services/notify/index.js';

/**
 * Рассылает уведомление о вышедшем уроке всем, до кого есть чем достучаться.
 * Зачем отдельной функцией: то же самое понадобится воркеру на этапе 5, когда
 * урок будет публиковаться не руками, а концом конвейера.
 * Вызывается из обработчика PUT /api/lessons/:slug.
 */
async function notifyAboutLesson(pool, channels, lesson) {
  // Берём только тех, кому есть чем доставить: остальным запись в журнале
  // ничего не даст, а строк наплодит.
  const { rows } = await pool.query(
    `SELECT u.id FROM users u
      WHERE EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = u.id)
         OR EXISTS (SELECT 1 FROM identities i
                     WHERE i.user_id = u.id
                       AND i.provider IN ('tg_widget', 'tg_miniapp', 'max_miniapp'))`
  );
  for (const { id } of rows) {
    await notify(
      pool,
      {
        userId: Number(id),
        kind: 'lesson_published',
        // Ключ несёт и урок, и человека: повторное сохранение карточки не
        // разбудит людей во второй раз.
        dedupKey: `lesson:${lesson.id}:published:${id}`,
        title: 'Новый урок',
        body: lesson.title,
        url: `/lesson/${lesson.slug}`
      },
      channels
    );
  }
}

export function lessonRoutes(config, pool) {
  const router = Router();

  router.get('/lessons', async (req, res) => {
    // Черновики показываются только админу и только по явной просьбе:
    // случайный ?drafts=1 от постороннего не должен ничего открывать.
    const includeDrafts = req.query.drafts === '1' && req.user?.role === 'admin';
    const lessons = await listLessons(pool, {
      tag: req.query.tag ? String(req.query.tag) : null,
      includeDrafts
    });
    res.json({ lessons });
  });

  router.get('/lessons/:slug', async (req, res) => {
    const lesson = await getLessonBySlug(pool, req.params.slug, {
      includeDrafts: req.user?.role === 'admin'
    });
    if (!lesson) throw new PublicError('Урок не найден', 404);
    const object = { objectType: 'lesson', objectId: lesson.id };
    lesson.reactions = await countReactions(pool, object);
    lesson.rating = await ratingSummary(pool, object);
    res.json({ lesson });
  });

  router.put('/lessons/:slug', requireAdmin, async (req, res) => {
    const lesson = await saveLesson(pool, { ...req.body, slug: req.params.slug });
    if (Array.isArray(req.body.tags)) {
      await setLessonTags(pool, lesson.id, req.body.tags);
      lesson.tags = [...req.body.tags].sort();
    }
    if (lesson.status === 'published') {
      await notifyAboutLesson(pool, req.app.locals.channels, lesson);
    }
    res.json({ lesson });
  });

  router.get('/news', async (req, res) => {
    res.json({ news: await listNews(pool, {}) });
  });

  return router;
}
