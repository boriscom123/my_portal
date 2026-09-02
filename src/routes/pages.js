// Серверные страницы. Задача — отдать поисковику и мессенджеру готовый HTML с
// тегами превью; вся живая логика идёт отдельно, через JSON API.
// Подключается в src/app.js после маршрутов API.
import { Router } from 'express';
import { loginPage } from '../views/login.js';
import { stubPage } from '../views/stub.js';

/**
 * Текущий пользователь для шаблона: только имя и роль.
 * Зачем отдельной функцией: то же самое нужно каждой странице, а тащить в
 * шаблон весь req незачем — вид не должен знать про HTTP.
 * Вызывается из обработчиков этого файла.
 */
async function текущийПользователь(pool, req) {
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
    const user = await текущийПользователь(pool, req);
    res.type('html').send(stubPage(config, user));
  });

  router.get('/login', async (req, res) => {
    const user = await текущийПользователь(pool, req);
    res.type('html').send(loginPage({ config, user }));
  });

  return router;
}
