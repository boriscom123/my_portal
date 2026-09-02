// Вход через Google. Задача — две операции протокола: собрать ссылку на
// страницу согласия и обменять вернувшийся код на профиль. Зачем без passport:
// протокол здесь укладывается в два запроса, а библиотека тянет за собой
// стратегии, сессии и своё представление о пользователе, которое у нас другое
// (у нас человек и его привязки — разные таблицы).
// Вызывается из src/routes/auth.js.
import { PublicError } from '../middleware/errors.js';

const CONSENT_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PROFILE_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

/**
 * Адрес возврата. Он же прописывается в кабинете Google — при смене адреса
 * портала правится в двух местах: в .env и там. Другого источника адреса нет.
 */
export function googleRedirectUri(publicBaseUrl) {
  return `${publicBaseUrl}/api/auth/google/callback`;
}

/** Ссылка на страницу согласия Google. */
export function buildConsentUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    // Нужны только имя, аватар и идентификатор. Больше не просим: лишние
    // разрешения отпугивают человека на экране согласия.
    scope: 'openid profile email',
    state
  });
  return `${CONSENT_URL}?${params}`;
}

/**
 * Меняет код на профиль. fetchImpl вынесен аргументом, чтобы тест не ходил
 * в сеть; в бою подставляется штатный fetch.
 */
export async function fetchGoogleProfile(
  { code, clientId, clientSecret, redirectUri },
  fetchImpl = fetch
) {
  const tokenRes = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  });
  if (!tokenRes.ok) throw new PublicError('Google не принял код авторизации', 401);
  const { access_token: accessToken } = await tokenRes.json();

  const profileRes = await fetchImpl(PROFILE_URL, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!profileRes.ok) throw new PublicError('Google не отдал профиль', 401);
  const profile = await profileRes.json();

  return {
    externalId: String(profile.id),
    displayName: profile.name ?? 'Пользователь Google',
    avatarUrl: profile.picture ?? null
  };
}
