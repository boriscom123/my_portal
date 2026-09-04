// Шаг конвейера: вертикальные нарезки со вшитыми субтитрами.
//
// Задача — достать из часового урока несколько коротких роликов для площадок
// коротких видео. Зачем не по таймеру: нарезка через каждые десять минут
// обрывает мысль на полуслове. Плана глав от модели у нас нет — тексты от
// модели отменены вместе с облаком, — поэтому фрагменты выбираются по самой
// плотной речи: там, где автор говорит без пауз, он обычно и объясняет суть.
//
// Готовые ролики автор смотрит на экране проверки и решает сам: наружу без
// его нажатия ничего не уходит.
// Вызывается воркером по имени JOBS.makeClips.
import { mkdir, stat, writeFile, rm, access } from 'node:fs/promises';
import { runFfmpeg, ffmpegArgsForClip } from '../lib/ffmpeg.js';
import { toSrt, splitLongSegments } from '../lib/srt.js';
import { mediaPath, registerAsset, assetById } from '../services/media.js';
import { addJob } from '../queue.js';

// Длина фрагмента. Минута — потолок площадок; сорок пять секунд оставляют
// запас и не обрывают мысль на полуслове.
const CLIP_SECONDS = 45;

// Сколько нарезок делаем. На двух ядрах каждая — минуты работы, и десяток
// фрагментов занял бы машину на час ради роликов, которые автор всё равно
// отсмотрит по одному.
const MAX_CLIPS = 3;

/**
 * Сдвигает и подрезает реплики под фрагмент.
 * Времена в субтитрах абсолютные, а перемотка до -i обнуляет отсчёт: без
 * сдвига подписи шли бы не в такт — на десятой минуте урока они опережали бы
 * речь на десять минут.
 */
export function shiftSegments(segments, startedMs, endedMs) {
  return segments
    .filter((segment) => segment.endedMs > startedMs && segment.startedMs < endedMs)
    .map((segment) => ({
      startedMs: Math.max(0, segment.startedMs - startedMs),
      endedMs: Math.min(endedMs, segment.endedMs) - startedMs,
      text: segment.text
    }));
}

/**
 * Выбирает, откуда резать: по одному фрагменту из каждой трети урока.
 *
 * Внутри трети берётся окно, где сказано больше всего — считаем по знакам, а
 * не по числу реплик: короткие «ага» и «вот» дали бы плотность там, где на
 * деле пауза.
 *
 * Пустой список — не ошибка: у урока без речи нарезать нечего, и конвейер
 * должен идти дальше.
 */
export function pickClipRanges(segments, durationSeconds, { count = MAX_CLIPS } = {}) {
  if (!segments.length || !durationSeconds) return [];

  const clipMs = CLIP_SECONDS * 1000;
  const limitMs = durationSeconds * 1000;
  const spokenMs = Math.min(segments.at(-1).endedMs, limitMs);
  const zoneMs = spokenMs / count;
  const ranges = [];

  for (let zone = 0; zone < count; zone += 1) {
    const from = zone * zoneMs;
    const to = (zone + 1) * zoneMs;

    let best = null;
    for (const segment of segments) {
      if (segment.startedMs < from || segment.startedMs >= to) continue;
      const startedMs = Math.min(segment.startedMs, Math.max(0, limitMs - clipMs));
      const endedMs = Math.min(startedMs + clipMs, limitMs);
      const weight = segments
        .filter((s) => s.startedMs >= startedMs && s.startedMs < endedMs)
        .reduce((sum, s) => sum + s.text.length, 0);
      if (!best || weight > best.weight) {
        best = { startedMs, endedMs, weight, title: segment.text.slice(0, 80) };
      }
    }

    // Соседние трети могут выбрать одно и то же место, если речь идёт куском:
    // два одинаковых ролика автору не нужны.
    if (best && !ranges.some((range) => Math.abs(range.startedMs - best.startedMs) < clipMs)) {
      ranges.push({ startedMs: best.startedMs, endedMs: best.endedMs, title: best.title });
    }
  }

  return ranges;
}

export function makeMakeClips(config, pool, queue) {
  return async ({ lessonId }) => {
    const { rows } = await pool.query(
      'SELECT source_asset_id, duration_seconds FROM lessons WHERE id = $1',
      [lessonId]
    );
    if (!rows[0]?.source_asset_id) throw new Error('у урока нет исходника');

    const source = await assetById(pool, rows[0].source_asset_id);
    const input = mediaPath(config, source.path);
    try {
      await access(input);
    } catch {
      throw new Error(
        `файла ${source.path} нет в буфере — вероятно, он удалён по сроку; загрузите исходник заново`
      );
    }

    const { rows: segmentRows } = await pool.query(
      `SELECT started_ms, ended_ms, text FROM transcript_segments
        WHERE lesson_id = $1 ORDER BY started_ms`,
      [lessonId]
    );
    const segments = segmentRows.map((row) => ({
      startedMs: Number(row.started_ms),
      endedMs: Number(row.ended_ms),
      text: row.text
    }));

    const ranges = pickClipRanges(segments, rows[0].duration_seconds);
    const dir = `lesson-${lessonId}`;
    await mkdir(mediaPath(config, dir), { recursive: true });

    const made = [];
    for (const [index, range] of ranges.entries()) {
      const subtitles = mediaPath(config, `${dir}/clip-${index + 1}.srt`);
      const relative = `${dir}/clip-${index + 1}.mp4`;
      await writeFile(
        subtitles,
        toSrt(splitLongSegments(shiftSegments(segments, range.startedMs, range.endedMs))),
        'utf8'
      );
      try {
        await runFfmpeg(
          ffmpegArgsForClip({
            input,
            subtitles,
            startSeconds: range.startedMs / 1000,
            durationSeconds: (range.endedMs - range.startedMs) / 1000,
            output: mediaPath(config, relative)
          }),
          // Ролик без подписей смотрят без звука и не понимают — ради подписей
          // нарезка и делается. Пропавший шрифт должен ронять шаг, а не
          // выдавать пустой результат за готовый.
          { failOn: /fontconfig|failed to find any fallback|Glyph 0x/i }
        );
      } finally {
        // Файл субтитров нужен только на время счёта: в буфере он повторяет
        // общие субтитры урока и место занимает зря.
        await rm(subtitles, { force: true });
      }

      const { size } = await stat(mediaPath(config, relative));
      const asset = await registerAsset(pool, config, {
        lessonId,
        kind: 'clip',
        relativePath: relative,
        bytes: size
      });
      made.push({ assetId: asset.id, title: range.title, startedMs: range.startedMs });
    }

    // Нарезки — предпоследний шаг: обложка ставит урок на проверку, и она
    // должна быть последней, иначе автор увидит «ждёт проверки» на середине.
    await addJob(queue, 'makeCover', { lessonId });
    return { clips: made.length };
  };
}
