// Шаг по кнопке: титры в картинку ролика.
//
// Задача — чтобы ролик можно было смотреть без звука: в ленте коротких видео
// его так и смотрят, а отдельный файл субтитров площадки не принимают. Поэтому
// титры вшиваются в кадр, и в каналы и в Instagram уезжает уже файл с ними.
//
// Вшивается всегда с чистого файла, без титров: после правки реплик автор
// вшивает заново, и поверх прежних титров на кадре оказались бы две строки.
// Чистый файл запоминается в shorts.source_asset_id при первом вшивании.
//
// Состояние ложится в shorts.generated.subtitles: страница ждёт его и
// перестаёт ждать, только увидев итог. Отказ не бросается дальше — повторяет
// автор той же кнопкой, а не очередь за его спиной.
// Вызывается воркером по имени JOBS.burnShortSubtitles.
import { access, rm, stat, writeFile } from 'node:fs/promises';
import { runFfmpeg, ffmpegArgsForBurnedSubtitles } from '../lib/ffmpeg.js';
import { toSrt, splitLongSegments } from '../lib/srt.js';
import { DEFAULT_SETTINGS, toAssColor } from '../lib/settings.js';
import { mediaPath, assetById, registerAsset, forgetAsset } from '../services/media.js';
import { getShortById } from '../services/shorts.js';

async function saveState(pool, shortId, state) {
  await pool.query(
    `UPDATE shorts SET generated = jsonb_set(generated, '{subtitles}', $1::jsonb) WHERE id = $2`,
    [JSON.stringify({ ...state, at: new Date().toISOString() }), shortId]
  );
}

export function makeBurnShortSubtitles(config, pool, { ffmpeg = runFfmpeg } = {}) {
  return async ({ shortId }) => {
    const short = await getShortById(pool, shortId);
    if (!short) return { skipped: 'ролика уже нет' };

    const made = [];
    try {
      if (short.lesson) {
        // У нарезки титры вшиты ещё при нарезке — вторые легли бы строкой выше.
        throw new Error('у нарезки из урока титры уже вшиты — их правят на экране урока');
      }
      if (!short.segments.length) throw new Error('сначала расшифруйте ролик');

      const source = await assetById(pool, short.sourceAssetId ?? short.assetId);
      if (!source) throw new Error('файла без титров нет в учёте — загрузите ролик заново');
      const input = mediaPath(config, source.path);
      try {
        await access(input);
      } catch {
        throw new Error(`файла ${source.path} нет в буфере — загрузите ролик заново`);
      }

      // Имя со временем: у площадок и браузеров файл по старому адресу мог
      // остаться в кэше, и заново вшитые титры выглядели бы прежними.
      const dir = `short-${short.id}`;
      const stamp = Date.now();
      const subtitles = mediaPath(config, `${dir}/subtitles-${stamp}.srt`);
      const relative = `${dir}/subtitled-${stamp}.mp4`;
      made.push(mediaPath(config, relative));

      // Длинная реплика во вертикальном кадре занимает полэкрана — дробим, как
      // у нарезок.
      await writeFile(subtitles, toSrt(splitLongSegments(short.segments)), 'utf8');
      try {
        await ffmpeg(
          ffmpegArgsForBurnedSubtitles({
            input,
            subtitles,
            output: mediaPath(config, relative),
            style: {
              color: toAssColor(DEFAULT_SETTINGS.subtitleColor),
              outline: DEFAULT_SETTINGS.subtitleOutline
            }
          }),
          // Пропавший шрифт даёт ролик без титров, который выглядит готовым.
          { failOn: /fontconfig|failed to find any fallback|Glyph 0x/i }
        );
      } finally {
        await rm(subtitles, { force: true });
      }

      const asset = await registerAsset(pool, config, {
        shortId: short.id,
        kind: 'vertical',
        relativePath: relative,
        bytes: (await stat(mediaPath(config, relative))).size
      });

      // Прежний вшитый файл больше не нужен: чистый остаётся исходником.
      const previous = short.sourceAssetId ? await assetById(pool, short.assetId) : null;
      await pool.query('UPDATE shorts SET asset_id = $1, source_asset_id = $2 WHERE id = $3', [
        asset.id,
        source.id,
        short.id
      ]);
      // Файл уже в ролике — при сбое ниже удалять его нельзя.
      made.length = 0;
      if (previous && previous.id !== source.id) {
        await forgetAsset(pool, previous.id);
        await rm(mediaPath(config, previous.path), { force: true });
      }

      await saveState(pool, short.id, { state: 'done' });
      return { assetId: asset.id };
    } catch (error) {
      for (const file of made) await rm(file, { force: true });
      await saveState(pool, short.id, { state: 'failed', error: error.message.slice(0, 300) });
      return { failed: error.message };
    }
  };
}
