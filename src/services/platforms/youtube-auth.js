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
import { youtubeApp } from '../platform-apps.js';

const CONSENT_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

// За минуту до конца токен считаем протухшим: загрузка длинная, и обновить
// заранее дешевле, чем ловить отказ в середине файла.
const EXPIRY_MARGIN_MS = 60_000;

/**
 * Адрес экрана согласия.
 * Приложение приходит доводом, а не берётся из настроек сервера: ключи автор
 * вводит в кабинете, и читать их надо в момент работы, а не при старте.
 */
export function youtubeConsentUrl(app) {
  const url = new URL(CONSENT_URL);
  url.searchParams.set('client_id', app.clientId);
  url.searchParams.set('redirect_uri', app.redirectUri);
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

async function askForTokens(app, params, fetchImpl) {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    // invalid_grant — самый частый отказ и самый непонятный на вид. Он означает
    // ровно одно: доступ больше не действует. Пока приложение в Google числится
    // тестовым, это случается каждые семь дней само собой, и человек у экрана
    // должен прочитать, что делать, а не гадать над английским словом.
    if (text.includes('invalid_grant')) {
      throw new Error(
        'Подключение к YouTube истекло или отозвано — подключите канал заново в настройках'
      );
    }
    throw new Error(`Google отказал (${response.status}): ${hideSecret(text, app.clientSecret)}`);
  }
  return response.json();
}

/** Меняет код с экрана согласия на пару токенов. */
export async function exchangeYoutubeCode(app, code, fetchImpl = fetch) {
  const body = await askForTokens(
    app,
    {
      code,
      client_id: app.clientId,
      client_secret: app.clientSecret,
      redirect_uri: app.redirectUri,
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

  // Ключи приложения читаются здесь, а не приходят доводом: обновление токена
  // случается посреди выкладки, и тащить их через три слоя было бы нечестно —
  // забыть передать проще, чем заметить.
  const app = await youtubeApp(pool, config);
  if (!app.configured) return null;

  const alive = stored.expiresAt && stored.expiresAt.getTime() - EXPIRY_MARGIN_MS > Date.now();
  if (alive) return stored.token;
  if (!stored.refreshToken) return null;

  const body = await askForTokens(
    app,
    {
      refresh_token: stored.refreshToken,
      client_id: app.clientId,
      client_secret: app.clientSecret,
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
