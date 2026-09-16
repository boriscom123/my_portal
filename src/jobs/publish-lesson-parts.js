// Шаг очереди: урок в канал частями видео.
//
// Задача — нарезать запись урока на как можно меньше частей в пределе площадки
// и отправить их одним постом со списком глав. Идёт следом за анонсом: анонс
// остаётся, пост с частями — для просмотра прямо в ленте канала.
// Площадка приходит набором функций (app, postParts): так шаг проверяется
// тестом без сети; резка и замер — тоже доводом, чтобы тест обходился без ffmpeg.
// Вызывается воркером по именам JOBS.publishTelegramParts и JOBS.publishMaxParts.
import { access, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { getLessonById } from '../services/lessons.js';
import { assetsOfLesson, mediaPath } from '../services/media.js';
import {
  markPublicationState,
  markPublicationDetails,
  publicationById,
  publicationsFor
} from '../services/publications.js';
import { pickVideoAsset } from '../services/platforms/youtube-fields.js';
import {
  buildFirstPartCaption,
  MAX_TEXT_LIMIT,
  TELEGRAM_CAPTION_LIMIT
} from '../services/platforms/announcement.js';
import { chaptersForVideo } from '../lib/chapters.js';
import { cutFirstPart } from '../lib/video-parts.js';
import { PARTS_LIMITS, TELEGRAM_CLOUD_LIMIT, partsLimit } from '../services/lesson-start.js';
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

      const assets = await assetsOfLesson(pool, lessonId);
      // Файл выбран автором при нажатии и записан в публикацию; его нет —
      // выкладка заказана до выбора записи, берём как раньше.
      const ordered = await publicationById(pool, publicationId);
      const video =
        assets.find((asset) => asset.id === ordered?.assetId) ?? pickVideoAsset(assets);
      const gone = 'Записи урока нет в буфере — вероятно, она удалена по сроку; загрузите её заново';
      if (!video) throw new Error(gone);
      const input = mediaPath(config, video.path);
      try {
        await access(input);
      } catch {
        throw new Error(gone);
      }
      const durationSeconds = await probe(input);
      if (!durationSeconds) throw new Error('Запись урока не читается — загрузите её заново');

      // Главы — на шкале уезжающего файла. Отрезков монтажа не посчитать —
      // глав не будет: неверные хуже никаких.
      const trimRanges =
        video.kind === 'trimmed' ? await ensureRanges(config, pool, lesson).catch(() => null) : null;
      const chapters = chaptersForVideo({ ...lesson, trimRanges }, video.kind).map((chapter, index) => ({
        ...chapter,
        number: index + 1
      }));

      await markPublicationState(pool, publicationId, { state: 'uploading' });
      await mkdir(partsDir, { recursive: true });
      let attempt = 0;
      const durationMs = Math.round(durationSeconds * 1000);
      const part = await cutFirstPart({
        durationMs,
        totalBytes: video.bytes,
        chapters,
        limitBytes: partsLimit(platform, config.telegram?.apiUrl),
        cut: ({ startMs, endMs }) =>
          cutter({
            input,
            output: path.join(partsDir, `${platform}-${(attempt += 1)}.mp4`),
            startMs,
            endMs
          }),
        discard: (piece) => rm(piece.path, { force: true })
      });

      // У Telegram подпись поста — это подпись видео (предел 1024); у MAX текст
      // идёт отдельно, и предел у него свой.
      const limit = platform === 'telegram_parts' ? TELEGRAM_CAPTION_LIMIT : MAX_TEXT_LIMIT;
      const text = buildFirstPartCaption({
        lesson,
        part,
        durationMs,
        publicBaseUrl: config.publicBaseUrl,
        publications: await publicationsFor(pool, lessonId),
        skipPlatform: ANNOUNCEMENT_OF[platform],
        limit
      });
      // Путь null — запись влезла целиком, уходит сам файл.
      const sending = part.path ?? input;
      // Размеры кадра и длительность площадка сама не знает: без них Telegram
      // показывает квадратную заглушку и растягивает в неё кадр. Меряем тот
      // файл, который уезжает, а не исходник: у куска своя длительность.
      const [size, seconds] = await Promise.all([
        Promise.resolve(frameSize(sending)).catch(() => null),
        Promise.resolve(probe(sending)).catch(() => null)
      ]);
      const files = [
        {
          path: sending,
          caption: text,
          ...(size ? { width: size.width, height: size.height } : {}),
          ...(seconds ? { duration: Math.round(seconds) } : {})
        }
      ];

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
