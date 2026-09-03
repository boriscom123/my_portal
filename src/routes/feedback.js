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
import { notify } from '../services/notify/index.js';

/**
 * Адрес объекта, чтобы нажатие на уведомление открыло ту самую страницу, а не
 * главную. Для урока это его карточка, для идеи — борд.
 * Вызывается из разослатьОбОтзыве.
 */
async function objectUrl(pool, objectType, objectId) {
  if (objectType !== 'lesson') return '/ideas';
  const { rows } = await pool.query('SELECT slug FROM lessons WHERE id = $1', [objectId]);
  return rows.length ? `/lesson/${rows[0].slug}` : '/';
}

/**
 * Разбирает, кого затронул новый отзыв, и уведомляет их.
 *
 * Двое: автор отзыва, на который ответили, и автор портала — ему отзыв пришёл
 * на модерацию. Зачем в одной функции: оба уведомления рождаются из одного
 * события, и разнесённые по разным местам они разойдутся при первой же правке.
 * Себя не уведомляем ни в одной роли: человек знает, что он только что написал.
 * Вызывается из обработчика POST /api/comments.
 */
async function notifyAboutComment(pool, channels, comment, objectType, objectId) {
  const url = await objectUrl(pool, objectType, objectId);
  // Обрезаем: в уведомлении на телефоне длинный отзыв всё равно не покажут,
  // а тащить простыню через канал незачем.
  const excerpt = comment.body.slice(0, 200);

  if (comment.parentId) {
    const { rows } = await pool.query('SELECT user_id FROM comments WHERE id = $1', [
      comment.parentId
    ]);
    const recipient = rows.length ? Number(rows[0].user_id) : null;
    if (recipient && recipient !== comment.userId) {
      await notify(
        pool,
        {
          userId: recipient,
          kind: 'comment_reply',
          dedupKey: `comment:${comment.id}:reply:${recipient}`,
          title: 'Вам ответили',
          body: excerpt,
          url
        },
        channels
      );
    }
  }

  const { rows: admins } = await pool.query(`SELECT id FROM users WHERE role = 'admin'`);
  for (const { id } of admins) {
    if (Number(id) === comment.userId) continue;
    await notify(
      pool,
      {
        userId: Number(id),
        kind: 'comment_moderation',
        dedupKey: `comment:${comment.id}:moderation:${id}`,
        title: 'Отзыв на модерацию',
        body: excerpt,
        url
      },
      channels
    );
  }
}

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
    await notifyAboutComment(pool, req.app.locals.channels, comment, objectType, objectId);

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
