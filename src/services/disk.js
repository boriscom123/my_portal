// Доступ к Яндекс Диску заказчика.
//
// Задача — показать список видео и отдать прямую ссылку на скачивание. Зачем
// по токену, а не по публичной ссылке: публичная ссылка сделала бы невышедший
// урок доступным всякому, кто её увидит. Токен этого не требует, а заодно
// позволяет выбирать файл списком, а не копировать адреса.
// Вызывается из src/routes/integrations.js и src/jobs/fetch-source.js.
import { encryptSecret, decryptSecret } from '../lib/secrets.js';

const API = 'https://cloud-api.yandex.net/v1/disk';

// Расширения, по которым узнаём видео, когда Диск не проставил media_type.
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v'];

/** Видео ли это. Диск не всегда проставляет тип — тогда судим по расширению. */
export function isVideo(item) {
  if (item.media_type === 'video') return true;
  const name = String(item.name ?? '').toLowerCase();
  return VIDEO_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/**
 * Общий разбор отказа.
 * Токен в сообщение не попадает намеренно: оно уходит и в журнал, и на экран
 * человеку, а туда чужому секрету дороги нет.
 */
async function failure(response, what) {
  const body = await response.text().catch(() => '');
  throw new Error(`${what}: ${response.status} ${body.slice(0, 200)}`);
}

function headers(token) {
  return { Authorization: `OAuth ${token}` };
}

/** Список видео в папке Диска, свежие сверху. */
export async function listDiskFiles(token, diskPath, fetchImpl = fetch) {
  const url = `${API}/resources?path=${encodeURIComponent(diskPath)}&limit=200&sort=-modified`;
  const response = await fetchImpl(url, { headers: headers(token) });
  if (!response.ok) await failure(response, 'Диск не отдал список файлов');

  const body = await response.json();
  return (body._embedded?.items ?? [])
    .filter((item) => item.type === 'file' && isVideo(item))
    .map((item) => ({
      name: item.name,
      path: item.path,
      bytes: Number(item.size ?? 0),
      modified: item.modified ?? null
    }));
}

/** Прямая ссылка на скачивание. Живёт недолго — берём её перед самой закачкой. */
export async function diskDownloadUrl(token, diskPath, fetchImpl = fetch) {
  const url = `${API}/resources/download?path=${encodeURIComponent(diskPath)}`;
  const response = await fetchImpl(url, { headers: headers(token) });
  if (!response.ok) await failure(response, 'Диск не отдал ссылку на скачивание');
  const body = await response.json();
  if (!body.href) throw new Error('Диск не вернул прямой ссылки');
  return body.href;
}

/** Сохраняет токен подключения зашифрованным. Повтор заменяет прежний. */
export async function saveIntegration(pool, config, { name, token, refreshToken, expiresAt }) {
  await pool.query(
    `INSERT INTO integrations (name, token, refresh_token, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (name) DO UPDATE SET token = EXCLUDED.token,
                                      refresh_token = EXCLUDED.refresh_token,
                                      expires_at = EXCLUDED.expires_at,
                                      updated_at = now()`,
    [
      name,
      encryptSecret(token, config.tokenEncryptionKey),
      refreshToken ? encryptSecret(refreshToken, config.tokenEncryptionKey) : null,
      expiresAt ?? null
    ]
  );
}

/** Достаёт токен подключения. null, если сервис не подключён. */
export async function loadIntegration(pool, config, name) {
  const { rows } = await pool.query(
    'SELECT token, refresh_token, expires_at FROM integrations WHERE name = $1',
    [name]
  );
  if (!rows.length) return null;
  return {
    token: decryptSecret(rows[0].token, config.tokenEncryptionKey),
    refreshToken: rows[0].refresh_token
      ? decryptSecret(rows[0].refresh_token, config.tokenEncryptionKey)
      : null,
    expiresAt: rows[0].expires_at
  };
}
