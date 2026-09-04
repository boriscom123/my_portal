// Монтаж записи: выбрасывание пауз.
//
// Задача — из часовой записи с длинными молчаливыми участками получить
// плотную. Зачем от реплик расшифровки, а не вторым проходом по звуку: реплики
// уже знают, где речь — их границы поставило то же отсечение тишины, которым
// считалась расшифровка. Второй проход дал бы второй ответ на тот же вопрос, и
// однажды они разошлись бы.
//
// Здесь только счёт, без запуска ffmpeg: границы кусков и пересчёт времён —
// то место, где ошибка не видна на глаз, и её надо проверять тестом.
// Вызывается из src/jobs/trim-pauses.js.

// Насколько расширяем кусок речи в обе стороны. Без запаса срез приходится на
// первый и последний звук слова, и речь звучит обрубленной.
const PAD_MS = 250;

/**
 * Собирает куски, которые остаются в записи: всё, что не тишина.
 *
 * Каждый кусок расширяется на запас в обе стороны — без него срез приходится
 * на первый и последний звук слова, и речь звучит обрубленной. От запаса куски
 * могут наложиться друг на друга, поэтому наложившиеся сливаются.
 */
export function keepRanges(silences, { durationSeconds = 0 } = {}) {
  const limitMs = Math.round(durationSeconds * 1000);
  if (!limitMs) return [];

  const ranges = [];
  let cursorMs = 0;

  for (const silence of silences) {
    const startMs = Math.max(0, Number(silence.startMs) || 0);
    const endMs = silence.endMs === null ? limitMs : Math.min(limitMs, Number(silence.endMs));
    if (startMs > cursorMs) ranges.push({ startedMs: cursorMs, endedMs: Math.min(startMs, limitMs) });
    cursorMs = Math.max(cursorMs, endMs);
  }
  if (cursorMs < limitMs) ranges.push({ startedMs: cursorMs, endedMs: limitMs });

  const padded = [];
  for (const range of ranges) {
    const startedMs = Math.max(0, range.startedMs - PAD_MS);
    const endedMs = Math.min(limitMs, range.endedMs + PAD_MS);
    const last = padded.at(-1);
    if (last && startedMs <= last.endedMs) {
      last.endedMs = Math.max(last.endedMs, endedMs);
      continue;
    }
    padded.push({ startedMs, endedMs });
  }

  // Кусок короче четверти секунды — щелчок, а не речь: на монтаже он даёт
  // рывок и ничего не добавляет.
  return padded.filter((range) => range.endedMs - range.startedMs >= 250);
}

/** Сколько времени останется в смонтированной записи, в миллисекундах. */
export function trimmedDurationMs(ranges) {
  return ranges.reduce((sum, range) => sum + (range.endedMs - range.startedMs), 0);
}

/**
 * Переводит миг старой записи в миг смонтированной.
 * Время из вырезанного куска отображается в точку склейки: реплика, начавшаяся
 * в тишине, начнётся там, где эта тишина кончилась.
 */
export function mapTime(ms, ranges) {
  let offsetMs = 0;
  for (const range of ranges) {
    if (ms < range.startedMs) return offsetMs;
    if (ms <= range.endedMs) return offsetMs + (ms - range.startedMs);
    offsetMs += range.endedMs - range.startedMs;
  }
  return offsetMs;
}

/**
 * Пересчитывает времена реплик на новую шкалу.
 * Без этого субтитры смонтированной записи опаздывали бы тем сильнее, чем
 * дальше к концу урока — а заметно это стало бы уже на площадке.
 *
 * Начало и конец переводятся по отдельности, потому что реплика после
 * отсечения тишины бывает длинной и перекрывает вырезанное: в смонтированной
 * записи она просто становится короче.
 */
export function remapSegments(segments, ranges) {
  const result = [];

  for (const segment of segments) {
    const startedMs = mapTime(segment.startedMs, ranges);
    const endedMs = mapTime(segment.endedMs, ranges);
    // Реплика целиком попала в вырезанное — показывать её негде.
    if (endedMs <= startedMs) continue;
    result.push({ startedMs, endedMs, text: segment.text });
  }

  return result;
}

/**
 * Список кусков для склейки, в формате демультиплексора concat.
 *
 * Зачем списком в файле, а не фильтром в командной строке: кусков на часовом
 * уроке набирается под сотню, и фильтр из сотни trim и concat — это гигантский
 * граф, который ffmpeg собирает в памяти целиком. Список читается по строке.
 * Одинарные кавычки в пути экранируются по правилам этого формата.
 */
export function concatList(sourcePath, ranges) {
  const escaped = String(sourcePath).replace(/'/g, "'\\''");
  return ranges
    .map(
      (range) =>
        `file '${escaped}'\ninpoint ${(range.startedMs / 1000).toFixed(3)}\n` +
        `outpoint ${(range.endedMs / 1000).toFixed(3)}\n`
    )
    .join('');
}
