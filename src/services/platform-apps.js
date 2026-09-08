// Приложения площадок: номер приложения и секрет, которые автор вводит в
// кабинете.
//
// Задача — держать ключи там, где их меняет человек, а не в окружении сервера:
// заказчик заводит приложение в чужой консоли и переносит оттуда две строки,
// и ходить за этим в файл на сервере ему незачем.
//
// Секрет шифруется тем же ключом, что и токены доступа. Наружу он не отдаётся
// вовсе: страница показывает лишь то, что он сохранён.
// Вызывается из src/routes/integrations.js, src/routes/admin.js, src/routes/pages.js
// и слоя площадки.
import { encryptSecret, decryptSecret } from '../lib/secrets.js';

/** Куда площадка возвращает человека после согласия. Адрес наш, и он известен. */
export function youtubeRedirectUri(config) {
  return `${config.publicBaseUrl}/api/integrations/youtube/callback`;
}

/**
 * Сохраняет ключи приложения. Пустой секрет прежний не стирает.
 * Так и должно быть: показывать сохранённый секрет нельзя, поэтому поле на
 * странице всегда пустое, и правка одного лишь номера приложения не должна
 * молча ломать подключение.
 */
export async function savePlatformApp(pool, config, { name, clientId, clientSecret, mode }) {
  await pool.query(
    `INSERT INTO platform_apps (name, client_id, client_secret, mode, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (name) DO UPDATE
       SET client_id = EXCLUDED.client_id,
           client_secret = COALESCE(EXCLUDED.client_secret, platform_apps.client_secret),
           mode = EXCLUDED.mode,
           updated_at = now()`,
    [
      name,
      String(clientId ?? '').trim(),
      clientSecret ? encryptSecret(clientSecret, config.tokenEncryptionKey) : null,
      mode === 'auto' ? 'auto' : 'semi'
    ]
  );
}

/** Ключи приложения из базы. null — в кабинете их не заводили. */
export async function loadPlatformApp(pool, config, name) {
  const { rows } = await pool.query(
    'SELECT client_id, client_secret, mode FROM platform_apps WHERE name = $1',
    [name]
  );
  if (!rows.length) return null;
  return {
    clientId: rows[0].client_id,
    clientSecret: rows[0].client_secret
      ? decryptSecret(rows[0].client_secret, config.tokenEncryptionKey)
      : '',
    mode: rows[0].mode
  };
}

/**
 * Приложение YouTube: сначала кабинет, потом окружение.
 *
 * Запасной путь через окружение нужен не для красоты: портал уже выкачен с
 * ключами в .env, и переезд настроек в кабинет не должен ломать то, что
 * работает. Пусто и там и там — площадка просто не настроена, и это не ошибка:
 * портал обязан подниматься без единой настроенной площадки.
 */
export async function youtubeApp(pool, config) {
  const stored = await loadPlatformApp(pool, config, 'youtube');
  const clientId = stored?.clientId || config.youtube?.clientId || '';
  const clientSecret = stored?.clientSecret || config.youtube?.clientSecret || '';
  const mode = stored?.mode ?? config.youtube?.mode ?? 'semi';

  return {
    clientId,
    clientSecret,
    mode,
    redirectUri: youtubeRedirectUri(config),
    // Настроена ли площадка. Отдельным полем, а не проверкой номера по месту:
    // спрашивают об этом три разные страницы, и правило должно быть одно.
    configured: Boolean(clientId && clientSecret)
  };
}
