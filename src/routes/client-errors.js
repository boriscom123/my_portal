// Приём сбоев, которые видит только браузер.
//
// Задача — довести точный текст отказа до журнала сервера. Отказы вроде
// «подписка на уведомления не оформилась» происходят целиком на устройстве, и
// без этого маршрута о них можно узнать, только попросив человека пересказать
// сообщение по памяти.
//
// Зачем только для вошедших: на открытый маршрут полился бы мусор, а сбои,
// которые нам интересны, случаются как раз у вошедших.
// Подключается в src/app.js по префиксу /api.
import { Router } from 'express';
import { requireUser } from '../middleware/guards.js';

// Обрезаем: в журнал нужна причина, а не чужой стек на десять килобайт.
const MAX_MESSAGE = 500;

export function clientErrorRoutes() {
  const router = Router();

  router.post('/client-error', requireUser, (req, res) => {
    const where = String(req.body?.where ?? 'неизвестно').slice(0, 60);
    const message = String(req.body?.message ?? '').slice(0, MAX_MESSAGE);
    console.error(
      `Сбой у пользователя ${req.user.id} [${where}]: ${message} | ${req.get('user-agent')}`
    );
    res.json({ ok: true });
  });

  return router;
}
