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

  const body = await response.json();
  return { messageId: String(body.message?.body?.mid ?? ''), url: null };
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
