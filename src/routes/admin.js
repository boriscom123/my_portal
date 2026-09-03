// Действия автора над уроком: публикация после проверки и повтор упавшего шага.
//
// Задача — два действия, которых не должно быть ни у кого, кроме автора.
// Зачем отдельным файлом, а не в routes/lessons.js: там API витрины, которое
// читают все, а здесь то, что меняет судьбу урока, и смешивать их — верный
// способ однажды забыть requireAdmin на одном из обработчиков.
// Подключается в src/app.js по префиксу /api/admin.
import { Router } from 'express';
import { requireAdmin } from '../middleware/guards.js';
import { PublicError } from '../middleware/errors.js';
import { saveLesson, setLessonTags, getLessonBySlug } from '../services/lessons.js';
import { notifyAboutLesson } from '../services/notify/lesson.js';

/** Теги строкой из формы — в список: «docker, vps» → ['docker', 'vps']. */
export function parseTags(value) {
  return String(value ?? '')
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

export function adminRoutes(config, pool) {
  const router = Router();
  router.use(requireAdmin);

  // Проверка пройдена: заголовок и описание — те, что написал автор, а не
  // те, что достались от имени файла.
  router.post('/lessons/:slug/approve', async (req, res) => {
    const current = await getLessonBySlug(pool, req.params.slug, { includeDrafts: true });
    if (!current) throw new PublicError('Урок не найден', 404);

    const title = String(req.body.title ?? '').trim();
    if (!title) throw new PublicError('Заголовок пустой', 400);

    const publish = req.body.publish === true;
    const lesson = await saveLesson(pool, {
      slug: current.slug,
      title,
      description: String(req.body.description ?? ''),
      status: publish ? 'published' : 'draft',
      // Дату публикации ставим один раз: повторное сохранение не должно
      // поднимать урок наверх ленты как новый.
      publishedAt: publish ? (current.publishedAt ?? new Date()) : null
    });

    if (Array.isArray(req.body.tags) || typeof req.body.tags === 'string') {
      const tags = Array.isArray(req.body.tags) ? req.body.tags : parseTags(req.body.tags);
      await setLessonTags(pool, lesson.id, tags);
      lesson.tags = [...tags].sort();
    }

    // Проверка пройдена — конвейеру здесь больше делать нечего.
    await pool.query(
      `UPDATE lessons SET pipeline_state = 'idle', pipeline_error = NULL, pipeline_job = NULL
        WHERE id = $1`,
      [lesson.id]
    );

    if (publish) await notifyAboutLesson(pool, req.app.locals.channels, lesson);
    res.json({ lesson, published: publish });
  });

  // Повтор упавшего шага. Ставится ровно та задача, что упала, с теми же
  // данными: шаг «забрать с Диска» без пути к файлу повторить нельзя, а
  // угадывать имя шага по тексту ошибки — способ однажды запустить не тот.
  router.post('/lessons/:slug/retry', async (req, res) => {
    const { rows } = await pool.query(
      'SELECT id, pipeline_job FROM lessons WHERE slug = $1',
      [req.params.slug]
    );
    if (!rows[0]) throw new PublicError('Урок не найден', 404);

    const job = rows[0].pipeline_job;
    if (!job?.name) throw new PublicError('Повторять нечего: упавший шаг не записан', 409);
    if (!req.app.locals.queue) throw new PublicError('Очередь недоступна', 503);

    await pool.query(
      `UPDATE lessons SET pipeline_state = 'processing', pipeline_error = NULL WHERE id = $1`,
      [rows[0].id]
    );
    await req.app.locals.queue.add(job.name, job.data ?? { lessonId: Number(rows[0].id) });
    res.json({ step: job.name });
  });

  return router;
}
