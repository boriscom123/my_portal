// Запросы к YouTube Data API.
//
// Задача — залить ролик, субтитры и обложку и уметь спросить, публичен ли
// ролик. Зачем возобновляемая загрузка: файл урока — сотни мегабайт, обычная
// загрузка одним куском теряет всё при обрыве связи, а тело в памяти убило бы
// воркер с его потолком в 1.4 ГБ. Поэтому сессия и поток с диска.
// Вызывается из src/jobs/publish-youtube.js и src/routes/admin.js.
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';

const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';
const CAPTIONS_URL = 'https://www.googleapis.com/upload/youtube/v3/captions';
const THUMBNAIL_URL = 'https://www.googleapis.com/upload/youtube/v3/thumbnails/set';
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';

/**
 * Переводит отказ площадки человеку.
 * Исчерпанная норма — не поломка, и говорить о ней надо так, чтобы автор не
 * искал ошибку у себя.
 */
export function describeYoutubeFailure(status, body) {
  const reason = body?.error?.errors?.[0]?.reason ?? '';
  if (reason === 'quotaExceeded' || reason === 'uploadLimitExceeded') {
    return 'Суточная норма загрузок YouTube исчерпана. Это не поломка — попробуйте завтра.';
  }
  if (reason === 'forbidden' || status === 401) {
    return 'YouTube не принял доступ: подключите канал заново на странице загрузки.';
  }
  const message = body?.error?.message ?? '';
  return `YouTube отказал (${status})${message ? `: ${message}` : ''}`;
}

async function failure(response) {
  const body = await response.json().catch(() => ({}));
  throw new Error(describeYoutubeFailure(response.status, body));
}

/** Открывает возобновляемую сессию и возвращает её адрес. */
export async function startUploadSession({ token, body, fileBytes, fetchImpl = fetch }) {
  const response = await fetchImpl(`${UPLOAD_URL}?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Upload-Content-Type': 'video/*',
      'X-Upload-Content-Length': String(fileBytes)
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) await failure(response);

  const sessionUrl = response.headers.get('location');
  if (!sessionUrl) throw new Error('YouTube не дал адрес сессии загрузки');
  return sessionUrl;
}

/**
 * Шлёт файл в открытую сессию потоком.
 * duplex: 'half' обязателен — без него Node отказывается отправлять поток телом
 * запроса, и ошибка выглядит как «body is not supported».
 */
export async function uploadVideoFile({ sessionUrl, filePath, fileBytes, fetchImpl = fetch }) {
  const response = await fetchImpl(sessionUrl, {
    method: 'PUT',
    headers: { 'Content-Length': String(fileBytes), 'Content-Type': 'video/*' },
    body: createReadStream(filePath),
    duplex: 'half'
  });
  if (!response.ok) await failure(response);

  const body = await response.json();
  return { videoId: body.id };
}

/** Кладёт субтитры отдельным треком: зритель их выключает, площадка переводит. */
export async function insertCaptions({ token, videoId, filePath, fetchImpl = fetch }) {
  const metadata = {
    snippet: { videoId, language: 'ru', name: 'Русские субтитры', isDraft: false }
  };
  const form = new FormData();
  form.append('snippet', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  // Субтитры — десятки килобайт: читать их целиком памяти не стоит.
  form.append('file', new Blob([await readFile(filePath)], { type: 'application/octet-stream' }));

  const response = await fetchImpl(`${CAPTIONS_URL}?part=snippet&uploadType=multipart`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  if (!response.ok) await failure(response);
}

/** Ставит обложку. Файл обязан быть не тяжелее двух мегабайт. */
export async function setThumbnail({ token, videoId, filePath, fetchImpl = fetch }) {
  const response = await fetchImpl(`${THUMBNAIL_URL}?videoId=${encodeURIComponent(videoId)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' },
    body: await readFile(filePath)
  });
  if (!response.ok) await failure(response);
}

/** Приватность ролика. null — ролика больше нет. */
export async function readVideoPrivacy({ token, videoId, fetchImpl = fetch }) {
  const response = await fetchImpl(`${VIDEOS_URL}?part=status&id=${encodeURIComponent(videoId)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) await failure(response);

  const body = await response.json();
  return body.items?.[0]?.status?.privacyStatus ?? null;
}
