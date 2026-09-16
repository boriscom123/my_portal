// Начало урока для поста в канале.
//
// Задача — вырезать из записи первый кусок в предел площадки, измерить его и
// оставить в буфере. Зачем отдельным файлом: этим куском живут оба поста —
// анонс с видео и отправка видео урока, — а собирать его в двух местах значит
// однажды поправить резку в одном и забыть про другое.
//
// Кусок остаётся в буфере отдельным видом файла (part): у MAX правка поста
// заново прикладывает вложения, и без файла видео слетело бы с поста при
// первой же правке подписи.
// Резка и замеры подставляются доводом: так шаг проверяется без ffmpeg.
// Вызывается из src/jobs/publish-channel.js и src/jobs/publish-lesson-parts.js.
import { access, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { assetsOfLesson, mediaPath, registerAsset } from './media.js';
import { pickVideoAsset } from './platforms/youtube-fields.js';
import { ensureTrimRanges } from './trim-ranges.js';
import { chaptersForVideo } from '../lib/chapters.js';
import { cutFirstPart } from '../lib/video-parts.js';
import { runFfmpeg, ffmpegArgsForPart, probeDuration, probeFrameSize } from '../lib/ffmpeg.js';

const GONE = 'Записи урока нет в буфере — вероятно, она удалена по сроку; загрузите её заново';

const MB = 1024 * 1024;

// Предел куска у площадки: Telegram через свой сервер Bot API — 2000 МБ, MAX —
// 250 МБ (своего сервера у MAX нет).
export const PARTS_LIMITS = { telegram_parts: 2000 * MB, max_parts: 250 * MB };

// Облачный Bot API берёт от бота не больше 50 МБ — столько же, сколько у
// одиночного видео. Свой сервер Bot API этот предел снимает, ради того его и
// поднимают.
export const TELEGRAM_CLOUD_LIMIT = 50 * MB;

/**
 * Предел куска: у Telegram он зависит от того, куда бот на самом деле шлёт.
 *
 * Куски резались по мерке своего сервера, а уезжали в облако — и облако
 * отвечало «Request Entity Too Large» на первом же. Резать по большему
 * пределу, чем возьмёт площадка, значит собрать кусок впустую: отказ приходит
 * после того, как файл уже уехал по сети.
 */
export function partsLimit(platform, apiUrl = '') {
  if (platform !== 'telegram_parts') return PARTS_LIMITS[platform];
  const address = String(apiUrl ?? '').trim();
  const cloud = !address || /telegram\.org/i.test(address);
  return cloud ? TELEGRAM_CLOUD_LIMIT : PARTS_LIMITS.telegram_parts;
}

/** Тот же предел, но по имени канала: анонс знает себя как telegram и max. */
export function channelPartLimit(platform, apiUrl = '') {
  return partsLimit(platform === 'telegram' ? 'telegram_parts' : 'max_parts', apiUrl);
}

/** Резка без пережатия и вес получившегося куска. */
async function ffmpegCutter({ input, output, startMs, endMs }) {
  await runFfmpeg(ffmpegArgsForPart({ input, output, startMs, endMs }));
  const { size } = await stat(output);
  return { path: output, bytes: size };
}

/**
 * Готовит начало урока к отправке.
 *
 * Отдаёт путь к файлу, размеры кадра и длительность — без них площадка рисует
 * квадратную заглушку, — и признак whole: запись влезла целиком, режущего
 * куска нет и про «начало урока» в подписи писать нечего.
 * assetId — запись, выбранная автором при нажатии; без неё берётся обычная.
 */
export async function cutLessonStart(
  config,
  pool,
  { lesson, limitBytes, platform, assetId = null },
  {
    cutter = ffmpegCutter,
    probe = probeDuration,
    frameSize = probeFrameSize,
    ensureRanges = ensureTrimRanges
  } = {}
) {
  const assets = await assetsOfLesson(pool, lesson.id);
  const video = assets.find((asset) => asset.id === assetId) ?? pickVideoAsset(assets);
  if (!video) throw new Error(GONE);
  const input = mediaPath(config, video.path);
  try {
    await access(input);
  } catch {
    throw new Error(GONE);
  }

  const durationSeconds = await probe(input);
  if (!durationSeconds) throw new Error('Запись урока не читается — загрузите её заново');

  // Главы — на шкале уезжающего файла. Отрезков монтажа не посчитать — глав не
  // будет: неверные хуже никаких.
  const trimRanges =
    video.kind === 'trimmed' ? await ensureRanges(config, pool, lesson).catch(() => null) : null;
  const chapters = chaptersForVideo({ ...lesson, trimRanges }, video.kind).map((chapter, index) => ({
    ...chapter,
    number: index + 1
  }));

  // Примерки режутся в отдельный каталог: у каждой своё имя, иначе удаление
  // отброшенной унесло бы удачную.
  const tries = mediaPath(config, `lesson-${lesson.id}/parts`);
  await mkdir(tries, { recursive: true });
  let attempt = 0;
  let part;
  try {
    part = await cutFirstPart({
      durationMs: Math.round(durationSeconds * 1000),
      totalBytes: video.bytes,
      chapters,
      limitBytes,
      cut: ({ startMs, endMs }) =>
        cutter({
          input,
          output: path.join(tries, `start-${(attempt += 1)}.mp4`),
          startMs,
          endMs
        }),
      discard: (piece) => rm(piece.path, { force: true })
    });
  } catch (error) {
    await rm(tries, { recursive: true, force: true });
    throw error;
  }

  let sending = input;
  let relative = video.path;
  let bytes = video.bytes;
  if (part.path) {
    // Удачный кусок переезжает к записи и попадает в учёт: пост в канале потом
    // правится, приложив его заново.
    relative = `lesson-${lesson.id}/start-${platform}.mp4`;
    sending = mediaPath(config, relative);
    await rename(part.path, sending);
    bytes = Math.round(part.bytes);
    await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'part',
      relativePath: relative,
      bytes
    });
  }
  await rm(tries, { recursive: true, force: true });

  const [size, seconds] = await Promise.all([
    Promise.resolve(frameSize(sending)).catch(() => null),
    Promise.resolve(probe(sending)).catch(() => null)
  ]);

  return {
    path: sending,
    relativePath: relative,
    bytes,
    whole: !part.path,
    ...(size ? { width: size.width, height: size.height } : {}),
    ...(seconds ? { duration: Math.round(seconds) } : {}),
    startMs: part.startMs,
    endMs: part.endMs,
    durationMs: Math.round(durationSeconds * 1000)
  };
}
