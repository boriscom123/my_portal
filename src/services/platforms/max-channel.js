// Пост в канал MAX.
//
// Задача та же, что у канала Telegram: анонс урока и правка поста, когда
// появятся ссылки. Устройство площадки другое: адрес канала идёт параметром
// адреса, токен — заголовком, а картинка кладётся вложением по ссылке.
//
// Токен здесь свой: бота MAX портал не имеет, автор заводит его отдельно и
// вводит в кабинете.
// Вызывается из src/jobs/publish-max.js.
import { readFile } from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import { maxFetch } from '../../lib/max-fetch.js';

const API = 'https://platform-api2.max.ru';

/** Прячет токен: он уходит и в журнал, и на экран человеку. */
function hideToken(text, token) {
  return token ? String(text).replaceAll(token, '…') : String(text);
}

async function failure(response, token) {
  const text = await response.text().catch(() => '');
  throw new Error(`MAX отказал (${response.status}): ${hideToken(text, token) || 'без объяснения'}`);
}

/**
 * Достаёт номер поста из ответа.
 *
 * Смотрим в нескольких местах намеренно: устройство ответа MAX мы взяли из
 * документации, а не из живого обмена, и ошибиться тут дешевле всего именно так.
 * Не нашли — говорим об этом вслух с куском ответа: молчаливый пустой номер
 * означал бы пост, который есть в канале, но которого портал не знает и не
 * сможет потом поправить.
 */
function readMessageId(body) {
  const found = body?.message?.body?.mid ?? body?.body?.mid ?? body?.mid ?? '';
  if (found) return String(found);
  throw new Error(
    `MAX принял пост, но не сказал его номер — правка подписи потом не сработает. Ответ: ${JSON.stringify(body).slice(0, 200)}`
  );
}

/**
 * Кладёт картинку на площадку и отдаёт её токен.
 *
 * Двумя шагами, а не ссылкой. Ссылку MAX принимает на словах, но на деле
 * отвечает «Failed to upload image»: он её честно скачивает — это видно в
 * журнале сервера, — и всё равно отказывает. Двухшаговый путь описан в их
 * документации и работает.
 *
 * Узел загрузки — чужой (iu.oneme.ru) и с обычным сертификатом, поэтому туда
 * идём простым fetch: особое доверие к корню Минцифры на него не
 * распространяется и не должно.
 */
async function uploadImage({ token, filePath, fetchImpl, uploadFetch }) {
  const asked = await fetchImpl(`${API}/uploads?type=image`, {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: '{}'
  });
  if (!asked.ok) await failure(asked, token);

  const { url } = await asked.json();
  if (!url) throw new Error('MAX не дал адрес для загрузки картинки');

  const form = new FormData();
  form.append('data', new Blob([await readFile(filePath)], { type: 'image/jpeg' }), 'cover.jpg');

  const sent = await uploadFetch(url, { method: 'POST', body: form });
  if (!sent.ok) throw new Error(`MAX не принял картинку (${sent.status})`);

  const body = await sent.json();
  const photo = Object.values(body.photos ?? {})[0];
  if (!photo?.token) {
    throw new Error(`MAX принял картинку, но не дал её токен: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return photo.token;
}

/**
 * Кладёт видео на площадку и отдаёт токен вложения.
 *
 * Загрузка двухшаговая, как у картинки, но узел и ответ другие: видео площадка
 * принимает по адресу с type=video. Файл идёт с диска потоком (openAsBlob), а
 * не читается в память: часть урока весит до 250 МБ, а память на сервере общая.
 * Вызывается из postVideoToMax и postPartsToMax.
 */
export async function uploadVideo({
  token,
  filePath,
  fileName = 'video.mp4',
  fetchImpl = maxFetch,
  uploadFetch = fetch
}) {
  const asked = await fetchImpl(`${API}/uploads?type=video`, {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: '{}'
  });
  if (!asked.ok) await failure(asked, token);

  const { url, token: videoToken } = await asked.json();
  if (!url) throw new Error('MAX не дал адрес для загрузки ролика');

  const form = new FormData();
  form.append('data', await openAsBlob(filePath, { type: 'video/mp4' }), fileName);
  const sent = await uploadFetch(url, { method: 'POST', body: form });
  if (!sent.ok) throw new Error(`MAX не принял ролик (${sent.status})`);

  // Токен вложения площадка выдаёт дважды: в ответе на запрос адреса и в ответе
  // самой загрузки. Берём тот, что есть: документация называет первый, живой
  // обмен показывал и второй.
  const uploaded = await sent.json().catch(() => ({}));
  const attachment = videoToken ?? uploaded.token ?? uploaded.video?.token;
  if (!attachment) {
    throw new Error(`MAX принял ролик, но не дал его токен: ${JSON.stringify(uploaded).slice(0, 200)}`);
  }
  return attachment;
}

/** Сообщение с видео в канал. */
function sendVideoMessage({ token, channel, text, attachments, fetchImpl }) {
  return fetchImpl(`${API}/messages?chat_id=${encodeURIComponent(channel)}`, {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      attachments: attachments.map((attachment) => ({ type: 'video', payload: { token: attachment } }))
    })
  });
}

/**
 * Отправляет урок частями видео.
 *
 * Сперва — всё одним сообщением. Документация MAX не говорит, принимает ли он
 * несколько видео в одном сообщении; отказал (4xx) — части уходят постами
 * подряд: первый с текстом, дальше — название части. Сбой самой площадки (5xx)
 * — это отказ, а не «много видео»: слать подряд в упавший MAX незачем.
 *
 * Ход записывается через onProgress, и повтор после сбоя продолжает с
 * непришедшей части — вместо второго поста с теми же частями. multiVideo —
 * способ, уже известный по прошлым отправкам: false значит сразу подряд.
 * Вызывается из src/jobs/publish-lesson-parts.js через адаптер воркера.
 */
export async function postPartsToMax({
  token,
  channel,
  parts,
  text,
  multiVideo = true,
  progress = { sent: [] },
  onProgress = async () => {},
  fetchImpl = maxFetch,
  uploadFetch = fetch
}) {
  const alreadySent = progress.sent ?? [];

  if (multiVideo && !alreadySent.length) {
    const attachments = [];
    for (const part of parts) {
      attachments.push(await uploadVideo({ token, filePath: part.path, fetchImpl, uploadFetch }));
    }
    const response = await sendVideoMessage({ token, channel, text, attachments, fetchImpl });
    if (response.ok) {
      return { messageId: readMessageId(await response.json()), url: null, multiVideo: true };
    }
    if (parts.length === 1 || response.status >= 500) await failure(response, token);
  }

  // Части загружаются заново: живёт ли токен вложения после отказа в сообщении
  // и можно ли его приложить второй раз, MAX не пишет. Лишняя загрузка дешевле
  // поста с «битым» видео; после первого отказа способ запомнится, и дальше
  // загрузка будет одна.
  const sent = [...alreadySent];
  for (let index = sent.length; index < parts.length; index += 1) {
    const attachment = await uploadVideo({
      token,
      filePath: parts[index].path,
      fetchImpl,
      uploadFetch
    });
    const response = await sendVideoMessage({
      token,
      channel,
      text: index === 0 ? text : parts[index].caption,
      attachments: [attachment],
      fetchImpl
    });
    if (!response.ok) await failure(response, token);
    sent.push(readMessageId(await response.json()));
    await onProgress({ sent });
  }
  return { messageId: sent[0], url: null, multiVideo: false };
}

/**
 * Отправляет вертикальный ролик файлом.
 *
 * Загрузка двухшаговая, как у картинки, но узел и ответ другие: видео площадка
 * принимает по адресу с type=video и отдаёт токен вложения прямо в ответе
 * загрузки, а не списком, как у картинок.
 */
export async function postVideoToMax({
  token,
  channel,
  filePath,
  caption,
  fetchImpl = maxFetch,
  uploadFetch = fetch
}) {
  const attachment = await uploadVideo({
    token,
    filePath,
    fileName: 'short.mp4',
    fetchImpl,
    uploadFetch
  });

  const response = await fetchImpl(`${API}/messages?chat_id=${encodeURIComponent(channel)}`, {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: caption,
      attachments: [{ type: 'video', payload: { token: attachment } }]
    })
  });
  if (!response.ok) await failure(response, token);

  return { messageId: readMessageId(await response.json()), url: null };
}

export async function postToMax({
  token,
  channel,
  filePath,
  caption,
  fetchImpl = maxFetch,
  uploadFetch = fetch
}) {
  const photoToken = filePath
    ? await uploadImage({ token, filePath, fetchImpl, uploadFetch })
    : null;

  const response = await fetchImpl(`${API}/messages?chat_id=${encodeURIComponent(channel)}`, {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: caption,
      ...(photoToken ? { attachments: [{ type: 'image', payload: { token: photoToken } }] } : {})
    })
  });
  if (!response.ok) await failure(response, token);

  return { messageId: readMessageId(await response.json()), url: null };
}

/**
 * Переписывает пост. Картинку кладём заново: без вложения площадка снимет её с
 * поста, а токен прошлой загрузки живёт не вечно. Правки редки — раз на выход
 * ролика, — и лишняя загрузка ста килобайт того стоит.
 * Без файла правится один текст: у поста о новости картинки может и не быть.
 */
export async function editMaxPost({
  token,
  messageId,
  caption,
  filePath,
  fetchImpl = maxFetch,
  uploadFetch = fetch
}) {
  const photoToken = filePath
    ? await uploadImage({ token, filePath, fetchImpl, uploadFetch })
    : null;

  const response = await fetchImpl(`${API}/messages?message_id=${encodeURIComponent(messageId)}`, {
    method: 'PUT',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: caption,
      ...(photoToken ? { attachments: [{ type: 'image', payload: { token: photoToken } }] } : {})
    })
  });
  if (!response.ok) await failure(response, token);
}

/**
 * Ищет номер канала по тому, что вставил человек.
 *
 * MAX адресует канал числом, а под рукой у человека ссылка вида
 * https://max.ru/id…_biz2 — именно её он и вставит. Площадка сама отдаёт эту
 * ссылку в списке чатов бота, так что сопоставить их — наша работа, а не его.
 * null — не нашли; тогда честнее попросить номер, чем гадать.
 * Вызывается из src/routes/integrations.js при сохранении настроек.
 */
export async function findMaxChat({ token, needle, fetchImpl = maxFetch }) {
  const response = await fetchImpl(`${API}/chats`, { headers: { Authorization: token } });
  if (!response.ok) await failure(response, token);

  const wanted = String(needle ?? '')
    .trim()
    .replace(/\/+$/, '')
    .toLowerCase();
  if (!wanted) return null;

  const { chats = [] } = await response.json();
  const found = chats.find(
    (chat) =>
      String(chat.link ?? '')
        .replace(/\/+$/, '')
        .toLowerCase() === wanted ||
      String(chat.title ?? '').trim().toLowerCase() === wanted
  );
  // Возвращаем и ссылку: у поста в MAX публичного адреса нет вовсе — площадка
  // его не выдаёт, — а канал открывается по ссылке, и это единственное, куда
  // честно вести зрителя с карточки урока.
  return found ? { chatId: String(found.chat_id), link: String(found.link ?? '') } : null;
}
