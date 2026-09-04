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
import { createLesson, deleteLesson } from '../services/lesson-admin.js';
import { notifyAboutLesson } from '../services/notify/lesson.js';
import { rm } from 'node:fs/promises';
import { mediaPath, forgetAsset } from '../services/media.js';
import { readSettings } from '../lib/settings.js';

import { rebuildSubtitles } from '../services/transcript.js';
import { addJob } from '../queue.js';

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

  // Настройки подготовки урока: вид подписей и монтаж. Значения приходят от
  // человека и попадают в аргументы ffmpeg, поэтому проверяются в
  // readSettings, а не по дороге.
  router.post('/lessons/:slug/settings', async (req, res) => {
    const settings = readSettings(req.body);
    const { rows } = await pool.query(
      'UPDATE lessons SET settings = $1::jsonb WHERE slug = $2 RETURNING id, pipeline_state',
      [JSON.stringify(settings), req.params.slug]
    );
    if (!rows[0]) throw new PublicError('Урок не найден', 404);

    // Выключенной кнопки мало: страница могла быть открыта до начала сборки, а
    // запрос можно послать и мимо неё. Отказ живёт на сервере, где состояние
    // известно наверняка.
    if (req.body.rebuild === true && ['uploading', 'processing'].includes(rows[0].pipeline_state)) {
      throw new PublicError(
        'Пересборка уже идёт. Дождитесь её окончания: вторая заняла бы те же ядра и обогнала бы первую.',
        409
      );
    }

    // Пересборка — по отдельной просьбе: она занимает у машины полчаса, и
    // запускать её при каждом сохранении настроек нельзя.
    if (req.body.rebuild === true) {
      if (!req.app.locals.queue) throw new PublicError('Очередь недоступна', 503);
      await pool.query(
        `UPDATE lessons SET pipeline_state = 'processing', pipeline_error = NULL WHERE id = $1`,
        [rows[0].id]
      );
      await addJob(req.app.locals.queue, 'trimPauses', { lessonId: Number(rows[0].id) });
    }

    res.json({ settings, rebuilding: req.body.rebuild === true });
  });

  // Правка титров. Распознавание ошибается в именах и терминах, и правит их
  // автор — здесь же, а не перезаписью субтитров руками в скачанном файле.
  router.post('/lessons/:slug/transcript', async (req, res) => {
    const lesson = await getLessonBySlug(pool, req.params.slug, { includeDrafts: true });
    if (!lesson) throw new PublicError('Урок не найден', 404);

    const edits = Array.isArray(req.body?.segments) ? req.body.segments : [];
    if (!edits.length) throw new PublicError('Нечего сохранять', 400);

    let changed = 0;
    for (const edit of edits) {
      const text = String(edit?.text ?? '').trim();
      // Пустая реплика — это дыра в субтитрах на её месте; такую правку не
      // принимаем, удалять реплику надо не так.
      if (!text) continue;
      const { rowCount } = await pool.query(
        `UPDATE transcript_segments SET text = $1
          WHERE id = $2 AND lesson_id = $3 AND text <> $1`,
        [text, Number(edit.id), lesson.id]
      );
      changed += rowCount;
    }

    // Субтитры пересобираются сразу: иначе автор правит титры, скачивает файл
    // и получает старый текст.
    const files = changed ? await rebuildSubtitles(config, pool, lesson.id) : [];
    res.json({ changed, files });
  });

  // Заготовка заголовка, описания и тегов. Не применяется сама: последнее
  // слово за автором, поля он правит перед сохранением.
  router.get('/lessons/:slug/suggest', async (req, res) => {
    const lesson = await getLessonBySlug(pool, req.params.slug, { includeDrafts: true });
    if (!lesson) throw new PublicError('Урок не найден', 404);

    const { rows } = await pool.query('SELECT text FROM transcripts WHERE lesson_id = $1', [
      lesson.id
    ]);
    if (!rows.length) throw new PublicError('Расшифровки ещё нет', 409);

    // Готовая заготовка, если её уже посчитали.
    const { rows: lessons } = await pool.query(
      `SELECT generated->'suggested' AS suggested FROM lessons WHERE id = $1`,
      [lesson.id]
    );
    if (lessons[0]?.suggested) {
      res.json(lessons[0].suggested);
      return;
    }
    // Иначе ждём: считает воркер, потому что модель на бесплатной доле
    // отвечает дольше, чем живёт запрос через nginx.
    res.json({ pending: true });
  });

  // Запуск заготовки. Отдельным запросом от чтения: ответ модели приходит
  // через минуту, а запрос столько не живёт — измерено, nginx рвёт на
  // шестидесяти секундах.
  router.post('/lessons/:slug/suggest', async (req, res) => {
    const lesson = await getLessonBySlug(pool, req.params.slug, { includeDrafts: true });
    if (!lesson) throw new PublicError('Урок не найден', 404);
    if (!req.app.locals.queue) throw new PublicError('Очередь недоступна', 503);

    const { rows } = await pool.query('SELECT 1 FROM transcripts WHERE lesson_id = $1', [lesson.id]);
    if (!rows.length) throw new PublicError('Расшифровки ещё нет', 409);

    // Прошлую заготовку убираем: иначе клиент, спрашивая готовность, получит
    // её и решит, что новая готова.
    await pool.query(`UPDATE lessons SET generated = generated - 'suggested' WHERE id = $1`, [
      lesson.id
    ]);
    await addJob(req.app.locals.queue, 'suggestTexts', { lessonId: lesson.id });
    res.json({ started: true });
  });

  // Нарисовать обложку моделью. Очередью, как и тексты: рисование идёт минуту
  // с лишним, а запрос через nginx рвётся на шестидесяти секундах.
  router.post('/lessons/:slug/cover-image', async (req, res) => {
    const lesson = await getLessonBySlug(pool, req.params.slug, { includeDrafts: true });
    if (!lesson) throw new PublicError('Урок не найден', 404);
    if (!lesson.title) throw new PublicError('Сначала нужен заголовок — по нему и рисуем', 409);
    if (!req.app.locals.queue) throw new PublicError('Очередь недоступна', 503);

    // Прошлый отказ убираем: иначе он покажется как ответ на новое нажатие.
    await pool.query(`UPDATE lessons SET generated = generated - 'sideError' WHERE id = $1`, [
      lesson.id
    ]);
    await addJob(req.app.locals.queue, 'makeCoverImage', { lessonId: lesson.id });
    res.json({ started: true });
  });

  // Собрать вертикальные ролики. Отдельным действием, а не шагом конвейера:
  // ролики вшивают подписи внутрь видео, и до правки титров резать их значит
  // резать дважды — а это минуты машины на каждый заход.
  router.post('/lessons/:slug/clips', async (req, res) => {
    const lesson = await getLessonBySlug(pool, req.params.slug, { includeDrafts: true });
    if (!lesson) throw new PublicError('Урок не найден', 404);
    if (!req.app.locals.queue) throw new PublicError('Очередь недоступна', 503);
    if (['uploading', 'processing'].includes(lesson.pipelineState)) {
      throw new PublicError('Урок сейчас обрабатывается. Дождитесь окончания', 409);
    }

    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM transcript_segments WHERE lesson_id = $1',
      [lesson.id]
    );
    if (!rows[0].n) {
      throw new PublicError('Нарезать нечего: расшифровки у урока нет', 409);
    }

    await pool.query(
      `UPDATE lessons SET pipeline_state = 'processing', pipeline_error = NULL WHERE id = $1`,
      [lesson.id]
    );
    await addJob(req.app.locals.queue, 'makeClips', { lessonId: lesson.id });
    res.json({ started: true });
  });

  // Выбор обложки из тех, что уже есть: кадр из записи или нарисованная.
  // Отдельным действием, потому что перерисовывать ради возврата к кадру —
  // это минута работы машины вместо одного нажатия.
  router.post('/lessons/:slug/cover/:assetId', async (req, res) => {
    const lesson = await getLessonBySlug(pool, req.params.slug, { includeDrafts: true });
    if (!lesson) throw new PublicError('Урок не найден', 404);

    // Сверяем и урок, и вид файла: иначе обложкой можно было бы назначить
    // исходник чужого урока.
    const { rows } = await pool.query(
      `SELECT id FROM assets WHERE id = $1 AND lesson_id = $2 AND kind = 'cover'`,
      [Number(req.params.assetId), lesson.id]
    );
    if (!rows[0]) throw new PublicError('Такой обложки у урока нет', 404);

    await pool.query('UPDATE lessons SET cover_url = $1 WHERE id = $2', [
      `/media/asset/${rows[0].id}`,
      lesson.id
    ]);
    res.json({ coverUrl: `/media/asset/${rows[0].id}` });
  });

  // Удаление обложки: загрузили не то — убрали, а не живите с этим.
  router.delete('/lessons/:slug/cover/:assetId', async (req, res) => {
    const lesson = await getLessonBySlug(pool, req.params.slug, { includeDrafts: true });
    if (!lesson) throw new PublicError('Урок не найден', 404);

    // Сверяем и урок, и вид файла: иначе этим маршрутом можно было бы удалить
    // исходник своего урока или обложку чужого.
    const { rows } = await pool.query(
      `SELECT id, path FROM assets WHERE id = $1 AND lesson_id = $2 AND kind = 'cover'`,
      [Number(req.params.assetId), lesson.id]
    );
    if (!rows[0]) throw new PublicError('Такой обложки у урока нет', 404);

    // force: true — файла может уже не быть, а запись в учёте всё равно должна
    // уйти: иначе на экране останется обложка, которой нет.
    await rm(mediaPath(config, rows[0].path), { force: true });
    await forgetAsset(pool, Number(rows[0].id));

    // Если удалили выбранную, ставим любую из оставшихся: карточка урока с
    // ссылкой на удалённый файл показывала бы битую картинку.
    const { rows: rest } = await pool.query(
      `SELECT id FROM assets WHERE lesson_id = $1 AND kind = 'cover' ORDER BY id DESC LIMIT 1`,
      [lesson.id]
    );
    const wasChosen = lesson.coverUrl === `/media/asset/${rows[0].id}`;
    if (wasChosen) {
      await pool.query('UPDATE lessons SET cover_url = $1 WHERE id = $2', [
        rest[0] ? `/media/asset/${rest[0].id}` : null,
        lesson.id
      ]);
    }

    res.json({ removed: Number(rows[0].id), coverUrl: wasChosen && rest[0] ? `/media/asset/${rest[0].id}` : lesson.coverUrl });
  });

  // Завести урок. Адрес собирается из заголовка: помнить и придумывать его
  // автору незачем, а поправить можно потом.
  router.post('/lessons', async (req, res) => {
    try {
      const lesson = await createLesson(pool, req.body ?? {});
      res.json({ lesson });
    } catch (error) {
      throw new PublicError(error.message, 400);
    }
  });

  // Удалить урок целиком. Действие необратимое: вместе с уроком уходят его
  // файлы, расшифровка, отзывы и записи о публикациях.
  router.delete('/lessons/:slug', async (req, res) => {
    const lesson = await getLessonBySlug(pool, req.params.slug, { includeDrafts: true });
    if (!lesson) throw new PublicError('Урок не найден', 404);
    // Опубликованный урок сносить не даём: на него уже могут вести ссылки с
    // площадок, и удалять его надо осознанно — сначала снять с публикации.
    if (lesson.status === 'published') {
      throw new PublicError('Урок опубликован. Сначала снимите его с витрины, потом удаляйте', 409);
    }

    const result = await deleteLesson(config, pool, lesson.id);
    res.json(result);
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
    await addJob(req.app.locals.queue, job.name, job.data ?? { lessonId: Number(rows[0].id) });
    res.json({ step: job.name });
  });

  return router;
}
