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

/**
 * Текст поста о новости: заголовок, начало текста и ссылка на страницу.
 *
 * Начало, а не весь текст: новость бывает длиннее подписи к картинке, и
 * дописать её в канале уже нечем. Обрывать посреди слова нельзя — читатель
 * решит, что пост сломался, — поэтому режем по концу предложения, а ссылка
 * остаётся всегда: ради неё пост и отправляется.
 */
export function buildNewsAnnouncement({ item, publicBaseUrl, limit = TELEGRAM_CAPTION_LIMIT }) {
  const link = `${publicBaseUrl}/news/${item.slug}`;
  const head = `${item.title}\n\n`;
  const room = limit - head.length - link.length - 2;
  const body = room > 40 ? trimToSentence(item.body ?? '', room) : '';

  return `${head}${body ? `${body}\n\n` : ''}${link}`;
}

/**
 * Приводит адрес канала к тому виду, который понимает площадка.
 * null — адрес не годится, и сказать об этом надо сразу: ссылка-приглашение
 * выглядит как адрес, но постить по ней нельзя.
 *
 * Зачем вообще: человек копирует ссылку на канал — она у него под рукой, — а
 * Telegram по ссылке канал не ищет и отвечает «chat not found» уже при отправке.
 * Вызывается из src/routes/integrations.js.
 */
export function normalizeChannel(platform, value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (platform !== 'telegram') return raw;

  // Закрытый канал адресуется числом: имени у него нет, и собака его сломает.
  if (/^-?\d+$/.test(raw)) return raw;

  const withoutHost = raw.replace(/^https?:\/\//i, '').replace(/^t\.me\//i, '');
  const name = withoutHost.replace(/^@/, '').replace(/\/+$/, '');

  // Приглашение, а не адрес: t.me/+AbC и старое t.me/joinchat/AbC.
  if (!name || name.startsWith('+') || /^joinchat\//i.test(name)) return null;
  // Ссылка на отдельный пост — берём из неё канал, а не номер сообщения.
  return `@${name.split('/')[0]}`;
}
