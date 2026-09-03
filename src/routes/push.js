// Подписка на Web Push. Задача — принять от браузера адрес его канала пушей и
// запомнить его за человеком. Зачем ключ отдаётся отдельным маршрутом: браузер
// требует публичный ключ VAPID до оформления подписки, а вшивать его в HTML
// незачем — он меняется вместе с перевыпуском ключей.
// Подключается в src/app.js по префиксу /api/push.
import { Router } from 'express';
import { requireUser } from '../middleware/guards.js';

export function pushRoutes(config, pool) {
  const router = Router();

  router.get('/key', (req, res) => {
    // Пустая строка, если пуши не настроены: клиент по ней понимает, что
    // предлагать подписку не нужно, и не показывает мёртвую кнопку.
    res.json({ key: config.vapid?.publicKey ?? '' });
  });

  router.post('/subscribe', requireUser, async (req, res) => {
    const { endpoint, keys } = req.body ?? {};
    // Один и тот же endpoint может смениться владельцем — например, телефон
    // передали другому человеку. Тогда подписка переезжает, а не двоится.
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id,
                                            p256dh = EXCLUDED.p256dh,
                                            auth = EXCLUDED.auth`,
      [req.user.id, endpoint, keys?.p256dh, keys?.auth]
    );
    res.json({ ok: true });
  });

  router.post('/unsubscribe', requireUser, async (req, res) => {
    // Условие по user_id обязательно: без него любой вошедший смог бы
    // отписать чужое устройство, зная его адрес.
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [
      req.body?.endpoint,
      req.user.id
    ]);
    res.json({ ok: true });
  });

  return router;
}
