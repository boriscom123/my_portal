// Серверные страницы. Задача — отдать поисковику и мессенджеру готовый HTML с
// тегами превью; вся живая логика идёт отдельно, через JSON API.
// Подключается в src/app.js после маршрутов API.
import { Router } from 'express';
import { loginPage } from '../views/login.js';
import { stubPage } from '../views/stub.js';
import { offlinePage } from '../views/offline.js';
import { telegramReturnPage } from '../views/telegram-return.js';
import { adminUploadPage } from '../views/admin-upload.js';
import { adminHomePage } from '../views/admin-home.js';
import { adminReviewPage } from '../views/admin-review.js';
import { adminPreviewPage } from '../views/admin-preview.js';
import { mediaLink } from '../lib/media-token.js';
import { probeDuration } from '../lib/ffmpeg.js';
import { mediaPath } from '../services/media.js';
import { timeLabel } from '../views/search.js';
import { requireAdmin } from '../middleware/guards.js';
import { feedPage } from '../views/feed.js';
import { lessonPage } from '../views/lesson.js';
import { ideasPage } from '../views/ideas.js';
import { searchPage } from '../views/search.js';
import { searchSegments } from '../services/search.js';
import { listIdeas } from '../services/ideas.js';
import { listLessons, getLessonBySlug, listNews } from '../services/lessons.js';
import {
  listComments,
  countReactions,
  ratingSummary,
  getViewerReaction
} from '../services/feedback.js';
import { PublicError } from '../middleware/errors.js';

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
    const lessons = await listLessons(pool, { includeDrafts: user?.role === 'admin' });
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
    res.type('html').send(lessonPage({ config, lesson, comments, user, viewerReaction, rating }));
  });

  /**
   * Подключён ли Яндекс Диск. Нужен двум страницам кабинета, поэтому вынесен.
   * Вызывается из обработчиков /admin и /admin/upload.
   */
  const diskConnected = async () => {
    const { rows } = await pool.query(`SELECT 1 FROM integrations WHERE name = 'yandex-disk'`);
    return rows.length > 0;
  };

  router.get('/admin', requireAdmin, async (req, res) => {
    const user = await currentUser(pool, req);
    const lessons = await listLessons(pool, { includeDrafts: true });
    res.type('html').send(
      adminHomePage({ config, user, lessons, diskConnected: await diskConnected() })
    );
  });

  // Кабинет автора: загрузка исходника. Под requireAdmin — исходники грузит
  // один человек, и посторонним тут нечего смотреть.
  router.get('/admin/upload', requireAdmin, async (req, res) => {
    const user = await currentUser(pool, req);
    const lessons = await listLessons(pool, { includeDrafts: true });
    // Подключён ли Диск, узнаём одним запросом: показывать список файлов или
    // кнопку подключения — решается здесь, а не мельканием в браузере.
    res.type('html').send(
      adminUploadPage({ config, user, lessons, diskConnected: await diskConnected() })
    );
  });

  // Экран проверки урока: обязательный ручной шаг перед публикацией.
  router.get('/admin/lesson/:slug', requireAdmin, async (req, res) => {
    const user = await currentUser(pool, req);
    const lesson = await getLessonBySlug(pool, req.params.slug, { includeDrafts: true });
    if (!lesson) throw new PublicError('Урок не найден', 404);

    const { rows: assets } = await pool.query(
      `SELECT id, kind, path, bytes, expires_at FROM assets
        WHERE lesson_id = $1 ORDER BY kind, id`,
      [lesson.id]
    );
    const trimmed = assets.find((row) => row.kind === 'trimmed');
    const { rows: transcript } = await pool.query(
      'SELECT text FROM transcripts WHERE lesson_id = $1',
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

  router.get('/search', async (req, res) => {
    const user = await currentUser(pool, req);
    const query = String(req.query.q ?? '');
    res.type('html').send(
      searchPage({ config, user, query, results: await searchSegments(pool, query) })
    );
  });

  router.get('/ideas', async (req, res) => {
    const user = await currentUser(pool, req);
    const ideas = await listIdeas(pool, { viewerId: req.user?.id ?? null });
    res.type('html').send(ideasPage({ config, ideas, user }));
  });

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
