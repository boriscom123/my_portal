// Защиты маршрутов. Задача — одной строкой в маршруте сказать «сюда только
// вошедшим» или «сюда только автору». Зачем отдельным файлом: проверка прав,
// размазанная по обработчикам, однажды окажется забытой в одном из них.
// Вызывается из src/routes/*.js.
import { PublicError } from './errors.js';

/**
 * Пускает только вошедших. Это и есть выполнение требования спеки «гость
 * отзыв отправить не может»: все маршруты записи закрыты ею.
 */
export function requireUser(req, res, next) {
  if (!req.user) throw new PublicError('Нужно войти', 401);
  next();
}

/** Пускает только администратора. Автор портала один. */
export function requireAdmin(req, res, next) {
  if (!req.user) throw new PublicError('Нужно войти', 401);
  if (req.user.role !== 'admin') throw new PublicError('Недостаточно прав', 403);
  next();
}
