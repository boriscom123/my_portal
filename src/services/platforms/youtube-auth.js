// Подключение канала YouTube.
//
// Задача — увести автора на экран согласия Google, принять возврат и держать
// живой access-токен. Зачем отдельным файлом от запросов к API: обмен токенами
// проверяется тестами без сети и без файлов, а загрузка ролика — нет.
//
// Область доступа одна: youtube.force-ssl покрывает и загрузку ролика, и
// субтитры, и обложку. Просить сверх неё вредно — заявку на аудит Google
// рассматривает человек, и лишние права в ней объясняются отдельно.
// Вызывается из src/routes/integrations.js и src/jobs/publish-youtube.js.
import { saveIntegration, loadIntegration } from '../disk.js';

const CONSENT_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

// За минуту до конца токен считаем протухшим: загрузка длинная, и обновить
// заранее дешевле, чем ловить отказ в середине файла.
const EXPIRY_MARGIN_MS = 60_000;

/** Адрес экрана согласия. */
export function youtubeConsentUrl(config) {
  const url = new URL(CONSENT_URL);
  url.searchParams.set('client_id', config.youtube.clientId);
  url.searchParams.set('redirect_uri', config.youtube.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPE);
  // Без offline и consent Google не выдаёт refresh-токен: подключение выглядит
  // удачным и перестаёт работать через час, когда истечёт первый access-токен.
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

/** Прячет секрет в тексте ответа: он уходит и в журнал, и на экран человеку. */
function hideSecret(text, secret) {
  return secret ? String(text).replaceAll(secret, '…') : String(text);
}

async function askForTokens(config, params, fetchImpl) {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Google отказал (${response.status}): ${hideSecret(text, config.youtube.clientSecret)}`
    );
  }
  return response.json();
}

/** Меняет код с экрана согласия на пару токенов. */
export async function exchangeYoutubeCode(config, code, fetchImpl = fetch) {
  const body = await askForTokens(
    config,
    {
      code,
      client_id: config.youtube.clientId,
      client_secret: config.youtube.clientSecret,
      redirect_uri: config.youtube.redirectUri,
      grant_type: 'authorization_code'
    },
    fetchImpl
  );
  return {
    token: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: new Date(Date.now() + Number(body.expires_in ?? 0) * 1000)
  };
}

/**
 * Живой access-токен. null — канал не подключён.
 * Протухший обновляет сам и сохраняет обновлённый: иначе каждая выкладка
 * начиналась бы с лишнего запроса к Google.
 */
export async function youtubeAccessToken(pool, config, fetchImpl = fetch) {
  const stored = await loadIntegration(pool, config, 'youtube');
  if (!stored) return null;

  const alive = stored.expiresAt && stored.expiresAt.getTime() - EXPIRY_MARGIN_MS > Date.now();
  if (alive) return stored.token;
  if (!stored.refreshToken) return null;

  const body = await askForTokens(
    config,
    {
      refresh_token: stored.refreshToken,
      client_id: config.youtube.clientId,
      client_secret: config.youtube.clientSecret,
      grant_type: 'refresh_token'
    },
    fetchImpl
  );

  await saveIntegration(pool, config, {
    name: 'youtube',
    token: body.access_token,
    // Google при обновлении refresh-токен не присылает: сохраняем прежний,
    // иначе следующее обновление станет невозможным.
    refreshToken: stored.refreshToken,
    expiresAt: new Date(Date.now() + Number(body.expires_in ?? 0) * 1000)
  });
  return body.access_token;
}
