// Пост в канал Telegram.
//
// Задача — положить в канал анонс урока и потом поправить его, когда ролик
// выйдет на площадках. Почему анонс, а не сама запись: бот отдаёт файл до 50 МБ,
// а урок весит сотни. Обложка уходит ссылкой — площадка забирает её сама, и
// мегабайты через нас не гоняются.
//
// Бот здесь тот же, что у входа и уведомлений: человек, вошедший его виджетом,
// уже разрешил ему писать, а второй бот в хозяйстве — это второй токен и второй
// повод забыть про его продление.
// Вызывается из src/jobs/publish-telegram.js.
import { readFile } from 'node:fs/promises';

const API = 'https://api.telegram.org/bot';

/** Отказ площадки её же словами: они точнее нашего пересказа. */
async function failure(response) {
  const body = await response.json().catch(() => ({}));
  throw new Error(`Telegram отказал (${response.status}): ${body.description ?? 'без объяснения'}`);
}

/** Адрес поста для карточки урока. Считается только у канала с именем. */
function postUrl(channel, messageId) {
  const name = String(channel).replace(/^@/, '');
  // У канала по номеру (-100…) публичной ссылки нет — и выдумывать её нельзя.
  return /^-?\d+$/.test(name) ? null : `https://t.me/${name}/${messageId}`;
}

/**
 * Проверяет, что этим токеном можно писать в этот канал.
 *
 * Спрашивается у самой площадки и до сохранения. Без проверки ошибка в токене
 * лежит незамеченной до первой отправки — а она бывает через дни: заказчик
 * вставил в поле Telegram токен от MAX, портал молча его принял, и «Not Found»
 * всплыло только на публикации новости.
 *
 * Два вопроса, а не один: getMe отвечает за токен, getChat — за канал и за то,
 * что бота туда добавили. Разные причины — разные слова человеку, иначе он
 * будет перевставлять верный токен, когда дело в правах бота.
 * Вызывается из src/routes/integrations.js при сохранении настроек канала.
 */
export async function checkTelegramChannel({ token, channel, fetchImpl = fetch }) {
  const me = await fetchImpl(`${API}${token}/getMe`);
  if (!me.ok) {
    throw new Error(
      'Telegram не знает такого бота: токен неверный или отозван. ' +
        'Возьмите его у @BotFather — он выглядит как 123456789:AA…'
    );
  }
  const bot = (await me.json()).result ?? {};

  const chat = await fetchImpl(`${API}${token}/getChat?chat_id=${encodeURIComponent(channel)}`);
  if (!chat.ok) {
    const body = await chat.json().catch(() => ({}));
    throw new Error(
      `Бот @${bot.username ?? '?'} не видит канал ${channel}: ${body.description ?? 'канал не найден'}. ` +
        'Добавьте бота в канал администратором с правом писать и менять сообщения.'
    );
  }
  return { username: bot.username ?? '' };
}

/**
 * Отправляет пост.
 * Без картинки — обычным сообщением: новость бывает и без неё, а sendPhoto без
 * фотографии площадка не принимает.
 */
export async function postToTelegram({ token, channel, photoUrl, caption, fetchImpl = fetch }) {
  const [method, payload] = photoUrl
    ? ['sendPhoto', { chat_id: channel, photo: photoUrl, caption }]
    : ['sendMessage', { chat_id: channel, text: caption }];

  const response = await fetchImpl(`${API}${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) await failure(response);

  const body = await response.json();
  const messageId = String(body.result?.message_id ?? '');
  return { messageId, url: postUrl(channel, messageId) };
}

/**
 * Отправляет вертикальный ролик файлом.
 *
 * Файлом, а не ссылкой: подписчик должен смотреть его в ленте канала, а не
 * уходить на сайт. Предел бота — 50 МБ, и он проверяется до отправки: ответ
 * площадки на превышение приходит после того, как файл уже уехал по сети.
 *
 * supports_streaming — не украшение: без него Telegram отдаёт ролик как файл,
 * который сначала надо скачать целиком, и лента канала перестаёт работать.
 */
export async function postVideoToTelegram({
  token,
  channel,
  filePath,
  caption,
  fetchImpl = fetch
}) {
  const form = new FormData();
  form.append('chat_id', channel);
  form.append('caption', caption);
  form.append('supports_streaming', 'true');
  form.append('video', new Blob([await readFile(filePath)], { type: 'video/mp4' }), 'short.mp4');

  const response = await fetchImpl(`${API}${token}/sendVideo`, { method: 'POST', body: form });
  if (!response.ok) await failure(response);

  const body = await response.json();
  const messageId = String(body.result?.message_id ?? '');
  return { messageId, url: postUrl(channel, messageId) };
}

/**
 * Переписывает текст у уже отправленного поста.
 * Правка, а не второй пост: подписчики не должны получать второе уведомление об
 * одном и том же уроке только потому, что у нас появилась ещё одна ссылка.
 *
 * Метод зависит от того, с картинкой пост или без: у поста с картинкой
 * правится подпись, у поста без неё — сам текст. Перепутать нельзя, площадка
 * отвечает отказом. Саму картинку правка не трогает: заменить её в готовом
 * посте площадка не даёт.
 */
export async function editTelegramPost({
  token,
  channel,
  messageId,
  photoUrl,
  caption,
  fetchImpl = fetch
}) {
  const [method, payload] = photoUrl
    ? ['editMessageCaption', { chat_id: channel, message_id: Number(messageId), caption }]
    : ['editMessageText', { chat_id: channel, message_id: Number(messageId), text: caption }];

  const response = await fetchImpl(`${API}${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) await failure(response);
}
