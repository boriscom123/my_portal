// Шаг конвейера: кадр на обложку.
//
// Задача — получить картинку для карточки урока и превью в мессенджерах.
// Зачем не первый кадр: там заставка и «здравствуйте», а на превью нужен
// содержательный кадр.
// Вызывается воркером по имени JOBS.makeCover.
import { mkdir, stat, access } from 'node:fs/promises';
import path from 'node:path';
import { runFfmpeg, ffmpegArgsForCover } from '../lib/ffmpeg.js';
import { mediaPath, registerAsset, assetById } from '../services/media.js';

// Доля урока, с которой берём кадр. Десятая часть: заставка уже кончилась, а
// до сути автор дошёл. Нижняя граница — на случай очень коротких роликов.
const COVER_SHARE = 0.1;
const MIN_SECONDS = 12;

/** С какой секунды брать кадр. */
export function coverTimeSeconds(durationSeconds) {
  if (!durationSeconds || durationSeconds <= MIN_SECONDS) {
    return Math.max(0, Math.floor((durationSeconds ?? 0) / 2));
  }
  return Math.max(MIN_SECONDS, Math.floor(durationSeconds * COVER_SHARE));
}

export function makeMakeCover(config, pool) {
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

    const dir = path.dirname(source.path);
    const relative = `${dir}/cover.jpg`;
    await mkdir(mediaPath(config, dir), { recursive: true });

    await runFfmpeg(
      ffmpegArgsForCover({
        input,
        atSeconds: coverTimeSeconds(rows[0].duration_seconds),
        output: mediaPath(config, relative)
      })
    );

    const { size } = await stat(mediaPath(config, relative));
    const asset = await registerAsset(pool, config, {
      lessonId,
      kind: 'cover',
      relativePath: relative,
      bytes: size
    });

    // Обложка — единственный файл буфера, который видят все: она стоит в
    // карточке урока и в превью ссылки, поэтому адрес у неё постоянный, а не
    // временный.
    await pool.query(
      `UPDATE lessons SET cover_url = $1, pipeline_state = 'review', pipeline_error = NULL
        WHERE id = $2`,
      [`/media/asset/${asset.id}`, lessonId]
    );

    return { coverAssetId: asset.id, bytes: size };
  };
}
