// Главы для описания ролика.
//
// Задача — превратить предложенное моделью в то, что площадка действительно
// покажет. Правила у YouTube жёсткие и молчаливые: первая глава ровно с 00:00,
// их не меньше трёх, каждая не короче десяти секунд. Не сходится — не
// показывается НИ ОДНОЙ, без предупреждения, и узнать об этом можно только
// открыв вышедший ролик.
//
// Поэтому проверяем сами и негодный список отбрасываем целиком: ролик без глав
// честнее ролика с проигнорированными строками в описании.
// Вызывается из src/services/platforms/youtube-fields.js и с экрана проверки.

// Пределы площадки.
const MIN_CHAPTERS = 3;
const MIN_GAP_MS = 10_000;

/** Время в том виде, в каком его читает площадка: 0:00, 5:30, 1:05:30. */
export function formatTimecode(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = String(total % 60).padStart(2, '0');
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  // Часы появляются только когда они есть: «0:05:30» площадка понимает, а
  // человек читает хуже.
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/**
 * Разбирает время из ответа модели: «5:30», «1:05:30», «0:00».
 * NaN — не разобрали; такая глава дальше отсеется.
 */
export function parseTimecode(value) {
  const parts = String(value ?? '')
    .trim()
    .split(':')
    .map((part) => Number(part));
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return NaN;

  const seconds = parts.reverse().reduce((total, part, index) => total + part * 60 ** index, 0);
  return Math.round(seconds * 1000);
}

/**
 * Оставляет главы, которые площадка покажет. Пустой массив — показывать нечего.
 * durationMs — длина записи: глава за её пределом бессмысленна.
 */
export function validChapters(chapters, durationMs = Infinity) {
  const cleaned = (chapters ?? [])
    .map((chapter) => ({
      atMs: Math.round(Number(chapter?.atMs ?? chapter?.at ?? -1)),
      title: String(chapter?.title ?? '').trim()
    }))
    .filter((chapter) => Number.isFinite(chapter.atMs) && chapter.atMs >= 0)
    .filter((chapter) => chapter.atMs < durationMs)
    // Порядок восстанавливаем, а не считаем ошибкой: модель иногда возвращает
    // главы вперемешку, и это не повод остаться без них.
    .sort((first, second) => first.atMs - second.atMs);

  if (cleaned.length < MIN_CHAPTERS) return [];
  // Первая обязана быть с нуля — это правило площадки, а не наше.
  if (cleaned[0].atMs !== 0) return [];
  // Пустое название — верный признак, что список собран плохо целиком.
  if (cleaned.some((chapter) => !chapter.title)) return [];
  // Слишком близкие главы означают, что паузу приняли за смену темы.
  for (let i = 1; i < cleaned.length; i += 1) {
    if (cleaned[i].atMs - cleaned[i - 1].atMs < MIN_GAP_MS) return [];
  }
  return cleaned;
}

/** Блок для описания ролика. Пустая строка — глав нет. */
export function chaptersBlock(chapters) {
  if (!chapters?.length) return '';
  return chapters.map((chapter) => `${formatTimecode(chapter.atMs)} ${chapter.title}`).join('\n');
}

/**
 * Сводит реплики в короткую ленту «время — о чём говорят» для запроса к модели.
 *
 * Целиком реплики слать нельзя: у часового урока их под тысячу, и запрос
 * раздувается до бессмысленного. Берём по одной реплике на каждые полминуты —
 * этого хватает, чтобы увидеть, где сменилась тема, а именно это от модели и
 * нужно.
 * Вызывается из src/jobs/suggest-texts.js.
 */
export function buildTimeline(segments, { stepMs = 30_000, maxLines = 200, maxChars = 90 } = {}) {
  const lines = [];
  let nextAt = 0;

  for (const segment of segments ?? []) {
    if (segment.startedMs < nextAt) continue;
    const text = String(segment.text ?? '').trim().slice(0, maxChars);
    if (!text) continue;
    lines.push(`${formatTimecode(segment.startedMs)} ${text}`);
    nextAt = segment.startedMs + stepMs;
    if (lines.length >= maxLines) break;
  }
  return lines.join('\n');
}

/**
 * Разбирает главы из текста: по строке на главу, «0:00 Название».
 *
 * Правятся они именно текстом, а не списком полей: так автор видит ровно то,
 * что уедет в описание ролика, и правит одной строкой вместо трёх нажатий.
 * Вызывается из src/routes/admin.js.
 */
export function parseChaptersText(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d{1,2}(?::\d{1,2}){1,2})\s+(.+)$/);
      if (!match) return null;
      return { atMs: parseTimecode(match[1]), title: match[2].trim() };
    })
    .filter((chapter) => chapter && Number.isFinite(chapter.atMs) && chapter.title);
}
