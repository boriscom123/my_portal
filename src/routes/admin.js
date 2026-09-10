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
import {
  startPublication,
  publicationsFor,
  newsPublications,
  markPublicationState
} from '../services/publications.js';
import { assetsOfLesson } from '../services/media.js';
import { pickVideoAsset } from '../services/platforms/youtube-fields.js';
import { parseChaptersText } from '../lib/chapters.js';
import { saveNews, deleteNews, publishNews, getNewsBySlug } from '../services/news.js';
import {
  saveShort,
  publishShort,
  deleteShort,
  getShortBySlug,
  shortFromClip
} from '../services/shorts.js';
import {
  saveSeries,
  deleteSeries,
  setLessonSeries,
  moveLessonInSeries,
  getSeriesBySlug
} from '../services/series.js';
import { createTexts } from '../services/texts.js';
import { collectAnnouncements, forgetAnnouncements } from '../services/announcements.js';
import { listSources, addSource, removeSource, toggleSource } from '../services/news-sources.js';
import { youtubeAccessToken } from '../services/platforms/youtube-auth.js';
import { youtubeApp, channelApp } from '../services/platform-apps.js';
import { readVideoPrivacy } from '../services/platforms/youtube.js';

import { rebuildSubtitles } from '../services/transcript.js';
import { addJob, JOBS } from '../queue.js';

/** Теги строкой из формы — в список: «docker, vps» → ['docker', 'vps']. */
export function parseTags(value) {
  return String(value ?? '')
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

export function adminRoutes(config, pool, fetchImpl = fetch) {
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

    // Главы приходят текстом, по строке на главу: автор правит ровно то, что
    // увидит зритель в описании ролика. Строки без времени — не главы, и
    // молча делать их главами нельзя.
    if (typeof req.body.chapters === 'string') {
      await pool.query(
        `UPDATE lessons SET generated = jsonb_set(generated, '{chapters}', $1::jsonb) WHERE id = $2`,
        [JSON.stringify(parseChaptersText(req.body.chapters)), lesson.id]
      );
      lesson.chapters = parseChaptersText(req.body.chapters);
    }

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

  // Выкладка на YouTube отдельной кнопкой, а не вместе с публикацией на
  // портале: витрина и площадка живут своей жизнью, и отказ площадки не должен
  // мешать уроку появиться на сайте.
  router.post('/lessons/:slug/publish/youtube', async (req, res) => {
    const lesson = await getLessonBySlug(pool, req.params.slug, { includeDrafts: true });
    if (!lesson) throw new PublicError('Урок не найден', 404);

    const assets = await assetsOfLesson(pool, lesson.id);
    const video = pickVideoAsset(assets);
    if (!video) throw new PublicError('Записи нет в буфере — загрузите её заново', 400);

    const publication = await startPublication(pool, {
      lessonId: lesson.id,
      platform: 'youtube',
      assetId: video.id,
      // Режим берём в момент нажатия и записываем в строку публикации: шаг
      // очереди потом идёт по ней, а не по настройке, которая к его началу
      // могла и поменяться.
      mode: (await youtubeApp(pool, config)).mode
    });
    await addJob(req.app.locals.queue, JOBS.publishYoutube, {
      lessonId: lesson.id,
      publicationId: publication.id
    });
    res.json({ publicationId: publication.id, state: 'queued' });
  });

  // Анонс в канал. Кнопка на каждую площадку своя: у Telegram и MAX разные
  // настройки и разные отказы, и общий запуск скрыл бы, какая из них молчит.
  for (const [platform, job] of [
    ['telegram', JOBS.publishTelegram],
    ['max', JOBS.publishMax]
  ]) {
    router.post(`/lessons/:slug/publish/${platform}`, async (req, res) => {
      const lesson = await getLessonBySlug(pool, req.params.slug, { includeDrafts: true });
      if (!lesson) throw new PublicError('Урок не найден', 404);
      if (!lesson.coverUrl) {
        throw new PublicError('У урока нет обложки — без неё пост в ленте теряется', 400);
      }

      const app = await channelApp(pool, config, platform);
      if (!app.configured) {
        throw new PublicError(`Канал ${platform} не настроен — заполните его в настройках`, 400);
      }

      const publication = await startPublication(pool, {
        lessonId: lesson.id,
        platform,
        assetId: null,
        mode: 'auto'
      });
      await addJob(req.app.locals.queue, job, {
        lessonId: lesson.id,
        publicationId: publication.id
      });
      res.json({ publicationId: publication.id, state: 'queued' });
    });
  }

  // «Проверить»: автор открыл ролик в студии — спрашиваем площадку и снимаем
  // замок с ссылки в карточке. Опрашивать по расписанию незачем: это работа
  // ради одного нажатия раз в неделю.
  router.post('/lessons/:slug/publish/youtube/check', async (req, res) => {
    const lesson = await getLessonBySlug(pool, req.params.slug, { includeDrafts: true });
    if (!lesson) throw new PublicError('Урок не найден', 404);

    const publication = (await publicationsFor(pool, lesson.id)).find(
      (item) => item.platform === 'youtube'
    );
    if (!publication?.externalId) throw new PublicError('Ролик ещё не уехал на площадку', 400);

    const token = await youtubeAccessToken(pool, config, fetchImpl);
    if (!token) throw new PublicError('Канал YouTube не подключён', 400);

    const privacy = await readVideoPrivacy({
      token,
      videoId: publication.externalId,
      fetchImpl
    });
    const state = privacy === 'public' ? 'published' : publication.state;
    if (state !== publication.state) {
      await markPublicationState(pool, publication.id, { state });
      // Ролик стал виден зрителю — в постах каналов должна появиться ссылка на
      // него. Правкой уже отправленных постов, а не новыми.
      await addJob(req.app.locals.queue, JOBS.refreshChannels, { lessonId: lesson.id });
    }
    res.json({ state, privacy });
  });

  /**
   * Ставит урок в серию, заводя её на ходу, или вынимает оттуда.
   *
   * Заведение серии здесь, а не отдельным экраном: автор думает о серии ровно
   * в тот миг, когда готовит очередной урок, и уводить его за этим на другую
   * страницу значит прервать работу ради одной строки.
   */
  router.post('/lessons/:slug/series', async (req, res) => {
    const lesson = await getLessonBySlug(pool, req.params.slug, { includeDrafts: true });
    if (!lesson) throw new PublicError('Урок не найден', 404);

    const title = String(req.body?.title ?? '').trim();
    const wanted = String(req.body?.seriesSlug ?? '').trim();

    let series = null;
    if (title) {
      // Название важнее выбора из списка: человек вписал его последним.
      series = await saveSeries(pool, { title });
    } else if (wanted) {
      series = await getSeriesBySlug(pool, wanted, { includeDrafts: true });
      if (!series) throw new PublicError('Серия не найдена', 404);
    }

    const position = await setLessonSeries(pool, lesson.id, series?.id ?? null);
    res.json({ series: series ? { slug: series.slug, title: series.title } : null, position });
  });

  router.post('/series', async (req, res) => {
    try {
      const series = await saveSeries(pool, {
        slug: req.body?.slug ? String(req.body.slug) : null,
        title: String(req.body?.title ?? ''),
        description: String(req.body?.description ?? '')
      });
      if (!series) throw new PublicError('Серия не найдена', 404);
      res.json({ slug: series.slug, title: series.title });
    } catch (error) {
      if (error instanceof PublicError) throw error;
      throw new PublicError(error.message, 400);
    }
  });

  // Перестановка урока в серии. Стрелками: автор чаще всего у телефона, где
  // перетаскивание строки пальцем мучительно, а промах не виден до перезагрузки.
  router.post('/series/:slug/move', async (req, res) => {
    const direction = req.body?.direction === 'up' ? 'up' : 'down';
    const moved = await moveLessonInSeries(pool, String(req.body?.lessonSlug ?? ''), direction);
    // Край списка — не ошибка: кнопка там просто ничего не делает.
    res.json({ moved });
  });

  router.delete('/series/:slug', async (req, res) => {
    if (!(await deleteSeries(pool, req.params.slug))) {
      throw new PublicError('Серия не найдена', 404);
    }
    // Уроки остаются: серия — способ их разложить, а не хозяин записей.
    res.json({ ok: true });
  });

  /* --- Короткие вертикальные ролики --------------------------------------- */

  router.post('/shorts', async (req, res) => {
    try {
      const short = await saveShort(pool, {
        slug: req.body?.slug ? String(req.body.slug) : null,
        title: String(req.body?.title ?? ''),
        description: String(req.body?.description ?? '')
      });
      if (!short) throw new PublicError('Ролик не найден', 404);
      res.json({ slug: short.slug, title: short.title });
    } catch (error) {
      if (error instanceof PublicError) throw error;
      throw new PublicError(error.message, 400);
    }
  });

  /**
   * Делает роликом готовую нарезку урока.
   * Кнопка стоит на экране урока, рядом с самой нарезкой: решение принимается
   * там, где автор её смотрит.
   */
  router.post('/lessons/:slug/shorts', async (req, res) => {
    const lesson = await getLessonBySlug(pool, req.params.slug, { includeDrafts: true });
    if (!lesson) throw new PublicError('Урок не найден', 404);

    const assetId = Number(req.body?.assetId);
    const assets = await assetsOfLesson(pool, lesson.id);
    const clip = assets.find((asset) => asset.id === assetId && asset.kind === 'clip');
    if (!clip) throw new PublicError('Нарезка не найдена', 404);

    // Номер фрагмента — по его месту среди нарезок урока: «второй» понятнее
    // человеку, чем номер файла в учёте.
    const number = assets.filter((asset) => asset.kind === 'clip').indexOf(clip) + 1;
    const short = await shortFromClip(pool, {
      assetId: clip.id,
      lesson,
      title: `${lesson.title} — фрагмент ${number}`
    });
    if (!short) throw new PublicError('Из этой нарезки ролик уже сделан', 409);

    res.json({ slug: short.slug, title: short.title });
  });

  router.post('/shorts/:slug/publish', async (req, res) => {
    const short = await publishShort(pool, req.params.slug, req.body?.publish !== false);
    if (!short) throw new PublicError('Ролик не найден', 404);
    if (short.status === 'published' && !short.assetId) {
      // Выпуск ролика без файла показал бы зрителю пустой плеер.
      await publishShort(pool, req.params.slug, false);
      throw new PublicError('У ролика нет файла — сначала загрузите его', 400);
    }
    res.json({ slug: short.slug, status: short.status, publishedAt: short.publishedAt });
  });

  for (const [platform, job] of [
    ['telegram', JOBS.publishTelegram],
    ['max', JOBS.publishMax]
  ]) {
    router.post(`/shorts/:slug/publish/${platform}`, async (req, res) => {
      const short = await getShortBySlug(pool, req.params.slug);
      if (!short) throw new PublicError('Ролик не найден', 404);
      if (short.status !== 'published') {
        throw new PublicError('Ролик ещё черновик — сначала опубликуйте его', 400);
      }

      const app = await channelApp(pool, config, platform);
      if (!app.configured) {
        throw new PublicError(`Канал ${platform} не настроен — заполните его в настройках`, 400);
      }

      const publication = await startPublication(pool, {
        shortId: short.id,
        platform,
        mode: 'auto'
      });
      await addJob(req.app.locals.queue, job, {
        shortId: short.id,
        publicationId: publication.id
      });
      res.json({ publicationId: publication.id, state: 'queued' });
    });
  }

  router.delete('/shorts/:slug', async (req, res) => {
    if (!(await deleteShort(pool, req.params.slug))) {
      throw new PublicError('Ролик не найден', 404);
    }
    // Свои файлы уходят с ним по внешнему ключу; нарезка остаётся у урока.
    res.json({ ok: true });
  });

  // Новости заводятся и правятся одним маршрутом: разделять их значило бы
  // разложить одно действие автора — «сохранить» — по двум адресам.
  router.post('/news', async (req, res) => {
    const item = await saveNews(pool, {
      slug: req.body?.slug ? String(req.body.slug) : null,
      title: String(req.body?.title ?? ''),
      body: String(req.body?.body ?? '')
    });
    if (!item) throw new PublicError('Новость не найдена', 404);
    res.json({ slug: item.slug, title: item.title });
  });

  // Свежие анонсы официальных источников: автор выбирает подходящий и пишет о
  // нём новость. Сбор идёт на сервере — чужие ленты из браузера не читаются.
  router.get('/news/announcements', async (req, res) => {
    const { items, failed, cached } = await collectAnnouncements(pool, { fetchImpl });
    res.json({
      items: items.map((item) => ({
        source: item.source,
        title: item.title,
        // Краткое описание от самого источника: по нему модель пишет текст, не
        // выдумывая подробностей, которых в заголовке нет.
        summary: item.summary ?? '',
        url: item.url,
        publishedAt: item.publishedAt
      })),
      // Источники, которые не ответили, называем поимённо: неполный список
      // молча — это враньё, будто у них нет новостей.
      failed,
      cached
    });
  });

  // Список источников правит автор: сегодня их девять, завтра появится NVIDIA.
  router.get('/news/sources', async (req, res) => {
    res.json({ sources: await listSources(pool) });
  });

  router.post('/news/sources', async (req, res) => {
    try {
      const source = await addSource(pool, { title: req.body?.title, url: req.body?.url });
      // Список поменялся — запомненные анонсы устарели.
      forgetAnnouncements();
      res.json({ source });
    } catch (error) {
      throw new PublicError(error.message, 400);
    }
  });

  router.post('/news/sources/:id/toggle', async (req, res) => {
    await toggleSource(pool, req.params.id, req.body?.enabled !== false);
    forgetAnnouncements();
    res.json({ ok: true });
  });

  router.delete('/news/sources/:id', async (req, res) => {
    if (!(await removeSource(pool, req.params.id))) {
      throw new PublicError('Источник не найден', 404);
    }
    forgetAnnouncements();
    res.json({ ok: true });
  });

  // Текст новости по её заголовку. Синхронно, в отличие от текстов урока: там
  // модель читает часовую расшифровку и отвечает за минуту с лишним, а здесь
  // весь материал — одна строка, и ответ приходит за секунды.
  router.post('/news/suggest', async (req, res) => {
    const title = String(req.body?.title ?? '').trim();
    if (!title) throw new PublicError('Сначала напишите заголовок', 400);
    // Материал от источника, если новость выбрана из анонсов: с ним текст
    // получается о деле, а не о названии.
    const source = {
      summary: String(req.body?.summary ?? '').slice(0, 1000),
      url: String(req.body?.url ?? '').slice(0, 500)
    };

    const texts = createTexts(config, fetchImpl);
    if (!texts) throw new PublicError('Модель не подключена: нет ключа в настройках сервера', 503);

    try {
      const { body } = await texts.suggestNews(title, source);
      res.json({ body });
    } catch (error) {
      // Отказ модели — не поломка портала: автор напишет текст сам, и сказать
      // ему надо именно это, а не показать чужую ошибку целиком.
      throw new PublicError(`Модель не ответила: ${error.message}`, 502);
    }
  });

  // Запрос для рисовальщика: картинку автор рисует сам, в стороннем
  // рисовальщике, и ему нужен готовый текст запроса, а не совет.
  router.post('/news/image-prompt', async (req, res) => {
    const title = String(req.body?.title ?? '').trim();
    if (!title) throw new PublicError('Сначала напишите заголовок', 400);

    const texts = createTexts(config, fetchImpl);
    if (!texts) throw new PublicError('Модель не подключена: нет ключа в настройках сервера', 503);

    try {
      const { prompt } = await texts.suggestImagePrompt(title, String(req.body?.body ?? ''));
      res.json({ prompt });
    } catch (error) {
      throw new PublicError(`Модель не ответила: ${error.message}`, 502);
    }
  });

  // Выпуск новости в свет. Отдельным нажатием, а не при сохранении: автор
  // пишет её в несколько заходов, и каждое «сохранить» не должно звать читателя.
  router.post('/news/:slug/publish', async (req, res) => {
    const item = await publishNews(pool, req.params.slug, req.body?.publish !== false);
    if (!item) throw new PublicError('Новость не найдена', 404);
    res.json({ slug: item.slug, status: item.status, publishedAt: item.publishedAt });
  });

  // Пост о новости в канал. Кнопка на площадку своя — как и у урока: у Telegram
  // и MAX разные настройки и разные отказы.
  for (const [platform, job] of [
    ['telegram', JOBS.publishTelegram],
    ['max', JOBS.publishMax]
  ]) {
    router.post(`/news/:slug/publish/${platform}`, async (req, res) => {
      const item = await getNewsBySlug(pool, req.params.slug);
      if (!item) throw new PublicError('Новость не найдена', 404);
      if (item.status !== 'published') {
        throw new PublicError('Новость ещё черновик — сначала опубликуйте её', 400);
      }

      const app = await channelApp(pool, config, platform);
      if (!app.configured) {
        throw new PublicError(`Канал ${platform} не настроен — заполните его в настройках`, 400);
      }

      const publication = await startPublication(pool, {
        newsId: item.id,
        platform,
        mode: 'auto'
      });
      await addJob(req.app.locals.queue, job, {
        newsId: item.id,
        publicationId: publication.id
      });
      res.json({ publicationId: publication.id, state: 'queued' });
    });
  }

  // Правка уже отправленного поста. Отдельным нажатием, а не при каждом
  // сохранении новости: автор правит её в несколько заходов, и каждый заход не
  // должен ходить в чужие каналы.
  router.post('/news/:slug/publish/:platform/refresh', async (req, res) => {
    const platform = req.params.platform;
    if (!['telegram', 'max'].includes(platform)) {
      throw new PublicError('Неизвестная площадка', 400);
    }

    const item = await getNewsBySlug(pool, req.params.slug);
    if (!item) throw new PublicError('Новость не найдена', 404);

    const publication = (await newsPublications(pool, item.id)).find(
      (post) => post.platform === platform
    );
    if (!publication || publication.state !== 'published') {
      throw new PublicError('В этот канал пост ещё не уходил — сначала отправьте его', 400);
    }

    await addJob(req.app.locals.queue, JOBS.refreshPost, {
      newsId: item.id,
      publicationId: publication.id
    });
    res.json({ publicationId: publication.id });
  });

  router.delete('/news/:slug', async (req, res) => {
    if (!(await deleteNews(pool, req.params.slug))) {
      throw new PublicError('Новость не найдена', 404);
    }
    // Картинки уходят вместе с ней: в учёте по внешнему ключу, с диска — при
    // ближайшей уборке, как и всё остальное осиротевшее.
    res.json({ ok: true });
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

  // Что сейчас с уроком. Нужен странице загрузки: копирование гигабайта идёт
  // минуты, и без опроса кнопка молчит, а человек жмёт её второй раз.
  router.get('/lessons/:slug/state', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT pipeline_state, pipeline_error, source_asset_id FROM lessons WHERE slug = $1`,
      [req.params.slug]
    );
    if (!rows[0]) throw new PublicError('Урок не найден', 404);
    res.json({
      state: rows[0].pipeline_state,
      error: rows[0].pipeline_error,
      hasSource: Boolean(rows[0].source_asset_id)
    });
  });

  // Запустить обработку загруженной записи: звук, расшифровка, субтитры,
  // монтаж, обложка. Отдельным действием от загрузки, потому что загрузка —
  // это копирование файла на сайт, а обработка занимает у машины полчаса.
  // Сразу после копирования её запускать нельзя: сперва автор убеждается, что
  // скопировалась нужная запись.
  router.post('/lessons/:slug/process', async (req, res) => {
    const lesson = await getLessonBySlug(pool, req.params.slug, { includeDrafts: true });
    if (!lesson) throw new PublicError('Урок не найден', 404);
    if (!req.app.locals.queue) throw new PublicError('Очередь недоступна', 503);
    if (['uploading', 'processing'].includes(lesson.pipelineState)) {
      throw new PublicError('Урок уже обрабатывается. Дождитесь окончания', 409);
    }

    const { rows } = await pool.query(
      `SELECT source_asset_id FROM lessons WHERE id = $1`,
      [lesson.id]
    );
    if (!rows[0]?.source_asset_id) {
      throw new PublicError('Записи ещё нет: сначала загрузите её', 409);
    }

    await pool.query(
      `UPDATE lessons SET pipeline_state = 'processing', pipeline_error = NULL, pipeline_job = NULL
        WHERE id = $1`,
      [lesson.id]
    );
    await addJob(req.app.locals.queue, 'extractAudio', { lessonId: lesson.id });
    res.json({ started: true });
  });

  // Взять кадр из записи на обложку. Отдельным действием, как и всё
  // остальное: конвейер больше не тянет за собой то, о чём автора не спросили.
  router.post('/lessons/:slug/cover-frame', async (req, res) => {
    const lesson = await getLessonBySlug(pool, req.params.slug, { includeDrafts: true });
    if (!lesson) throw new PublicError('Урок не найден', 404);
    if (!req.app.locals.queue) throw new PublicError('Очередь недоступна', 503);
    if (['uploading', 'processing'].includes(lesson.pipelineState)) {
      throw new PublicError('Сейчас идёт другая работа. Дождитесь окончания', 409);
    }
    if (!lesson.sourceAssetId) throw new PublicError('Записи ещё нет: сначала загрузите её', 409);

    await pool.query(
      `UPDATE lessons SET pipeline_state = 'processing', pipeline_error = NULL WHERE id = $1`,
      [lesson.id]
    );
    await addJob(req.app.locals.queue, 'makeCover', { lessonId: lesson.id });
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
