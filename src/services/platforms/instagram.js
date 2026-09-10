// Выкладка ролика в Instagram Reels.
//
// Задача — три запроса площадке: сложить контейнер, дождаться, пока она сама
// заберёт и обработает файл, и опубликовать. Двухшаговость здесь не наша
// причуда: площадка не принимает файл в запросе вовсе, она приходит за ним по
// ссылке — и ссылка эта у портала подписанная и временная.
// Вызывается из src/jobs/publish-instagram.js.
const GRAPH_URL = 'https://graph.instagram.com';
const VERSION = 'v23.0';

/** Отказ площадки её же словами: они точнее нашего пересказа. */
async function answer(response, what) {
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    let message = text;
    try {
      message = JSON.parse(text).error?.message ?? text;
    } catch {
      // Не разобралось — покажем как есть, это всё равно ответ площадки.
    }
    throw new Error(`Instagram отказал (${response.status}) на ${what}: ${message.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

/**
 * Складывает контейнер с роликом.
 * share_to_feed — чтобы ролик попал и в ленту профиля, а не только в раздел
 * Reels: иначе подписчик, зашедший на профиль, его не увидит.
 */
export async function createReelContainer({
  token,
  userId,
  videoUrl,
  caption,
  fetchImpl = fetch
}) {
  const response = await fetchImpl(`${GRAPH_URL}/${VERSION}/${userId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      media_type: 'REELS',
      video_url: videoUrl,
      caption,
      share_to_feed: 'true',
      access_token: token
    }).toString()
  });
  const body = await answer(response, 'создание контейнера');
  if (!body.id) throw new Error('Instagram принял ролик, но не дал номер контейнера');
  return String(body.id);
}

/** Состояние контейнера: IN_PROGRESS, FINISHED, ERROR, EXPIRED, PUBLISHED. */
export async function containerStatus({ token, containerId, fetchImpl = fetch }) {
  const url = new URL(`${GRAPH_URL}/${VERSION}/${containerId}`);
  url.searchParams.set('fields', 'status_code,status');
  url.searchParams.set('access_token', token);
  const body = await answer(await fetchImpl(url), 'проверку контейнера');
  return { code: body.status_code ?? '', detail: body.status ?? '' };
}

/** Публикует готовый контейнер. Возвращает номер записи. */
export async function publishContainer({ token, userId, containerId, fetchImpl = fetch }) {
  const response = await fetchImpl(`${GRAPH_URL}/${VERSION}/${userId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ creation_id: containerId, access_token: token }).toString()
  });
  const body = await answer(response, 'публикацию');
  if (!body.id) throw new Error('Instagram опубликовал ролик, но не дал его номер');
  return String(body.id);
}

/**
 * Постоянный адрес записи. null, если площадка его не отдала.
 * Нужен карточке: вести человека на профиль вместо самой записи — значит
 * заставить его искать её среди прочих.
 */
export async function mediaPermalink({ token, mediaId, fetchImpl = fetch }) {
  const url = new URL(`${GRAPH_URL}/${VERSION}/${mediaId}`);
  url.searchParams.set('fields', 'permalink');
  url.searchParams.set('access_token', token);
  try {
    const body = await answer(await fetchImpl(url), 'адрес записи');
    return body.permalink ?? null;
  } catch {
    // Ролик уже опубликован: остаться без ссылки досадно, но ронять из-за неё
    // удачную выкладку нельзя.
    return null;
  }
}
