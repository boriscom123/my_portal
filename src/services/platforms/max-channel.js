// Пост в канал MAX.
//
// Задача та же, что у канала Telegram: анонс урока и правка поста, когда
// появятся ссылки. Устройство площадки другое: адрес канала идёт параметром
// адреса, токен — заголовком, а картинка кладётся вложением по ссылке.
//
// Токен здесь свой: бота MAX портал не имеет, автор заводит его отдельно и
// вводит в кабинете.
// Вызывается из src/jobs/publish-max.js.
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

export async function postToMax({ token, channel, photoUrl, caption, fetchImpl = fetch }) {
  const response = await fetchImpl(`${API}/messages?chat_id=${encodeURIComponent(channel)}`, {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: caption,
      // Картинка ссылкой: выгружать файл ради обложки незачем, площадка
      // забирает её сама.
      attachments: [{ type: 'image', payload: { url: photoUrl } }]
    })
  });
  if (!response.ok) await failure(response, token);

  return { messageId: readMessageId(await response.json()), url: null };
}

/** Переписывает пост. Вложение шлём заново: без него площадка снимет картинку. */
export async function editMaxPost({ token, messageId, caption, photoUrl, fetchImpl = fetch }) {
  const response = await fetchImpl(
    `${API}/messages?message_id=${encodeURIComponent(messageId)}`,
    {
      method: 'PUT',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: caption,
        attachments: [{ type: 'image', payload: { url: photoUrl } }]
      })
    }
  );
  if (!response.ok) await failure(response, token);
}
