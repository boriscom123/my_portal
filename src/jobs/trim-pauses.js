// Шаг конвейера: запись с вырезанными паузами.
//
// Задача — из часовой записи с молчаливыми участками получить плотную, которую
// не стыдно залить на площадку. Зачем отдельным файлом, а не заменой
// исходника: исходник нужен, чтобы смонтировать заново с другими настройками,
// и терять его при первой же перемонтировке нельзя.
//
// Шаг выполняется только если автор его включил: пересжатие часовой записи
// занимает у машины полчаса, и делать это без спроса нельзя.
// Вызывается воркером по имени JOBS.trimPauses.
import { mkdir, stat, writeFile, rm, access } from 'node:fs/promises';
import { runFfmpeg, ffmpegArgsForTrim, detectSilence } from '../lib/ffmpeg.js';
import { keepRanges, remapSegments, trimmedDurationMs, concatList } from '../lib/trim.js';
import { toSrt, toVtt } from '../lib/srt.js';
import { readSettings } from '../lib/settings.js';
import { mediaPath, registerAsset, assetById } from '../services/media.js';
import { addJob } from '../queue.js';

export function makeTrimPauses(config, pool, queue) {
  return async ({ lessonId }) => {
    const { rows } = await pool.query(
      'SELECT source_asset_id, duration_seconds, settings FROM lessons WHERE id = $1',
      [lessonId]
    );
    if (!rows[0]) throw new Error('урок не найден');

    const settings = readSettings(rows[0].settings);
    if (!settings.cutPauses) {
      await addJob(queue, 'makeClips', { lessonId });
      return { skipped: 'вырезание пауз выключено в настройках урока' };
    }

    if (!rows[0].source_asset_id) throw new Error('у урока нет исходника');
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

    // Паузы меряем по звуковой дорожке, а не по промежуткам между репликами:
    // у реплик после отсечения тишины границы крупные, и пауза сидит внутри
    // реплики. Считаем по извлечённому звуку — он лёгкий, разбор идёт в сотни
    // раз быстрее реального времени.
    const { rows: audioRows } = await pool.query(
      `SELECT path FROM assets WHERE lesson_id = $1 AND kind = 'audio' ORDER BY id DESC LIMIT 1`,
      [lessonId]
    );
    const soundPath = audioRows[0] ? mediaPath(config, audioRows[0].path) : input;
    const silences = await detectSilence(soundPath, {
      minPauseSeconds: settings.minPauseSeconds
    });

    const ranges = keepRanges(silences, { durationSeconds: rows[0].duration_seconds });
    if (!ranges.length) {
      // Речи в записи нет — резать нечего, и пустой файл автору не нужен.
      await addJob(queue, 'makeClips', { lessonId });
      return { skipped: 'речи в записи не нашлось' };
    }

    const dir = `lesson-${lessonId}`;
    await mkdir(mediaPath(config, dir), { recursive: true });
    const listPath = mediaPath(config, `${dir}/trim-list.txt`);
    const relative = `${dir}/trimmed.mp4`;

    await writeFile(listPath, concatList(input, ranges), 'utf8');
    try {
      await runFfmpeg(ffmpegArgsForTrim({ listPath, output: mediaPath(config, relative) }));
    } finally {
      await rm(listPath, { force: true });
    }

    const { size } = await stat(mediaPath(config, relative));
    await registerAsset(pool, config, {
      lessonId,
      kind: 'trimmed',
      relativePath: relative,
      bytes: size
    });

    // Субтитры к смонтированной записи — свои: по старым временам они
    // опаздывали бы тем сильнее, чем дальше к концу урока.
    const moved = remapSegments(segments, ranges);
    for (const [name, content] of [
      [`${dir}/trimmed.srt`, toSrt(moved)],
      [`${dir}/trimmed.vtt`, toVtt(moved)]
    ]) {
      await writeFile(mediaPath(config, name), content, 'utf8');
      const { size: bytes } = await stat(mediaPath(config, name));
      await registerAsset(pool, config, {
        lessonId,
        kind: 'subtitles',
        relativePath: name,
        bytes
      });
    }

    await addJob(queue, 'makeClips', { lessonId });
    return {
      ranges: ranges.length,
      silences: silences.length,
      wasSeconds: rows[0].duration_seconds,
      becameSeconds: Math.round(trimmedDurationMs(ranges) / 1000)
    };
  };
}
