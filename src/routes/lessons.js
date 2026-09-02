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
    const объект = { objectType: 'lesson', objectId: lesson.id };
    lesson.reactions = await countReactions(pool, объект);
    lesson.rating = await ratingSummary(pool, объект);
    res.json({ lesson });
  });

  router.put('/lessons/:slug', requireAdmin, async (req, res) => {
    const lesson = await saveLesson(pool, { ...req.body, slug: req.params.slug });
    if (Array.isArray(req.body.tags)) {
      await setLessonTags(pool, lesson.id, req.body.tags);
      lesson.tags = [...req.body.tags].sort();
    }
    res.json({ lesson });
  });

  router.get('/news', async (req, res) => {
    res.json({ news: await listNews(pool, {}) });
  });

  return router;
}
