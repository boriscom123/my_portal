// Серверные страницы. Задача — отдать поисковику и мессенджеру готовый HTML с
// тегами превью; вся живая логика идёт отдельно, через JSON API.
// Подключается в src/app.js после маршрутов API.
import { Router } from 'express';
import { loginPage } from '../views/login.js';
import { stubPage } from '../views/stub.js';
import { offlinePage } from '../views/offline.js';
import { telegramReturnPage } from '../views/telegram-return.js';
import { adminUploadPage } from '../views/admin-upload.js';
import { lessonsPage } from '../views/lessons-page.js';
import { lessonNewPage } from '../views/lesson-new.js';
import { settingsPage } from '../views/settings.js';
import { newsListPage, newsPage, newsEditPage } from '../views/news.js';
import { listNews, getNewsBySlug } from '../services/news.js';
import { privacyPage, termsPage } from '../views/legal.js';
import { adminReviewPage } from '../views/admin-review.js';
import { adminPreviewPage } from '../views/admin-preview.js';
import { publicationsFor, newsPublications, shortPublications } from '../services/publications.js';
import {
  listSeries,
  getSeriesBySlug,
  seriesNavigation,
  relatedLessons
} from '../services/series.js';
import { seriesPage } from '../views/series.js';
import {
  shortsListPage,
  shortPage,
  shortNewPage,
  shortEditPage
} from '../views/shorts.js';
import { listShorts, getShortBySlug, shortsOfLesson } from '../services/shorts.js';
import { youtubeApp, channelApp, loadPlatformApp } from '../services/platform-apps.js';
import { loadDrawingSettings, DEFAULT_DRAWING_MODELS } from '../services/drawing-settings.js';
import { loadIntegration } from '../services/disk.js';
import { listSources } from '../services/news-sources.js';
import { mediaLink } from '../lib/media-token.js';
import { probeDuration } from '../lib/ffmpeg.js';
import { mediaPath } from '../services/media.js';
import { timeLabel } from '../views/search.js';
import { humanBytes } from '../views/admin-review.js';
import { requireAdmin } from '../middleware/guards.js';
import { feedPage } from '../views/feed.js';
import { lessonPage } from '../views/lesson.js';
import { feedbackPage } from '../views/feedback.js';
import { searchPage } from '../views/search.js';
import { searchSegments } from '../services/search.js';
import { listIdeas } from '../services/ideas.js';
import { listLessons, getLessonBySlug } from '../services/lessons.js';
import {
  listComments,
  countReactions,
  ratingSummary,
  getViewerReaction
} from '../services/feedback.js';
import { PublicError } from '../middleware/errors.js';

/**
 * Откуда взялась обложка — словами.
 * Видов три, и различаются они именем файла: кадр вырезал конвейер,
 * нарисованную дала модель, загруженную принёс автор. Без подписи выбор из
 * трёх одинаковых картинок превращается в угадывание.
 * Вызывается из обработчика /admin/lesson/:slug.
 */
// Время в подписи — по часам заказчика: сервер живёт в Europe/Berlin, а
// контейнер — в UTC, и без зоны время на экране расходилось бы с его часами.
const COVER_TIME_ZONE = 'Europe/Berlin';

function coverLabel(row) {
  const labels = [
    ['cover-drawn', 'нарисованная'],
    ['cover-uploaded', 'загруженная вами'],
    ['cover', 'кадр из записи']
  ];
  const found = labels.find(([part]) => row.path.includes(part));
  const kind = found ? found[1] : 'обложка';
  // Нарисованных бывает несколько: без времени их не различить.
  const time = row.created_at
    ? new Date(row.created_at).toLocaleString('ru-RU', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: COVER_TIME_ZONE
      })
    : '';
  return { id: Number(row.id), label: time ? `${kind} · ${time}` : kind };
}

/**
 * Текущий пользователь для шаблона: только имя и роль.
 * Зачем отдельной функцией: то же самое нужно каждой странице, а тащить в
 * шаблон весь req незачем — вид не должен знать про HTTP.
 * Вызывается из обработчиков этого файла.
 */
async function currentUser(pool, req) {
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
    const user = await currentUser(pool, req);
    // Черновиков на главной нет ни у кого, включая автора. Главная — витрина, а
    // не рабочий стол: недоделанный урок среди вышедших сбивает и самого
    // автора — он смотрит на витрину, чтобы увидеть её глазами зрителя.
    // Незаконченное лежит в разделе «Уроки», там оно к месту.
    const lessons = await listLessons(pool, {});
    // Пока уроков нет вовсе, показываем заглушку с рассказом о проекте:
    // пустая лента на новом сайте читается как сломанная страница.
    if (!lessons.length) {
      res.type('html').send(stubPage(config, user));
      return;
    }
    const news = await listNews(pool, {});
    res.type('html').send(feedPage({ config, lessons, news, user }));
  });

  router.get('/tag/:slug', async (req, res) => {
    const user = await currentUser(pool, req);
    const lessons = await listLessons(pool, { tag: req.params.slug });
    res.type('html').send(feedPage({ config, lessons, news: [], user, tag: req.params.slug }));
  });

  router.get('/lesson/:slug', async (req, res) => {
    const user = await currentUser(pool, req);
    const lesson = await getLessonBySlug(pool, req.params.slug, {
      includeDrafts: user?.role === 'admin'
    });
    if (!lesson) throw new PublicError('Урок не найден', 404);

    const object = { objectType: 'lesson', objectId: lesson.id };
    lesson.reactions = await countReactions(pool, object);
    const rating = await ratingSummary(pool, object);
    const comments = await listComments(pool, {
      ...object,
      viewerId: req.user?.id ?? null,
      isAdmin: user?.role === 'admin'
    });
    const viewerReaction = await getViewerReaction(pool, {
      ...object,
      userId: req.user?.id ?? null
    });
    res.type('html').send(
      lessonPage({
        config,
        lesson,
        comments,
        user,
        viewerReaction,
        rating,
        // Связи урока: серия по порядку и похожие по общим тегам. Черновики
        // видит только автор — зрителю они и в блоке связей не показываются.
        seriesNav: await seriesNavigation(pool, lesson, {
          includeDrafts: user?.role === 'admin'
        }),
        related: await relatedLessons(pool, lesson)
      })
    );
  });

  /**
   * Каналы, у которых есть настройки.
   * Без токена и адреса кнопка отправки была бы кнопкой, которая всегда
   * отвечает отказом. Вызывается со страницы правки новости.
   */
  const configuredChannels = async () =>
    (
      await Promise.all(
        [
          ['telegram', 'Канал Telegram'],
          ['max', 'Канал MAX']
        ].map(([name, title]) =>
          channelApp(pool, config, name).then((app) => ({ name, title, configured: app.configured }))
        )
      )
    ).filter((platform) => platform.configured);

  /**
   * Подключён ли Яндекс Диск. Нужен двум страницам кабинета, поэтому вынесен.
   * Вызывается из обработчиков /admin и /admin/upload.
   */
  const diskConnected = async () => {
    const { rows } = await pool.query(`SELECT 1 FROM integrations WHERE name = 'yandex-disk'`);
    return rows.length > 0;
  };

  /**
   * Подключён ли канал YouTube. По строке в таблице подключений, а не вопросом
   * самой площадке: спрашивать её на каждой загрузке страницы незачем, а токен
   * всё равно обновляется перед выкладкой.
   * Вызывается из обработчика /admin/upload.
   */
  const youtubeConnected = async () => {
    const { rows } = await pool.query(`SELECT 1 FROM integrations WHERE name = 'youtube'`);
    return rows.length > 0;
  };

  // Кабинет как отдельная страница больше ничего не даёт: список уроков живёт
  // в «Уроках», подключения — в «Настройках». Оставляем перенаправление, а не
  // убираем адрес совсем: он мог остаться в закладках и в истории браузера.
  router.get('/admin', requireAdmin, (req, res) => res.redirect(302, '/admin/lessons'));

  // Уроки: список для всех, управление для автора. Одна страница на обоих —
  // раньше их было две, и публичной среди них не было вовсе.
  router.get('/lessons', async (req, res) => {
    const user = await currentUser(pool, req);
    const isAdmin = user?.role === 'admin';
    res.type('html').send(
      lessonsPage({
        config,
        user,
        lessons: await listLessons(pool, { includeDrafts: isAdmin }),
        // Серии впереди списка: курс из восьми уроков человеку полезнее
        // восьми отдельных строк, между которыми он выбирает наугад.
        series: await listSeries(pool, { includeDrafts: isAdmin }),
        diskConnected: isAdmin ? await diskConnected() : false
      })
    );
  });

  // Заведение урока — своей страницей: форма посреди списка мешала его читать.
  router.get('/lessons/new', requireAdmin, async (req, res) => {
    res.type('html').send(
      lessonNewPage({
        config,
        user: await currentUser(pool, req),
        diskConnected: await diskConnected()
      })
    );
  });

  // Старый адрес кабинета: он был у автора в закладках и в ссылках уведомлений.
  router.get('/admin/lessons', (req, res) => res.redirect(301, '/lessons'));

  // Кабинет автора: загрузка исходника. Под requireAdmin — исходники грузит
  // один человек, и посторонним тут нечего смотреть.
  router.get('/admin/upload', requireAdmin, async (req, res) => {
    const user = await currentUser(pool, req);
    const lessons = await listLessons(pool, { includeDrafts: true });
    // Подключён ли Диск, узнаём одним запросом: показывать список файлов или
    // кнопку подключения — решается здесь, а не мельканием в браузере.
    // Урок мог прийти адресом: автор нажал «Загрузить запись» на своём уроке.
    const chosen = req.query.lesson
      ? await getLessonBySlug(pool, String(req.query.lesson), { includeDrafts: true })
      : null;
    // Есть ли уже запись у этого урока — главное, ради чего сюда заходят
    // второй раз. Без этого страница молчит о том, чем кончилась прошлая
    // попытка.
    const { rows: sources } = chosen?.sourceAssetId
      ? await pool.query('SELECT path, bytes FROM assets WHERE id = $1', [chosen.sourceAssetId])
      : { rows: [] };

    res.type('html').send(
      adminUploadPage({
        config,
        user,
        lessons,
        lesson: chosen,
        source: sources[0]
          ? {
              name: sources[0].path.split('/').pop(),
              size: humanBytes(Number(sources[0].bytes))
            }
          : null,
        // Копирование могло начаться до этой загрузки страницы.
        copying:
          Boolean(chosen) &&
          !chosen.sourceAssetId &&
          ['uploading', 'processing'].includes(chosen.pipelineState),
        diskConnected: await diskConnected(),
        youtubeConnected: await youtubeConnected(),
        youtubeConfigured: (await youtubeApp(pool, config)).configured
      })
    );
  });

  // Экран проверки урока: обязательный ручной шаг перед публикацией.
  router.get('/admin/lesson/:slug', requireAdmin, async (req, res) => {
    const user = await currentUser(pool, req);
    const lesson = await getLessonBySlug(pool, req.params.slug, { includeDrafts: true });
    if (!lesson) throw new PublicError('Урок не найден', 404);

    const { rows: assets } = await pool.query(
      `SELECT id, kind, path, bytes, expires_at, created_at FROM assets
        WHERE lesson_id = $1 ORDER BY kind, id`,
      [lesson.id]
    );
    const trimmed = assets.find((row) => row.kind === 'trimmed');
    const { rows: transcript } = await pool.query(
      'SELECT text FROM transcripts WHERE lesson_id = $1',
      [lesson.id]
    );
    // Реплики с временами: их правит автор прямо на экране проверки.
    const { rows: segmentRows } = await pool.query(
      `SELECT id, started_ms, text FROM transcript_segments
        WHERE lesson_id = $1 ORDER BY started_ms`,
      [lesson.id]
    );

    // Длительность смонтированной записи спрашиваем у файла: в учёте лежит
    // только размер, а автору нужно знать, насколько урок укоротился.
    // Файла может не быть — том пересоздали, срок вышел. Тогда просто не
    // показываем длительность: ронять из-за неё весь экран проверки незачем.
    const trimmedSeconds = trimmed
      ? await probeDuration(mediaPath(config, trimmed.path)).catch(() => null)
      : null;
    const trimmedLabel = trimmedSeconds ? timeLabel(Math.round(trimmedSeconds * 1000)) : '—';

    // Отказ показывается один раз — сразу после попытки — и стирается.
    // Иначе он висит на странице вечно: заказчик нажал «нарисовать» однажды, а
    // красная надпись про чужую квоту встречала его при каждом заходе.
    if (lesson.sideError) {
      await pool
        .query(`UPDATE lessons SET generated = generated - 'sideError' WHERE id = $1`, [lesson.id])
        .catch((error) => console.error('Не удалось убрать отказ довеска:', error.message));
    }

    res.type('html').send(
      adminReviewPage({
        config,
        user,
        lesson,
        assets: assets.map((row) => ({
          kind: row.kind,
          path: row.path,
          bytes: Number(row.bytes),
          expiresLabel: new Date(row.expires_at).toLocaleDateString('ru-RU')
        })),
        transcript: transcript[0]?.text ?? null,
        // Без токена рисования кнопка неактивна и объясняет, где его взять.
        drawingReady: Boolean((await loadDrawingSettings(pool, config)).token),
        // Обложек у урока бывает две: кадр из записи и нарисованная. Автор
        // выбирает, какая идёт в карточку.
        covers: assets.filter((row) => row.kind === 'cover').map(coverLabel),
        // Отказ необязательного шага: показывается рядом с его кнопкой, а не
        // как «обработка упала» на весь урок.
        sideError: lesson.sideError,
        // Публикации целиком, с причиной отказа: карточке урока хватает ссылки
        // и состояния, а кабинету нужно ещё и объяснение.
        publications: await publicationsFor(pool, lesson.id),
        // Серии для выбора: в какую поставить этот урок.
        series: await listSeries(pool, { includeDrafts: true }),
        // Ролики, уже сделанные из нарезок этого урока: кнопка «Сделать
        // роликом» у такой нарезки не нужна, а ссылка на готовый — нужна.
        shorts: await shortsOfLesson(pool, lesson.id),
        // Площадки, у которых есть настройки: без ключей кнопка выкладки была бы
        // кнопкой, которая всегда отвечает отказом.
        platforms: (
          await Promise.all([
            youtubeApp(pool, config).then((app) => ({
              name: 'youtube',
              title: 'YouTube',
              action: 'Отправить на YouTube',
              needsCover: false,
              configured: app.configured
            })),
            channelApp(pool, config, 'telegram').then((app) => ({
              name: 'telegram',
              title: 'Канал Telegram',
              action: 'Отправить анонс',
              needsCover: true,
              configured: app.configured
            })),
            channelApp(pool, config, 'max').then((app) => ({
              name: 'max',
              title: 'Канал MAX',
              action: 'Отправить анонс',
              needsCover: true,
              configured: app.configured
            })),
            // Урок частями видео — следом за анонсом в тот же канал: кнопка
            // заперта, пока анонс не ушёл (needsAnnouncement).
            channelApp(pool, config, 'telegram').then((app) => ({
              name: 'telegram_parts',
              title: 'Telegram — видео урока',
              action: 'Отправить видео урока',
              needsCover: false,
              needsAnnouncement: 'telegram',
              configured: app.configured
            })),
            channelApp(pool, config, 'max').then((app) => ({
              name: 'max_parts',
              title: 'MAX — видео урока',
              action: 'Отправить видео урока',
              needsCover: false,
              needsAnnouncement: 'max',
              configured: app.configured
            }))
          ])
        ).filter((platform) => platform.configured),
        segments: segmentRows.map((row) => ({
          id: Number(row.id),
          startedMs: Number(row.started_ms),
          text: row.text
        })),
        links: {
          // Субтитры и нарезки лежат в буфере и по прямому адресу наружу не
          // смотрят: автору они выдаются подписанной ссылкой на час.
          subtitles: assets
            .filter((row) => row.kind === 'subtitles')
            .map((row) => ({
              name: row.path.split('/').pop(),
              url: mediaLink(config, Number(row.id))
            })),
          clips: assets
            .filter((row) => row.kind === 'clip')
            .map((row) => ({
              id: Number(row.id),
              name: row.path.split('/').pop(),
              url: mediaLink(config, Number(row.id))
            })),
          trimmed: trimmed
            ? {
                name: trimmed.path.split('/').pop(),
                url: mediaLink(config, Number(trimmed.id)),
                duration: trimmedLabel
              }
            : null
        }
      })
    );
  });

  // Просмотр записи с субтитрами. Отдельной страницей от проверки: плеер
  // тянет полгигабайта, и открывать его при каждом заходе на экран проверки
  // незачем.
  router.get('/admin/lesson/:slug/preview', requireAdmin, async (req, res) => {
    const user = await currentUser(pool, req);
    const lesson = await getLessonBySlug(pool, req.params.slug, { includeDrafts: true });
    if (!lesson) throw new PublicError('Урок не найден', 404);

    // Исходник берём по указателю урока, а не первый попавшийся файл вида
    // source: при повторной загрузке их в буфере остаётся два, и старый уходит
    // только по сроку. Первая проверка на живом сервере открыла именно старый.
    const { rows } = await pool.query(
      `SELECT a.id, a.kind, a.path
         FROM assets a JOIN lessons l ON l.id = a.lesson_id
        WHERE a.lesson_id = $1
          AND (a.id = l.source_asset_id OR a.kind IN ('subtitles', 'trimmed'))`,
      [lesson.id]
    );
    // Смонтированную запись и её субтитры показываем по явной просьбе: по
    // умолчанию автор смотрит то, что снял.
    const wantTrimmed = req.query.trimmed === '1';
    const source = wantTrimmed
      ? rows.find((row) => row.kind === 'trimmed')
      : rows.find((row) => row.kind === 'source');
    // Именно vtt: srt браузеры не понимают, а различаются они одним знаком в
    // записи времени. У смонтированной записи субтитры свои — по старым она
    // показывала бы реплики с нарастающим опозданием.
    const subtitles = rows.find(
      (row) =>
        row.kind === 'subtitles' &&
        row.path.endsWith(wantTrimmed ? 'trimmed.vtt' : 'subtitles.vtt')
    );

    res.type('html').send(
      adminPreviewPage({
        config,
        user,
        lesson,
        // Ссылка на три часа: просмотр урока целиком в час не укладывается.
        videoUrl: source ? mediaLink(config, Number(source.id), 3 * 3600) : null,
        subtitlesUrl: subtitles ? mediaLink(config, Number(subtitles.id), 3 * 3600) : null
      })
    );
  });

  // Новости: список для всех, форма для автора. Отдельной админской страницы
  // нет намеренно — она отличалась бы только кнопками, а две почти одинаковые
  // страницы однажды разойдутся.
  // Короткие ролики. Устроены как новости: список, своя страница у каждого,
  // правка отдельной страницей.
  router.get('/shorts', async (req, res) => {
    const user = await currentUser(pool, req);
    const shorts = await listShorts(pool, { includeDrafts: user?.role === 'admin' });
    res.type('html').send(shortsListPage({ config, user, shorts }));
  });

  // Объявлен ДО /short/:slug — иначе «new» попало бы в него как адрес ролика.
  router.get('/shorts/new', requireAdmin, async (req, res) => {
    res.type('html').send(shortNewPage({ config, user: await currentUser(pool, req) }));
  });

  router.get('/short/:slug/edit', requireAdmin, async (req, res) => {
    const short = await getShortBySlug(pool, req.params.slug);
    if (!short) throw new PublicError('Ролик не найден', 404);
    res.type('html').send(
      shortEditPage({
        config,
        user: await currentUser(pool, req),
        short,
        publications: await shortPublications(pool, short.id),
        // Каналы плюс Instagram: у него не канал, а подключённый аккаунт, и
        // спрашивать о нём надо иначе.
        platforms: [
          ...(await configuredChannels()),
          ...((await loadIntegration(pool, config, 'instagram'))
            ? [{ name: 'instagram', title: 'Instagram Reels', configured: true }]
            : [])
        ]
      })
    );
  });

  router.get('/short/:slug', async (req, res) => {
    const user = await currentUser(pool, req);
    const short = await getShortBySlug(pool, req.params.slug);
    // Черновик по прямой ссылке — «не найдено»: сказать «есть, но не для вас»
    // значит показать чужому и заголовок, и то, что он существует.
    if (!short || (short.status !== 'published' && user?.role !== 'admin')) {
      throw new PublicError('Ролик не найден', 404);
    }
    res.type('html').send(shortPage({ config, user, short }));
  });

  // Серия целиком: все её уроки по порядку. Отдельным адресом, чтобы ссылкой
  // на курс можно было поделиться так же, как на урок.
  router.get('/series/:slug', async (req, res) => {
    const user = await currentUser(pool, req);
    const series = await getSeriesBySlug(pool, req.params.slug, {
      includeDrafts: user?.role === 'admin'
    });
    if (!series) throw new PublicError('Серия не найдена', 404);
    res.type('html').send(seriesPage({ config, user, series }));
  });

  router.get('/news', async (req, res) => {
    const user = await currentUser(pool, req);
    // Черновики видит только автор: недописанная новость на витрине хуже, чем
    // её отсутствие.
    const news = await listNews(pool, { includeDrafts: user?.role === 'admin' });
    res.type('html').send(newsListPage({ config, user, news }));
  });

  // Создание и правка — отдельными страницами: форма посреди списка мешает
  // читать список, а на своей странице ей есть где развернуться.
  // Объявлены ДО /news/:slug: иначе «new» попало бы в него как адрес новости.
  router.get('/news/new', requireAdmin, async (req, res) => {
    res.type('html').send(newsEditPage({ config, user: await currentUser(pool, req) }));
  });

  router.get('/news/:slug/edit', requireAdmin, async (req, res) => {
    const item = await getNewsBySlug(pool, req.params.slug);
    if (!item) throw new PublicError('Новость не найдена', 404);
    // Отказ рисования показывается один раз — сразу после попытки — и
    // стирается, как у обложки урока: иначе он встречал бы автора всегда.
    if (item.sideError) {
      await pool
        .query(`UPDATE news SET generated = generated - 'sideError' WHERE id = $1`, [item.id])
        .catch((error) => console.error('Не удалось убрать отказ рисования:', error.message));
    }
    res.type('html').send(
      newsEditPage({
        config,
        user: await currentUser(pool, req),
        item,
        // Без токена рисования кнопка неактивна и объясняет, где его взять.
        drawingReady: Boolean((await loadDrawingSettings(pool, config)).token),
        // Выпуск и каналы живут здесь: на странице просмотра новость должна
        // выглядеть так, как её увидит читатель.
        publications: await newsPublications(pool, item.id),
        platforms: await configuredChannels()
      })
    );
  });

  router.get('/news/:slug', async (req, res) => {
    const user = await currentUser(pool, req);
    const item = await getNewsBySlug(pool, req.params.slug);
    const isAdmin = user?.role === 'admin';
    // Черновик по прямой ссылке — тоже «не найдено»: сказать «есть, но не для
    // вас» значит показать чужому и заголовок, и то, что он существует.
    if (!item || (item.status !== 'published' && !isAdmin)) {
      throw new PublicError('Новость не найдена', 404);
    }

    res.type('html').send(newsPage({ config, user, item }));
  });

  router.get('/search', async (req, res) => {
    const user = await currentUser(pool, req);
    const query = String(req.query.q ?? '');
    res.type('html').send(
      searchPage({ config, user, query, results: await searchSegments(pool, query) })
    );
  });

  // Настройки зрителя: тема и уведомления. Открыты всем — это настройки
  // устройства, а не свойства учётной записи.
  // Политика и условия открыты всем и не требуют входа: по этим ссылкам ходит
  // проверяющий робот Google — приложение, просящее доступ к чужому каналу,
  // обязано их показать, — и вход он не пройдёт.
  router.get('/privacy', async (req, res) => {
    res.type('html').send(privacyPage({ config, user: await currentUser(pool, req) }));
  });

  router.get('/terms', async (req, res) => {
    res.type('html').send(termsPage({ config, user: await currentUser(pool, req) }));
  });

  router.get('/settings', async (req, res) => {
    const user = await currentUser(pool, req);
    // Состояние площадки нужно только автору: остальным этот раздел не
    // показывается вовсе, и лишние запросы к базе им ни к чему.
    const youtube =
      user?.role === 'admin'
        ? await (async () => {
            const app = await youtubeApp(pool, config);
            return {
              clientId: app.clientId,
              // Сам секрет наружу не отдаём никогда — только то, что он есть.
              hasSecret: Boolean(app.clientSecret),
              mode: app.mode,
              redirectUri: app.redirectUri,
              configured: app.configured,
              connected: await youtubeConnected()
            };
          })()
        : null;
    // Каналы: у Telegram бот портала уже есть, поэтому токен там не спрашиваем.
    const channels =
      user?.role === 'admin'
        ? await Promise.all(
            [
              {
                name: 'telegram',
                title: 'Канал Telegram',
                hint:
                  'Бот должен быть администратором канала с правом менять сообщения. ' +
                  'Токен можно оставить пустым — тогда постить будет бот портала, тот же, ' +
                  'что для входа и уведомлений.',
                placeholder: '@moy-kanal',
                needsToken: true,
                tokenOptional: true
              },
              {
                name: 'max',
                title: 'Канал MAX',
                hint: 'Своего бота у портала здесь нет: заведите его в MAX и вставьте токен.',
                placeholder: 'номер или адрес канала',
                needsToken: true,
                tokenOptional: false
              }
            ].map(async (item) => {
              const app = await channelApp(pool, config, item.name);
              const stored = await loadPlatformApp(pool, config, item.name);
              return {
                ...item,
                channel: app.channel,
                configured: app.configured,
                // Сам токен наружу не отдаём — только то, что он есть.
                hasToken: Boolean(stored?.clientSecret)
              };
            })
          )
        : [];
    // Площадки коротких видео: пока только хранение ключей. Автор получает их в
    // момент регистрации на площадке, и складывать их до появления самой
    // выкладки ему иначе некуда.
    const shortPlatforms =
      user?.role === 'admin'
        ? await Promise.all(
            [
              {
                name: 'instagram',
                title: 'Instagram',
                idLabel: 'Instagram App ID',
                secretLabel: 'Instagram App Secret',
                hint:
                  'Нужен профессиональный аккаунт и приложение Meta со сценарием ' +
                  '«Manage messaging & content on Instagram». Страница в Facebook НЕ ' +
                  'нужна. Порядок расписан в docs/instagram-setup.md.',
                next: 'Заведите приложение по инструкции и вставьте ключи — они понадобятся выкладке.',
                // Выкладка готова: остаётся подключить аккаунт.
                connect: '/api/integrations/instagram/connect?from=/settings'
              },
              {
                name: 'tiktok',
                title: 'TikTok',
                idLabel: 'Client key',
                secretLabel: 'Client secret',
                hint:
                  'Нужно приложение в TikTok for Developers с продуктами Login Kit и ' +
                  'Content Posting API. Порядок расписан в docs/tiktok-setup.md.',
                next: 'Пока приложение не прошло проверку, выложенное через него видно только вам.'
              }
            ].map(async (item) => {
              const stored = await loadPlatformApp(pool, config, item.name);
              return {
                ...item,
                clientId: stored?.clientId ?? '',
                // Сам секрет наружу не отдаём — только то, что он есть.
                hasSecret: Boolean(stored?.clientSecret),
                connected: Boolean(await loadIntegration(pool, config, item.name)),
                redirectUri: `${config.publicBaseUrl}/api/integrations/${item.name}/callback`
              };
            })
          )
        : [];

    // Рисование: токен Hugging Face и модели. Сам токен наружу не отдаём —
    // только то, что он есть.
    const drawing =
      user?.role === 'admin'
        ? await (async () => {
            const stored = await loadDrawingSettings(pool, config);
            return {
              hasToken: Boolean(stored.token),
              models: stored.modelsText,
              defaultModels: DEFAULT_DRAWING_MODELS
            };
          })()
        : null;

    res.type('html').send(
      settingsPage({
        config,
        user,
        youtube,
        channels,
        shortPlatforms,
        drawing,
        // Источники анонсов правит автор: сегодня их девять, завтра появится
        // NVIDIA.
        sources: user?.role === 'admin' ? await listSources(pool) : []
      })
    );
  });

  // Обратная связь: идеи с голосованием и свои обращения любого вида.
  router.get('/feedback', async (req, res) => {
    const user = await currentUser(pool, req);
    const ideas = await listIdeas(pool, { viewerId: req.user?.id ?? null });
    // Свои — это всё, что человек написал сам: и идеи, и пожелания, и отзывы.
    // Чужие пожелания и отзывы в списке не показываются: они адресованы автору
    // портала, а не соседям.
    const mine = user ? ideas.filter((idea) => idea.authorId === user.id) : [];
    res.type('html').send(feedbackPage({ config, ideas, mine, user }));
  });

  // Старый адрес: он в закладках и в ссылках уведомлений о статусе идеи.
  router.get('/ideas', (req, res) => res.redirect(301, '/feedback'));

  // Telegram возвращает человека сюда после подтверждения входа.
  router.get('/auth/telegram/return', (req, res) => {
    res.type('html').send(telegramReturnPage(config));
  });

  router.get('/offline', (req, res) => {
    res.type('html').send(offlinePage(config));
  });

  router.get('/login', async (req, res) => {
    const user = await currentUser(pool, req);
    res.type('html').send(loginPage({ config, user }));
  });

  return router;
}
