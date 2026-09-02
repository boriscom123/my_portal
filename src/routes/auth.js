// Маршруты входа. Задача — довести человека от кнопки до куки: проверить, кто
// он, вызвать единую процедуру входа и выдать токен. Зачем здесь так мало
// логики: проверка подписи, обмен кода и правило «один человек — один аккаунт»
// живут в своих модулях, а этот файл — только их склейка и HTTP.
// Подключается в src/app.js по префиксу /api/auth.
import { Router } from 'express';
import { signSession, signShortLived, verifyShortLived } from '../lib/jwt.js';
import { verifyTelegramWidget } from '../lib/telegram-signature.js';
import { googleRedirectUri, buildConsentUrl, fetchGoogleProfile } from '../lib/google-oauth.js';
import { resolveIdentity } from '../services/identity.js';
import { SESSION_COOKIE, sessionCookieOptions } from '../middleware/session.js';
import { PublicError } from '../middleware/errors.js';

// Десять минут на прохождение экрана согласия. Больше не нужно, а долгоживущий
// state — это долгоживущая возможность подсунуть чужой ответ.
const STATE_TTL_SECONDS = 600;

/**
 * Завершает вход: выпускает токен, ставит куку и возвращает его же —
 * телом ответа пользуются мини-приложения, кукой сайт и PWA.
 * Вызывается всеми способами входа этого файла.
 */
function completeLogin(res, { userId, role }, config) {
  const token = signSession({ userId, role }, config.jwtSecret);
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  return token;
}

export function authRoutes(config, pool) {
  const router = Router();

  // Шаг 1 Google: уводим на экран согласия. В state кладём того, кто уже вошёл,
  // — тогда возврат станет привязкой, а не вторым аккаунтом.
  router.get('/google', (req, res) => {
    if (!config.google.clientId) throw new PublicError('Вход через Google не настроен', 503);
    const state = signShortLived(
      { currentUserId: req.user?.id ?? null },
      config.jwtSecret,
      STATE_TTL_SECONDS
    );
    res.redirect(
      buildConsentUrl({
        clientId: config.google.clientId,
        redirectUri: googleRedirectUri(config.publicBaseUrl),
        state
      })
    );
  });

  // Шаг 2 Google: код на профиль, профиль в единую процедуру входа.
  router.get('/google/callback', async (req, res) => {
    const state = verifyShortLived(String(req.query.state ?? ''), config.jwtSecret);
    if (!state) throw new PublicError('Ссылка возврата устарела, попробуйте войти заново', 400);

    const profile = await fetchGoogleProfile({
      code: String(req.query.code ?? ''),
      clientId: config.google.clientId,
      clientSecret: config.google.clientSecret,
      redirectUri: googleRedirectUri(config.publicBaseUrl)
    });

    const result = await resolveIdentity(pool, {
      provider: 'google',
      ...profile,
      currentUserId: state.currentUserId,
      adminIdentities: config.adminIdentities
    });
    completeLogin(res, result, config);
    res.redirect('/');
  });

  // Виджет Telegram: данные приходят от клиента, доверие даёт только подпись.
  router.post('/telegram', async (req, res) => {
    if (!verifyTelegramWidget(req.body ?? {}, config.telegram.botToken)) {
      throw new PublicError('Подпись Telegram не сошлась', 401);
    }
    const data = req.body;
    const result = await resolveIdentity(pool, {
      provider: 'tg_widget',
      externalId: String(data.id),
      displayName: [data.first_name, data.last_name].filter(Boolean).join(' ') || 'Пользователь',
      avatarUrl: data.photo_url ?? null,
      currentUserId: req.user?.id ?? null,
      adminIdentities: config.adminIdentities
    });
    const token = completeLogin(res, result, config);
    res.json({ token, conflict: result.conflict });
  });

  // Кто я. Единственный источник правды для клиента о текущем пользователе.
  router.get('/me', async (req, res) => {
    if (!req.user) {
      res.json({ user: null });
      return;
    }
    const { rows } = await pool.query(
      'SELECT id, display_name, avatar_url, role FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows.length) {
      res.json({ user: null });
      return;
    }
    const { rows: links } = await pool.query(
      'SELECT provider FROM identities WHERE user_id = $1 ORDER BY provider',
      [req.user.id]
    );
    res.json({
      user: {
        id: Number(rows[0].id),
        displayName: rows[0].display_name,
        avatarUrl: rows[0].avatar_url,
        role: rows[0].role,
        providers: links.map((l) => l.provider)
      }
    });
  });

  // Выход. Токен не отзывается на сервере — гасится кука; для портала с
  // отзывами о видеоуроках этого достаточно, список отозванных токенов был бы
  // хранилищем ради одного случая.
  router.post('/logout', (req, res) => {
    res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
    res.json({ ok: true });
  });

  return router;
}
