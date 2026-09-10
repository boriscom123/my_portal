// Подключение аккаунта Instagram.
//
// Задача — увести автора на экран согласия, принять возврат и держать живой
// токен. Устройство отличается от Google в одном, но существенно: обновляемого
// refresh-токена здесь нет вовсе. Есть долгий токен на 60 дней, который
// продлевается сам собой — тем же токеном, — и если портал не выкладывает
// ничего два месяца подряд, доступ придётся выдать заново руками.
//
// Путь выбран «вход через Instagram», а не «вход через Facebook»: второй требует
// страницы в Facebook, которой у автора нет и заводить которую ради выкладки
// незачем.
// Вызывается из src/routes/integrations.js и src/jobs/publish-instagram.js.
import { saveIntegration, loadIntegration } from '../disk.js';
import { loadPlatformApp } from '../platform-apps.js';

const CONSENT_URL = 'https://www.instagram.com/oauth/authorize';
const TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const GRAPH_URL = 'https://graph.instagram.com';

// Права запрашиваются ровно два: узнать, чей это аккаунт, и выложить ролик.
// Лишние в этом списке не безобидны — их видит человек на экране согласия.
const SCOPE = 'instagram_business_basic,instagram_business_content_publish';

// За сутки до конца токен считаем протухшим. Не за минуту, как у Google: здесь
// продление — это выдача нового токена на 60 дней, и делать его на самом краю
// значит однажды не успеть из-за суточного простоя портала.
const EXPIRY_MARGIN_MS = 24 * 60 * 60 * 1000;

/** Адрес возврата. Он же вписывается в панель площадки — до последнего знака. */
export function instagramRedirectUri(config) {
  return `${config.publicBaseUrl}/api/integrations/instagram/callback`;
}

/** Ключи приложения из кабинета. configured — можно ли вообще начинать. */
export async function instagramApp(pool, config) {
  const stored = await loadPlatformApp(pool, config, 'instagram');
  return {
    clientId: stored?.clientId ?? '',
    clientSecret: stored?.clientSecret ?? '',
    redirectUri: instagramRedirectUri(config),
    configured: Boolean(stored?.clientId && stored?.clientSecret)
  };
}

/** Адрес экрана согласия. */
export function instagramConsentUrl(app, state = '') {
  const url = new URL(CONSENT_URL);
  url.searchParams.set('client_id', app.clientId);
  url.searchParams.set('redirect_uri', app.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPE);
  if (state) url.searchParams.set('state', state);
  return url.toString();
}

/** Прячет секрет в тексте ответа: он уходит и в журнал, и на экран человеку. */
function hideSecret(text, secret) {
  return secret ? String(text).replaceAll(secret, '…') : String(text);
}

async function readAnswer(response, secret, what) {
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(`Instagram отказал (${response.status}) на ${what}: ${hideSecret(text, secret)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Instagram ответил на ${what} не разбираемым текстом: ${text.slice(0, 200)}`);
  }
}

/**
 * Меняет код с экрана согласия на долгий токен.
 *
 * Двумя запросами, и оба обязательны: первый выдаёт токен на час, второй меняет
 * его на шестидесятидневный. Остановись мы на первом — подключение выглядело бы
 * удачным и переставало работать через час.
 */
export async function exchangeInstagramCode(app, code, fetchImpl = fetch) {
  const short = await readAnswer(
    await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: app.clientId,
        client_secret: app.clientSecret,
        grant_type: 'authorization_code',
        redirect_uri: app.redirectUri,
        code
      }).toString()
    }),
    app.clientSecret,
    'обмен кода'
  );

  const url = new URL(`${GRAPH_URL}/access_token`);
  url.searchParams.set('grant_type', 'ig_exchange_token');
  url.searchParams.set('client_secret', app.clientSecret);
  url.searchParams.set('access_token', short.access_token);
  const long = await readAnswer(await fetchImpl(url), app.clientSecret, 'продление токена');

  return {
    token: long.access_token,
    // Номер аккаунта нужен каждому запросу выкладки, а отдаётся он только здесь.
    // Хранится вместо refresh-токена: у Instagram его нет.
    userId: String(short.user_id ?? ''),
    expiresAt: new Date(Date.now() + Number(long.expires_in ?? 0) * 1000)
  };
}

/**
 * Живой токен и номер аккаунта. null — аккаунт не подключён.
 * Токен на исходе продлевается сам: он продлевается собой же, без участия
 * человека, пока не протух окончательно.
 */
export async function instagramAccess(pool, config, fetchImpl = fetch) {
  const stored = await loadIntegration(pool, config, 'instagram');
  if (!stored?.token) return null;

  const userId = stored.refreshToken;
  const alive = stored.expiresAt && stored.expiresAt.getTime() - EXPIRY_MARGIN_MS > Date.now();
  if (alive) return { token: stored.token, userId };

  const url = new URL(`${GRAPH_URL}/refresh_access_token`);
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', stored.token);

  let refreshed;
  try {
    refreshed = await readAnswer(await fetchImpl(url), '', 'продление доступа');
  } catch (error) {
    throw new Error(
      `${error.message}. Если доступ истёк совсем — подключите аккаунт заново в настройках`
    );
  }

  await saveIntegration(pool, config, {
    name: 'instagram',
    token: refreshed.access_token,
    // В поле refresh-токена лежит номер аккаунта: своего refresh-токена у
    // площадки нет, а номер нужен каждому запросу выкладки.
    refreshToken: userId,
    expiresAt: new Date(Date.now() + Number(refreshed.expires_in ?? 0) * 1000)
  });
  return { token: refreshed.access_token, userId };
}
