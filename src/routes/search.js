// API поиска. Задача — отдать находки клиенту, который ищет без перезагрузки
// страницы. Логика живёт в src/services/search.js: здесь только разбор запроса.
// Подключается в src/app.js по префиксу /api.
import { Router } from 'express';
import { searchSegments } from '../services/search.js';

export function searchRoutes(config, pool) {
  const router = Router();

  router.get('/search', async (req, res) => {
    res.json({ results: await searchSegments(pool, req.query.q) });
  });

  return router;
}
