// Подпись к посту в канале.
//
// Задача — собрать текст, который уходит в Telegram и MAX, и собрать его
// одинаково дважды: при отправке и потом, когда в пост добавляются ссылки на
// вышедшие ролики. Разойдись эти два места — и правка поста меняла бы не
// только ссылки, но и текст, который люди уже прочитали.
// Вызывается из шагов выкладки в каналы.

// Предел подписи к картинке в Telegram. У MAX он больше, но пост один и тот
// же: две разные подписи к одному уроку — это две разные правды.
export const TELEGRAM_CAPTION_LIMIT = 1024;

/** Как называется площадка в подписи. Слаг человеку не годится. */
const PLATFORM_NAMES = {
  youtube: 'YouTube',
  vk: 'VK Video',
  rutube: 'RuTube',
  dzen: 'Дзен',
  telegram: 'Telegram',
  max: 'MAX'
};

/** Обрезает по границе предложения, а если её нет — по границе слова. */
function trimToSentence(text, limit) {
  const value = String(text ?? '').trim();
  if (value.length <= limit) return value;

  const cut = value.slice(0, limit);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (lastStop > limit / 3) return cut.slice(0, lastStop + 1);

  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit / 3 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/**
 * Текст поста: заголовок, описание, ссылка на урок и ссылки на вышедшие ролики.
 *
 * skipPlatform — площадка, в чей канал этот пост уходит: ссылка на самого себя
 * в подписи выглядит ошибкой.
 */
export function buildAnnouncement({
  lesson,
  publicBaseUrl,
  publications = [],
  skipPlatform = null,
  limit = TELEGRAM_CAPTION_LIMIT
}) {
  const lessonLink = `${publicBaseUrl}/lesson/${lesson.slug}`;

  // Только вышедшее: приватный ролик подписчику не открывается, и звать его
  // туда нечестно.
  const links = publications
    .filter(
      (item) => item.state === 'published' && item.url && item.platform !== skipPlatform
    )
    .map((item) => `${PLATFORM_NAMES[item.platform] ?? item.platform}: ${item.url}`);

  const tail = [lessonLink, ...links].join('\n');
  const head = `${lesson.title}\n\n`;
  // Место под описание — то, что осталось от предела после заголовка и ссылок:
  // ссылки важнее описания, ради них пост и правится.
  const room = limit - head.length - tail.length - 2;
  const description = room > 40 ? trimToSentence(lesson.description ?? '', room) : '';

  return `${head}${description ? `${description}\n\n` : ''}${tail}`;
}
