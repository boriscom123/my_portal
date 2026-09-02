// API обратной связи. Задача — принять реакцию и комментарий от вошедшего и
// отдать список тех комментариев, которые смотрящему положено видеть.
// Ни одно правило видимости здесь не решается: это работа services/feedback.js.
// Подключается в src/app.js по префиксу /api.
import { Router } from 'express';
import {
  setReaction,
  removeReaction,
  addComment,
  listComments,
  moderateComment
} from '../services/feedback.js';
import { requireUser, requireAdmin } from '../middleware/guards.js';

export function feedbackRoutes(config, pool) {
  const router = Router();

  router.post('/reactions', requireUser, async (req, res) => {
    const { objectType, objectId, kind } = req.body ?? {};
    await setReaction(pool, { userId: req.user.id, objectType, objectId, kind });
    res.json({ ok: true });
  });

  router.delete('/reactions', requireUser, async (req, res) => {
    const { objectType, objectId } = req.body ?? {};
    await removeReaction(pool, { userId: req.user.id, objectType, objectId });
    res.json({ ok: true });
  });

  router.get('/comments', async (req, res) => {
    const comments = await listComments(pool, {
      objectType: String(req.query.objectType),
      objectId: Number(req.query.objectId),
      viewerId: req.user?.id ?? null,
      isAdmin: req.user?.role === 'admin'
    });
    res.json({ comments });
  });

  router.post('/comments', requireUser, async (req, res) => {
    const { objectType, objectId, parentId, body } = req.body ?? {};
    const comment = await addComment(pool, {
      userId: req.user.id,
      objectType,
      objectId,
      parentId: parentId ?? null,
      body
    });
    // 201: комментарий создан, но опубликован не сразу — клиент должен
    // показать «ждёт проверки», а не сделать вид, что он уже в ленте.
    res.status(201).json({ comment });
  });

  router.post('/comments/:id/moderate', requireAdmin, async (req, res) => {
    await moderateComment(pool, { commentId: Number(req.params.id), status: req.body?.status });
    res.json({ ok: true });
  });

  return router;
}
