// Подпись к посту в канале.
//
// Задача — собрать текст, который уходит в Telegram и MAX, и собрать его
// одинаково дважды: при отправке и потом, когда в пост добавляются ссылки на
// вышедшие ролики. Разойдись эти два места — и правка поста меняла бы не
// только ссылки, но и текст, который люди уже прочитали.
// Вызывается из шагов выкладки в каналы.
import { latestPerPlatform } from '../../lib/latest-publications.js';

// Предел подписи к картинке в Telegram. У MAX он больше, но пост один и тот
// же: две разные подписи к одному уроку — это две разные правды.
export const TELEGRAM_CAPTION_LIMIT = 1024;

/** Как называется площадка в подписи. Слаг человеку не годится. */
const PLATFORM_NAMES = {
  youtube: 'YouTube',
  vk: 'VK Video',
  rutube: 'RuTube',
  dzen: 'Дзен',
  // Каналы называются каналами: в подписи они стоят рядом с сайтом, и «Telegram»
  // без слова «канал» читается как площадка с записью.
  telegram: 'Канал Telegram',
  max: 'Канал Max'
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
  const blocks = linkBlocks({ lesson, publicBaseUrl, publications, skipPlatform });
  const tail = blocks.join('\n\n');
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
export function buildNewsAnnouncement({
  item,
  publicBaseUrl,
  // Хвост поста: по умолчанию одна ссылка на саму новость. У вертикального
  // ролика их две — на него и на урок целиком, — и собирает их вызывающий:
  // здесь мы не знаем, из чего ролик вырезан.
  tail = null,
  limit = TELEGRAM_CAPTION_LIMIT
}) {
  const end = tail ?? `${publicBaseUrl}/news/${item.slug}`;
  const head = `${item.title}\n\n`;
  const room = limit - head.length - end.length - 2;
  const body = room > 40 ? trimToSentence(item.body ?? '', room) : '';

  return `${head}${body ? `${body}\n\n` : ''}${end}`;
}

// Где лежит запись целиком: туда ведёт «Полное видео». Канал — не площадка с
// записью: в нём начало урока и разговор о нём, поэтому он идёт в «подробности».
const FULL_VIDEO_PLATFORMS = ['youtube', 'rutube', 'vk', 'dzen'];

/**
 * Ссылки поста двумя группами: где смотреть запись целиком и где подробности.
 *
 * Один сборщик на анонс и на пост с началом урока: подпись у них общая, а
 * разойдись эти два места — и правка поста меняла бы не только ссылки, но и
 * слова, которые люди уже прочитали. lead — первая строка группы про видео
 * (у поста с началом там сказано, сколько минут уехало); пусто — группа
 * начинается с «Полное видео».
 * Только вышедшее: приватный ролик подписчику не открывается, и звать его туда
 * нечестно. Посты с частями видео — не площадка, где вышел урок: это тот же
 * канал. Урок выложен дважды — ссылка одна, на последний вышедший ролик.
 */
function linkBlocks({ lesson, publicBaseUrl, publications, skipPlatform, lead = '', noVideo = false }) {
  const lessonLink = `${publicBaseUrl}/lesson/${lesson.slug}`;
  const out = latestPerPlatform(
    publications.filter(
      (item) =>
        item.state === 'published' &&
        item.url &&
        item.platform !== skipPlatform &&
        !item.platform.endsWith('_parts')
    )
  );
  const videos = out.filter((item) => FULL_VIDEO_PLATFORMS.includes(item.platform));
  const channels = out.filter((item) => !FULL_VIDEO_PLATFORMS.includes(item.platform));

  // Каждая ссылка подписана, чем она является: голый адрес в ленте канала
  // ничего не говорит, а «Сайт» и «Канал Max» читаются с одного взгляда.
  const named = (item) => `${PLATFORM_NAMES[item.platform] ?? item.platform}: ${item.url}`;

  const blocks = [];
  if (lead) blocks.push(lead);
  // Полной записи нигде нет — обещать её нечем; она целиком в посте — звать
  // некуда. Метка без ссылки выглядит поломкой, поэтому строки просто нет.
  if (videos.length && !noVideo) {
    blocks.push(['Полное видео:', ...videos.map(named)].join('\n'));
  }
  blocks.push(['Подробности:', `Сайт: ${lessonLink}`, ...channels.map(named)].join('\n'));
  return blocks;
}

/**
 * Подпись к посту с началом урока.
 *
 * В канал уходит обложка и первый кусок видео: целиком запись туда не влезает,
 * а смотреть её зритель идёт на площадки — подпись обязана это сказать, иначе
 * обрыв выглядит поломкой. Куска хватило на всю запись — про «первые минуты»
 * молчим: обещать продолжение, которого нет, нечестно.
 * Вызывается из src/jobs/publish-lesson-parts.js.
 */
export function buildFirstPartCaption({
  lesson,
  part,
  durationMs = 0,
  publicBaseUrl,
  publications = [],
  skipPlatform = null,
  limit = TELEGRAM_CAPTION_LIMIT
}) {
  const partMs = Math.max(0, (part?.endMs ?? 0) - (part?.startMs ?? 0));
  // Секунда допуска: резка встаёт на опорный кадр и до конца добирает не ровно.
  const whole = !durationMs || partMs >= durationMs - 1000;
  const minutes = Math.max(1, Math.round(partMs / 60_000));

  const body = linkBlocks({
    lesson,
    publicBaseUrl,
    publications,
    skipPlatform,
    lead: whole ? '' : `Первые ${minutes} минут урока.`,
    // Запись влезла в пост целиком — звать за полной записью некуда.
    noVideo: whole
  }).join('\n\n');
  const caption = `${lesson.title}\n\n${body}`;
  if (caption.length <= limit) return caption;
  // Не влезло — заголовок укорачивается: ссылки важнее, ради них пост и читают.
  return `${trimToSentence(lesson.title, Math.max(10, limit - body.length - 2))}\n\n${body}`;
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

// Предел текста сообщения у MAX. У Telegram свой — TELEGRAM_CAPTION_LIMIT.
export const MAX_TEXT_LIMIT = 4000;

