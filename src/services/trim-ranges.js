// Отрезки записи, которые оставил монтаж.
//
// Задача — переводить время со шкалы исходной записи на смонтированную: главы
// считаются по исходной, а в каналы и на YouTube уезжает смонтированная — без
// пауз. Монтаж отрезки вычислял и выбрасывал, поэтому главы на YouTube «убегали»
// вперёд на сумму вырезанных пауз. Теперь шаг монтажа их сохраняет, а для
// уроков, смонтированных раньше, они считаются один раз заново и тоже
// сохраняются.
// Вызывается из src/jobs/trim-pauses.js, src/jobs/publish-youtube.js и
// src/jobs/publish-lesson-parts.js.
import { access } from 'node:fs/promises';
import { detectSilence } from '../lib/ffmpeg.js';
import { keepRanges } from '../lib/trim.js';
import { readSettings } from '../lib/settings.js';
import { assetsOfLesson, mediaPath } from './media.js';

/** Запоминает отрезки монтажа у урока — рядом с главами, не трогая их. */
export async function saveTrimRanges(pool, lessonId, ranges) {
  await pool.query(
    `UPDATE lessons SET generated = generated || jsonb_build_object('trimRanges', $2::jsonb)
      WHERE id = $1`,
    [lessonId, JSON.stringify(ranges)]
  );
}

/**
 * Отрезки монтажа урока: сохранённые, а если их нет — посчитанные тем же
 * путём, что у монтажа. Звуковая дорожка живёт в буфере 3,5 дня, запись —
 * неделю: если дорожки нет, тишина ищется по самой записи.
 */
export async function ensureTrimRanges(config, pool, lesson, { detect = detectSilence } = {}) {
  if (lesson.trimRanges?.length) return lesson.trimRanges;

  const assets = await assetsOfLesson(pool, lesson.id);
  const candidates = [
    ...assets.filter((asset) => asset.kind === 'audio').reverse(),
    ...assets.filter((asset) => asset.kind === 'source')
  ];
  let soundPath = null;
  for (const asset of candidates) {
    try {
      await access(mediaPath(config, asset.path));
      soundPath = mediaPath(config, asset.path);
      break;
    } catch {
      // Файл удалён по сроку — пробуем следующий.
    }
  }
  if (!soundPath) throw new Error('ни звуковой дорожки, ни записи урока нет в буфере');

  const silences = await detect(soundPath, {
    minPauseSeconds: readSettings(lesson.settings).minPauseSeconds
  });
  const ranges = keepRanges(silences, { durationSeconds: lesson.durationSeconds });
  await saveTrimRanges(pool, lesson.id, ranges);
  return ranges;
}
