// Начало записи урока для канала.
//
// Задача — вырезать один кусок от начала, не тяжелее предела площадки: в канал
// уходит обложка и начало урока, а смотреть целиком зритель идёт на площадки.
// Режем по главам, чтобы кусок обрывался на смене темы, а не посреди фразы.
// Вес не угадываем по средней плотности, а меряем: у записи экрана он
// «плавает» — неподвижный экран лёгкий, движение тяжёлое. Резка без пережатия
// идёт секунды, поэтому примерка дешёвая.
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

// Сколько примерок делать, отмеряя кусок временем: каждая — вызов ffmpeg.
const SLICE_TRIES = 4;

/**
 * Вырезает начало записи — один кусок не тяжелее предела площадки.
 *
 * В канал уходит обложка и начало урока, а смотреть целиком зритель идёт на
 * площадки. Нарезать ради этого всю запись значит занять ffmpeg на минуты и
 * выбросить сделанное, поэтому режется ровно один кусок: сперва по границам
 * глав, а если тяжела и первая глава — по времени, с примеркой веса.
 * Путь null — запись целиком легче предела, резать нечего.
 * Вызывается из src/jobs/publish-lesson-parts.js.
 */
export async function cutFirstPart({
  durationMs,
  totalBytes,
  chapters = [],
  limitBytes,
  cut,
  discard = async () => {}
}) {
  const limit = Math.floor(limitBytes * SIZE_MARGIN);
  if (totalBytes <= limit) {
    return { startMs: 0, endMs: durationMs, chapters, piece: null, path: null, bytes: totalBytes };
  }

  const units = unitsOf(chapters, durationMs);
  const perMs = totalBytes / durationMs;
  const range = (to) => ({ startMs: 0, endMs: units[to].endMs });

  // Оценка по средней плотности — только отправная точка, вес меряем резкой.
  let last = 0;
  while (last + 1 < units.length && units[last + 1].endMs * perMs <= limit) last += 1;

  let piece = await cut(range(last));
  while (piece.bytes > limit && last > 0) {
    await discard(piece);
    last -= 1;
    piece = await cut(range(last));
  }

  if (piece.bytes <= limit) {
    // Влез с большим запасом — пробуем прихватить следующую главу.
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
    return {
      startMs: 0,
      endMs: units[last].endMs,
      chapters: units.slice(0, last + 1).flatMap((unit) => unit.chapters),
      piece: null,
      path: piece.path,
      bytes: piece.bytes
    };
  }

  // Даже первая глава тяжелее предела — отмеряем кусок временем.
  await discard(piece);
  let endMs = Math.min(units[0].endMs, Math.max(1000, Math.round(limit / perMs)));
  for (let attempt = 0; attempt < SLICE_TRIES; attempt += 1) {
    const slice = await cut({ startMs: 0, endMs });
    if (slice.bytes <= limit) {
      return {
        startMs: 0,
        endMs,
        chapters: units[0].chapters,
        piece: null,
        path: slice.path,
        bytes: slice.bytes
      };
    }
    await discard(slice);
    // Промахнулись — укорачиваем по измеренной плотности, с запасом.
    endMs = Math.max(1000, Math.round(endMs * (limit / slice.bytes) * SIZE_MARGIN));
  }
  throw new Error('Не вышло вырезать начало записи в предел площадки');
}

