// Разбиение записи на куски для расшифровки.
//
// Задача — сделать расход памяти постоянным. Модель держит в памяти всю
// поданную ей запись: замерено 0.65 ГБ на пятнадцати минутах и 0.93 на
// шестидесяти шести. Куском в полчаса расход перестаёт зависеть от длины урока,
// и двухчасовая запись считается так же, как получасовая, а не упирается в
// потолок памяти воркера.
//
// Резать по тишине, а не по часам: разрез посреди слова даёт оборванную реплику
// в конце куска и обрубок в начале следующего — в субтитрах это видно сразу.
// Вызывается из src/services/speech.js.

/** Цель по длине куска. Полчаса — выбор заказчика. */
const TARGET_MS = 30 * 60 * 1000;

// Насколько далеко от цели согласны искать тишину. Пять минут: дальше кусок
// начинает заметно отличаться по длине от соседей.
const TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Планирует куски: массив {startMs, endMs}, встык и без пропусков.
 * silences — найденные паузы в том виде, в каком их отдаёт parseSilences.
 */
export function planChunks({
  durationMs,
  silences = [],
  targetMs = TARGET_MS,
  toleranceMs = TOLERANCE_MS
}) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return [];

  const limitMs = targetMs + toleranceMs;
  // Запись, которая лишь немного длиннее куска, режем зря: лишний запуск модели
  // стоит дороже сэкономленных мегабайт.
  if (durationMs <= limitMs) return [{ startMs: 0, endMs: durationMs }];

  // Делим поровну, а не отрезаем по получасу с огрызком в конце: три куска по
  // двадцать две минуты лучше, чем два по тридцать и один на семь — у ровных
  // кусков одинаковый расход памяти и одинаковое время счёта.
  const parts = Math.ceil(durationMs / limitMs);
  const step = durationMs / parts;

  const middles = silences
    .filter((silence) => Number.isFinite(silence.endMs))
    // Режем по СЕРЕДИНЕ паузы: так ни один звук не достаётся двум кускам сразу
    // и ни один не теряется между ними.
    .map((silence) => Math.round((silence.startMs + silence.endMs) / 2));

  const chunks = [];
  let startMs = 0;

  for (let part = 1; part < parts; part += 1) {
    const wanted = Math.round(step * part);
    const near = middles.filter(
      (middle) => middle > startMs && Math.abs(middle - wanted) <= toleranceMs
    );
    // Тишины рядом нет — режем по часам. Час непрерывной речи бывает, и разрез
    // посреди слова хуже, чем ровный, но лучше, чем нерасшифрованный урок.
    const cut = near.length
      ? near.reduce((best, middle) =>
          Math.abs(middle - wanted) < Math.abs(best - wanted) ? middle : best
        )
      : wanted;

    chunks.push({ startMs, endMs: cut });
    startMs = cut;
  }

  chunks.push({ startMs, endMs: durationMs });
  return chunks;
}

/**
 * Сводит расшифровки кусков в одну.
 *
 * Времена внутри куска идут от нуля — их надо сдвинуть на начало куска. Без
 * этого субтитры второго получаса начались бы заново с начала урока, и заметил
 * бы это зритель, а не мы: в кабинете расшифровка выглядит правдоподобно.
 * Вызывается из src/services/speech.js.
 */
export function mergeChunkResults(parts) {
  const segments = [];
  const texts = [];
  let dropped = 0;

  for (const { startMs, result } of parts) {
    for (const segment of result.segments ?? []) {
      segments.push({
        startedMs: segment.startedMs + startMs,
        endedMs: segment.endedMs + startMs,
        text: segment.text
      });
    }
    if (result.text) texts.push(result.text);
    dropped += result.dropped ?? 0;
  }

  return { text: texts.join(' ').trim(), segments, dropped };
}
