// Шаг конвейера: исходник → звуковая дорожка.
//
// Задача — получить лёгкий файл, который можно отдать сервису распознавания.
// Зачем отдельным шагом, а не частью расшифровки: извлечение занимает минуты,
// и при повторе после сбоя сети переделывать его незачем — результат уже
// лежит в буфере и записан в базу.
// Вызывается воркером по имени JOBS.extractAudio.
import { mkdir, stat, access } from 'node:fs/promises';
import path from 'node:path';
import { runFfmpeg, ffmpegArgsForAudio, probeDuration } from '../lib/ffmpeg.js';
import { mediaPath, registerAsset, assetById } from '../services/media.js';
import { addJob } from '../queue.js';

export function makeExtractAudio(config, pool, queue) {
  return async ({ lessonId }) => {
    const { rows } = await pool.query('SELECT source_asset_id FROM lessons WHERE id = $1', [
      lessonId
    ]);
    const sourceId = rows[0]?.source_asset_id;
    if (!sourceId) throw new Error('у урока нет исходника');

    const source = await assetById(pool, sourceId);
    if (!source) throw new Error('исходник записан за уроком, но пропал из учёта');

    const input = mediaPath(config, source.path);
    // Проверяем файл до запуска ffmpeg: его вывод «No such file» верен, но
    // человеку в кабинете ничего не объясняет. Файл исчезает буднично — после
    // уборки буфера по сроку.
    try {
      await access(input);
    } catch {
      throw new Error(
        `файла ${source.path} нет в буфере — вероятно, он удалён по сроку; загрузите исходник заново`
      );
    }
    const relative = `${path.dirname(source.path)}/audio.ogg`;
    const output = mediaPath(config, relative);
    await mkdir(path.dirname(output), { recursive: true });

    await runFfmpeg(ffmpegArgsForAudio(input, output));

    const { size } = await stat(output);
    const asset = await registerAsset(pool, config, {
      lessonId,
      kind: 'audio',
      relativePath: relative,
      bytes: size
    });

    // Длительность урока пригодится карточке и нарезке: узнаём один раз здесь,
    // пока исходник ещё в буфере.
    const duration = await probeDuration(input);
    if (duration) {
      await pool.query('UPDATE lessons SET duration_seconds = $1 WHERE id = $2', [
        Math.round(duration),
        lessonId
      ]);
    }

    // Следующий шаг ставим сами: знание о порядке конвейера живёт в шагах, а
    // не размазано по вызывающим.
    await addJob(queue, 'transcribe', { lessonId, audioAssetId: asset.id });
    return { audioAssetId: asset.id, bytes: size, duration };
  };
}
