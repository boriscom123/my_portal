// Шаг очереди: урок в канал частями видео.
//
// Задача — нарезать запись урока на как можно меньше частей в пределе площадки
// и отправить их одним постом со списком глав. Идёт следом за анонсом: анонс
// остаётся, пост с частями — для просмотра прямо в ленте канала.
// Площадка приходит набором функций (app, postParts): так шаг проверяется
// тестом без сети; резка и замер — тоже доводом, чтобы тест обходился без ffmpeg.
// Вызывается воркером по именам JOBS.publishTelegramParts и JOBS.publishMaxParts.
import { rm, stat } from 'node:fs/promises';
import { getLessonById } from '../services/lessons.js';
import { assetsOfLesson, mediaPath } from '../services/media.js';
import {
  markPublicationState,
  markPublicationDetails,
  publicationById,
  publicationsFor
} from '../services/publications.js';
import {
  buildFirstPartCaption,
  MAX_TEXT_LIMIT,
  TELEGRAM_CAPTION_LIMIT
} from '../services/platforms/announcement.js';
import {
  cutLessonStart,
  PARTS_LIMITS,
  TELEGRAM_CLOUD_LIMIT,
  partsLimit
} from '../services/lesson-start.js';
import { runFfmpeg, ffmpegArgsForPart, probeDuration, probeFrameSize } from '../lib/ffmpeg.js';
import { ensureTrimRanges } from '../services/trim-ranges.js';

// Пределы куска живут рядом с самой резкой — в services/lesson-start.js: их
// спрашивает и этот шаг, и анонс с видео. Здесь они перевыставлены, потому что
// снаружи их знают по этому адресу.
export { PARTS_LIMITS, TELEGRAM_CLOUD_LIMIT, partsLimit };

// Какой анонс должен уйти раньше частей.
const ANNOUNCEMENT_OF = { telegram_parts: 'telegram', max_parts: 'max' };

/** Резка без пережатия и замер части. */
async function ffmpegCutter({ input, output, startMs, endMs }) {
  await runFfmpeg(ffmpegArgsForPart({ input, output, startMs, endMs }));
  const { size } = await stat(output);
  return { path: output, bytes: size };
}

export function makePublishLessonParts(
  config,
  pool,
  platform,
  adapter,
  {
    cutter = ffmpegCutter,
    probe = probeDuration,
    frameSize = probeFrameSize,
    ensureRanges = ensureTrimRanges
  } = {}
) {
  return async ({ lessonId, publicationId }) => {
    const partsDir = mediaPath(config, `lesson-${lessonId}/parts`);
    try {
      const base = ANNOUNCEMENT_OF[platform];
      const app = await adapter.app(pool, config, base);
      if (!app.configured) throw new Error(`Канал ${base} не настроен — заполните его в настройках`);

      const lesson = await getLessonById(pool, lessonId);
      if (!lesson) throw new Error('Урок не найден');
      // Без анонса пост с частями оказался бы в канале без представления урока.
      const announced = (await publicationsFor(pool, lessonId)).some(
        (item) => item.platform === base && item.state === 'published'
      );
      if (!announced) throw new Error('Сначала отправьте анонс урока в этот канал');

      // Начало урока режет общий шаг: он же готовит его для анонса, и держать
      // две резки значило бы однажды поправить одну и забыть про другую.
      const ordered = await publicationById(pool, publicationId);
      await markPublicationState(pool, publicationId, { state: 'uploading' });
      const part = await cutLessonStart(
        config,
        pool,
        {
          lesson,
          limitBytes: partsLimit(platform, config.telegram?.apiUrl),
          platform,
          assetId: ordered?.assetId ?? null
        },
        { cutter, probe, frameSize, ensureRanges }
      );

      // У Telegram подпись поста — это подпись видео (предел 1024); у MAX текст
      // идёт отдельно, и предел у него свой.
      const limit = platform === 'telegram_parts' ? TELEGRAM_CAPTION_LIMIT : MAX_TEXT_LIMIT;
      const text = buildFirstPartCaption({
        lesson,
        part: { startMs: part.startMs, endMs: part.endMs },
        durationMs: part.durationMs,
        publicBaseUrl: config.publicBaseUrl,
        publications: await publicationsFor(pool, lessonId),
        skipPlatform: ANNOUNCEMENT_OF[platform],
        limit
      });
      const files = [
        {
          path: part.path,
          caption: text,
          ...(part.width ? { width: part.width, height: part.height } : {}),
          ...(part.duration ? { duration: part.duration } : {})
        }
      ];

      // Обложка — превью поста: её ищем среди файлов урока.
      const assets = await assetsOfLesson(pool, lessonId);
      const cover = lesson.coverUrl
        ? assets.find((asset) => `/media/asset/${asset.id}` === lesson.coverUrl)
        : null;
      const { rows: maxRows } = await pool.query(`SELECT settings FROM platform_apps WHERE name = 'max'`);
      const publication = await publicationById(pool, publicationId);

      const result = await adapter.postParts({
        token: app.token,
        channel: app.channel,
        parts: files,
        text,
        coverPath: cover ? mediaPath(config, cover.path) : null,
        multiVideo: maxRows[0]?.settings?.multiVideo !== false,
        progress: publication?.details?.sent ? publication.details : { sent: [] },
        onProgress: (details) => markPublicationDetails(pool, publicationId, details)
      });

      // MAX не принял несколько видео — дальше сразу постами подряд, без пробы.
      if (platform === 'max_parts' && result.multiVideo === false) {
        await pool.query(
          `UPDATE platform_apps SET settings = settings || '{"multiVideo": false}'::jsonb WHERE name = 'max'`
        );
      }
      await markPublicationState(pool, publicationId, {
        state: 'published',
        externalId: result.messageId,
        url: result.url ?? app.link ?? null
      });
      return { parts: files.length };
    } catch (error) {
      await markPublicationState(pool, publicationId, {
        state: 'failed',
        error: error.message.slice(0, 500)
      });
      throw error;
    } finally {
      // Части временные: уходят и после отправки, и после отказа.
      await rm(partsDir, { recursive: true, force: true });
    }
  };
}
