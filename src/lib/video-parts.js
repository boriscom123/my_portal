// Нарезка записи урока на части для каналов.
//
// Задача — как можно меньше частей, каждая не тяжелее предела площадки.
// Режем по главам: часть набирает главы подряд, пока помещается. Вес не
// угадываем по средней плотности, а меряем: у записи экрана он «плавает» —
// неподвижный экран лёгкий, движение тяжёлое. Резка без пережатия идёт секунды,
// поэтому примерка дешёвая. Жадная набивка глав подряд даёт наименьшее число
// частей при резке по порядку.
// Резка и удаление подставляются доводом: так алгоритм проверяется без ffmpeg.
// Вызывается из src/jobs/publish-lesson-parts.js.

// Запас от предела площадки: вес контейнера и округления не должны
// перевалить часть через предел на последнем мегабайте.
export const SIZE_MARGIN = 0.95;
// Часть легче этой доли предела — пробуем добавить следующую главу.
export const GROW_BELOW = 0.85;

/** Единицы резки: главы с границами. Без глав — одна единица на всю запись. */
function unitsOf(chapters, durationMs) {
  if (!chapters.length) return [{ startMs: 0, endMs: durationMs, chapters: [] }];
  return chapters.map((chapter, index) => ({
    startMs: chapter.atMs,
    endMs: chapters[index + 1]?.atMs ?? durationMs,
    chapters: [chapter]
  }));
}

/**
 * Делит одну единицу на наименьшее число равных по времени кусков, каждый не
 * тяжелее предела. Не влез хоть один — кусков становится на один больше.
 */
async function splitEvenly(unit, { limit, perMs, cut, discard }) {
  let count = Math.max(2, Math.ceil(((unit.endMs - unit.startMs) * perMs) / limit));
  for (;;) {
    const step = (unit.endMs - unit.startMs) / count;
    const pieces = [];
    for (let n = 0; n < count; n += 1) {
      const startMs = Math.round(unit.startMs + step * n);
      const endMs = n === count - 1 ? unit.endMs : Math.round(unit.startMs + step * (n + 1));
      pieces.push({ startMs, endMs, ...(await cut({ startMs, endMs })) });
    }
    if (pieces.every((piece) => piece.bytes <= limit)) {
      return pieces.map((piece, n) => ({
        startMs: piece.startMs,
        endMs: piece.endMs,
        chapters: unit.chapters,
        // Кусок главы подписывается «Глава 2 · 1 из 3»; у записи без глав
        // куски — просто части, номер им даст подпись.
        piece: unit.chapters.length ? { n: n + 1, of: count } : null,
        path: piece.path,
        bytes: piece.bytes
      }));
    }
    for (const piece of pieces) await discard(piece);
    count += 1;
  }
}

/**
 * Режет запись на части. Отдаёт их по порядку: границы, главы внутри, путь к
 * файлу части и её вес. Путь null — часть совпадает с записью целиком, резать
 * было незачем.
 */
export async function splitIntoParts({
  durationMs,
  totalBytes,
  chapters = [],
  limitBytes,
  cut,
  discard = async () => {}
}) {
  const limit = Math.floor(limitBytes * SIZE_MARGIN);
  if (totalBytes <= limit) {
    return [{ startMs: 0, endMs: durationMs, chapters, piece: null, path: null, bytes: totalBytes }];
  }

  const units = unitsOf(chapters, durationMs);
  const perMs = totalBytes / durationMs;
  const parts = [];
  let first = 0;

  while (first < units.length) {
    // Оценка по средней плотности — только отправная точка.
    let last = first;
    while (last + 1 < units.length && (units[last + 1].endMs - units[first].startMs) * perMs <= limit) {
      last += 1;
    }

    const range = (to) => ({ startMs: units[first].startMs, endMs: units[to].endMs });
    let piece = await cut(range(last));

    // Не влезла — убираем последнюю главу и режем снова.
    while (piece.bytes > limit && last > first) {
      await discard(piece);
      last -= 1;
      piece = await cut(range(last));
    }

    // Одна глава (или запись без глав) сама тяжелее предела — делится на куски.
    if (piece.bytes > limit) {
      await discard(piece);
      parts.push(...(await splitEvenly(units[first], { limit, perMs, cut, discard })));
      first += 1;
      continue;
    }

    // Влезла с большим запасом — пробуем добавить следующую главу.
    while (last + 1 < units.length && piece.bytes < limit * GROW_BELOW) {
      const bigger = await cut(range(last + 1));
      if (bigger.bytes > limit) {
        await discard(bigger);
        break;
      }
      await discard(piece);
      piece = bigger;
      last += 1;
    }

    parts.push({
      ...range(last),
      chapters: units.slice(first, last + 1).flatMap((unit) => unit.chapters),
      piece: null,
      path: piece.path,
      bytes: piece.bytes
    });
    first = last + 1;
  }
  return parts;
}
