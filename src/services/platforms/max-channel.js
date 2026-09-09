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

export async function postToMax({
  token,
  channel,
  filePath,
  caption,
  fetchImpl = maxFetch,
  uploadFetch = fetch
}) {
  const photoToken = await uploadImage({ token, filePath, fetchImpl, uploadFetch });

  const response = await fetchImpl(`${API}/messages?chat_id=${encodeURIComponent(channel)}`, {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: caption,
      attachments: [{ type: 'image', payload: { token: photoToken } }]
    })
  });
  if (!response.ok) await failure(response, token);

  return { messageId: readMessageId(await response.json()), url: null };
}

/**
 * Переписывает пост. Картинку кладём заново: без вложения площадка снимет её с
 * поста, а токен прошлой загрузки живёт не вечно. Правки редки — раз на выход
 * ролика, — и лишняя загрузка ста килобайт того стоит.
 */
export async function editMaxPost({
  token,
  messageId,
  caption,
  filePath,
  fetchImpl = maxFetch,
  uploadFetch = fetch
}) {
  const photoToken = await uploadImage({ token, filePath, fetchImpl, uploadFetch });

  const response = await fetchImpl(`${API}/messages?message_id=${encodeURIComponent(messageId)}`, {
    method: 'PUT',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: caption,
      attachments: [{ type: 'image', payload: { token: photoToken } }]
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
