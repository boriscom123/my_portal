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
  partTitle,
  buildPartsCaption,
  MAX_TEXT_LIMIT,
  TELEGRAM_CAPTION_LIMIT
} from '../services/platforms/announcement.js';
import { chaptersForVideo } from '../lib/chapters.js';
import { splitIntoParts } from '../lib/video-parts.js';
import { runFfmpeg, ffmpegArgsForPart, probeDuration } from '../lib/ffmpeg.js';
import { ensureTrimRanges } from '../services/trim-ranges.js';

const MB = 1024 * 1024;

// Предел части у площадки: Telegram через свой сервер Bot API — 2000 МБ, MAX —
// 250 МБ (своего сервера у MAX нет).
export const PARTS_LIMITS = { telegram_parts: 2000 * MB, max_parts: 250 * MB };

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
  { cutter = ffmpegCutter, probe = probeDuration, ensureRanges = ensureTrimRanges } = {}
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
      const video = pickVideoAsset(assets);
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
      const parts = await splitIntoParts({
        durationMs: Math.round(durationSeconds * 1000),
        totalBytes: video.bytes,
        chapters,
        limitBytes: PARTS_LIMITS[platform],
        cut: ({ startMs, endMs }) =>
          cutter({
            input,
            output: path.join(partsDir, `${platform}-${(attempt += 1)}.mp4`),
            startMs,
            endMs
          }),
        discard: (piece) => rm(piece.path, { force: true })
      });

      // У Telegram подпись поста — это подпись первой части (предел 1024); у
      // MAX текст идёт отдельно от частей, и предел у него свой.
      const limit = platform === 'telegram_parts' ? TELEGRAM_CAPTION_LIMIT : MAX_TEXT_LIMIT;
      const text = buildPartsCaption({ lesson, parts, publicBaseUrl: config.publicBaseUrl, limit });
      const files = parts.map((part, index) => ({
        // Путь null — запись влезла целиком, уходит сам файл.
        path: part.path ?? input,
        caption:
          index === 0 && platform === 'telegram_parts' ? text : partTitle(part, index + 1, parts.length)
      }));

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
      return { parts: parts.length };
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
