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
 * Собирает куски, которые остаются в записи.
 * Соседние реплики сливаются, если промежуток между ними короче заданного:
 * дыхание и короткая пауза между фразами — это ещё речь, и вырезать их значит
 * сделать урок неслушаемым.
 */
export function keepRanges(segments, { minPauseSeconds = 2, durationSeconds = 0 } = {}) {
  if (!segments.length) return [];

  const minGapMs = minPauseSeconds * 1000;
  const limitMs = durationSeconds ? durationSeconds * 1000 : Infinity;
  const ranges = [];

  for (const segment of segments) {
    const startedMs = Math.max(0, segment.startedMs - PAD_MS);
    const endedMs = Math.min(limitMs, segment.endedMs + PAD_MS);
    const last = ranges.at(-1);

    if (last && startedMs - last.endedMs < minGapMs) {
      last.endedMs = Math.max(last.endedMs, endedMs);
      continue;
    }
    ranges.push({ startedMs, endedMs });
  }

  // Кусок короче четверти секунды — это щелчок, а не речь: на монтаже он даёт
  // рывок и ничего не добавляет.
  return ranges.filter((range) => range.endedMs - range.startedMs >= 250);
}

/** Сколько времени останется в смонтированной записи, в миллисекундах. */
export function trimmedDurationMs(ranges) {
  return ranges.reduce((sum, range) => sum + (range.endedMs - range.startedMs), 0);
}

/**
 * Пересчитывает времена реплик на новую шкалу.
 * Без этого субтитры смонтированной записи показывали бы реплики по старым
 * временам — то есть всё сильнее опаздывали бы к концу урока.
 * Реплики, целиком попавшие в вырезанное, исчезают: показывать их негде.
 */
export function remapSegments(segments, ranges) {
  const result = [];

  for (const segment of segments) {
    let offsetMs = 0;
    for (const range of ranges) {
      if (segment.startedMs >= range.endedMs) {
        offsetMs += range.endedMs - range.startedMs;
        continue;
      }
      if (segment.endedMs <= range.startedMs) break;

      // Реплика может выходить за края куска — подрезаем по нему.
      const startedMs = Math.max(segment.startedMs, range.startedMs);
      const endedMs = Math.min(segment.endedMs, range.endedMs);
      result.push({
        startedMs: offsetMs + (startedMs - range.startedMs),
        endedMs: offsetMs + (endedMs - range.startedMs),
        text: segment.text
      });
      break;
    }
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
