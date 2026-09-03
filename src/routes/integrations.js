// Подключение чужих сервисов к порталу.
//
// Задача — получить от Яндекса токен доступа к Диску и сохранить его
// зашифрованным. Зачем отдельным файлом от routes/auth.js: там вход людей на
// портал, здесь доступ портала к чужому хранилищу — разные вещи с разными
// правилами и разными последствиями утечки.
//
// Подключение идёт через код подтверждения, а не через возврат на наш адрес:
// в приложении заказчика адрес возврата поменять нельзя, там стоит адрес
// Яндекса, показывающий код на экране. Для приложения на одного человека это
// разумная цена — одно копирование раз в несколько месяцев.
// Подключается в src/app.js по префиксу /api/integrations.
import { Router } from 'express';
import { requireAdmin } from '../middleware/guards.js';
import { PublicError } from '../middleware/errors.js';
import { saveIntegration, loadIntegration, listDiskFiles } from '../services/disk.js';

const AUTHORIZE_URL = 'https://oauth.yandex.ru/authorize';
const TOKEN_URL = 'https://oauth.yandex.ru/token';

export function integrationRoutes(config, pool, fetchImpl = fetch) {
  const router = Router();

  // Подключать сервисы может только автор портала: это доступ к его же диску.
  router.use(requireAdmin);

  /** Куда отправить человека за кодом подтверждения. */
  router.get('/yandex-disk/connect', (req, res) => {
    if (!config.yandexOauth.clientId) {
      throw new PublicError('Приложение Яндекса не настроено: нет YANDEX_OAUTH_CLIENT_ID', 503);
    }
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.yandexOauth.clientId
    });
    res.redirect(`${AUTHORIZE_URL}?${params}`);
  });

  /** Обмен кода, скопированного человеком, на токен. */
  router.post('/yandex-disk/code', async (req, res) => {
    const code = String(req.body?.code ?? '').trim();
    if (!code) throw new PublicError('Код не введён');

    const response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: config.yandexOauth.clientId,
        client_secret: config.yandexOauth.clientSecret
      })
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      // Чаще всего это просроченный код: он живёт минуты.
      throw new PublicError(`Яндекс не принял код: ${response.status} ${body.slice(0, 200)}`, 400);
    }

    const body = await response.json();
    await saveIntegration(pool, config, {
      name: 'yandex-disk',
      token: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : null
    });
    res.json({ ok: true });
  });

  /** Список видео в папке Диска. */
  router.get('/yandex-disk/files', async (req, res) => {
    const integration = await loadIntegration(pool, config, 'yandex-disk');
    if (!integration) throw new PublicError('Диск не подключён', 409);
    const path = String(req.query.path ?? 'disk:/');
    res.json({ files: await listDiskFiles(integration.token, path, fetchImpl) });
  });

  return router;
}
