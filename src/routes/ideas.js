// API борда идей. Задача — принять идею и голос от вошедшего, дать автору
// портала менять статус и не забыть уведомить тех, кто голосовал. Зачем
// уведомление живёт здесь, а не в сервисе: сервис не знает про каналы, а
// маршрут знает — каналы лежат в app.locals.
// Подключается в src/app.js по префиксу /api.
import { Router } from 'express';
import { createIdea, listIdeas, voteIdea, unvoteIdea, setIdeaStatus } from '../services/ideas.js';
import { notify } from '../services/notify/index.js';
import { requireUser, requireAdmin } from '../middleware/guards.js';

// Что человек прочитает в уведомлении о смене статуса. Слово «accepted» на
// экране телефона не объясняет ничего.
const STATUS_LABELS = {
  new: 'снова открыта',
  accepted: 'принята в работу',
  in_progress: 'уже снимается',
  released: 'вышла уроком'
};

export function ideaRoutes(config, pool) {
  const router = Router();

  router.get('/ideas', async (req, res) => {
    const ideas = await listIdeas(pool, {
      status: req.query.status ? String(req.query.status) : null,
      viewerId: req.user?.id ?? null
    });
    res.json({ ideas });
  });

  router.post('/ideas', requireUser, async (req, res) => {
    const idea = await createIdea(pool, {
      userId: req.user.id,
      title: req.body?.title,
      body: req.body?.body
    });
    res.status(201).json({ idea });
  });

  router.post('/ideas/:id/vote', requireUser, async (req, res) => {
    await voteIdea(pool, { ideaId: Number(req.params.id), userId: req.user.id });
    res.json({ ok: true });
  });

  router.delete('/ideas/:id/vote', requireUser, async (req, res) => {
    await unvoteIdea(pool, { ideaId: Number(req.params.id), userId: req.user.id });
    res.json({ ok: true });
  });

  router.post('/ideas/:id/status', requireAdmin, async (req, res) => {
    const { idea, voterIds } = await setIdeaStatus(pool, {
      ideaId: Number(req.params.id),
      status: req.body?.status,
      lessonSlug: req.body?.lessonSlug ?? null
    });

    for (const userId of voterIds) {
      await notify(
        pool,
        {
          userId,
          kind: 'idea_status',
          // Ключ включает статус: каждая смена уведомляет один раз, а повтор
          // того же статуса — ни разу.
          dedupKey: `idea:${idea.id}:${idea.status}:${userId}`,
          title: `Идея ${STATUS_LABELS[idea.status]}`,
          body: idea.title,
          // Вышедшую идею ведём сразу на урок: человек голосовал за тему, и
          // ему нужен урок, а не строчка в списке.
          url: idea.lessonSlug ? `/lesson/${idea.lessonSlug}` : '/ideas'
        },
        req.app.locals.channels
      );
    }

    res.json({ idea });
  });

  return router;
}
