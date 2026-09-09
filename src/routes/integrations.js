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
import {
  youtubeConsentUrl,
  exchangeYoutubeCode
} from '../services/platforms/youtube-auth.js';
import { youtubeApp, savePlatformApp, channelApp } from '../services/platform-apps.js';
import { normalizeChannel } from '../services/platforms/announcement.js';
import { findMaxChat } from '../services/platforms/max-channel.js';
import { signShortLived, verifyShortLived } from '../lib/jwt.js';

// Куда возвращать, если страница отправления неизвестна.
const DEFAULT_RETURN = '/settings';
// Сколько живёт state. Десять минут — с запасом на выбор аккаунта и чтение
// предупреждения Google, но не сутки.
const STATE_SECONDS = 600;

/**
 * Оставляет от адреса только путь внутри портала. null — чужое.
 * Без этой проверки в state можно было бы положить чужой адрес и увести
 * человека с портала его же кнопкой.
 */
function localPath(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  // Свой же адрес приходит целиком в заголовке перехода — берём из него путь.
  const path = raw.startsWith('http') ? new URL(raw).pathname : raw;
  // Двойной слэш в начале браузер читает как чужой узел, а не как путь.
  return path.startsWith('/') && !path.startsWith('//') ? path : null;
}

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

  // Канал YouTube подключается возвратом на наш адрес, а не копированием кода:
  // здесь приложение наше, и адрес возврата задаём мы сами.
  router.get('/youtube/connect', async (req, res) => {
    const app = await youtubeApp(pool, config);
    if (!app.configured) {
      throw new PublicError('Приложение YouTube не настроено — заполните его в настройках', 503);
    }
    // Куда вернуть человека: он приходит сюда и из настроек, и со страницы
    // загрузки, а возвращался всегда на загрузку. Адрес переживает переход на
    // Google в state — подписанным, иначе им можно было бы увести куда угодно.
    const state = signShortLived(
      { from: localPath(req.query.from) ?? localPath(req.get('referer')) ?? DEFAULT_RETURN },
      config.jwtSecret,
      STATE_SECONDS
    );
    res.redirect(youtubeConsentUrl(app, state));
  });

  // Возврат с экрана согласия. Сюда человека приводит браузер, поэтому в ответ
  // перенаправление на страницу загрузки, а не json.
  router.get('/youtube/callback', async (req, res) => {
    if (req.query.error) throw new PublicError(`Google отказал: ${req.query.error}`, 400);
    const code = String(req.query.code ?? '');
    if (!code) throw new PublicError('Google не прислал код', 400);

    // state вернулся от Google нетронутым — проверяем подпись. Чужой или
    // протухший означает, что этот код возврата мы не запрашивали.
    const state = verifyShortLived(String(req.query.state ?? ''), config.jwtSecret);
    if (!state) throw new PublicError('Подключение устарело — начните заново', 400);

    const tokens = await exchangeYoutubeCode(await youtubeApp(pool, config), code, fetchImpl);
    await saveIntegration(pool, config, { name: 'youtube', ...tokens });
    res.redirect(`${localPath(state.from) ?? DEFAULT_RETURN}?youtube=connected`);
  });

  // Ключи приложения площадки: автор переносит их из чужой консоли, и место им
  // в кабинете, а не в файле на сервере. Секрет обратно не отдаём никогда —
  // страница показывает лишь то, что он сохранён.
  router.post('/youtube/app', async (req, res) => {
    const clientId = String(req.body?.clientId ?? '').trim();
    if (!clientId) throw new PublicError('Номер приложения пустой', 400);

    await savePlatformApp(pool, config, {
      name: 'youtube',
      clientId,
      // Пустое поле означает «не менять»: показать сохранённый секрет нельзя,
      // и правка одного номера приложения не должна стирать его молча.
      clientSecret: String(req.body?.clientSecret ?? ''),
      mode: req.body?.mode === 'auto' ? 'auto' : 'semi'
    });

    const app = await youtubeApp(pool, config);
    res.json({ clientId: app.clientId, mode: app.mode, configured: app.configured });
  });

  // Отключить канал: токены забываем, ключи приложения оставляем — заводить их
  // заново ради смены аккаунта незачем.
  router.post('/youtube/disconnect', async (req, res) => {
    await pool.query(`DELETE FROM integrations WHERE name = 'youtube'`);
    res.json({ ok: true });
  });

  // Настройки канала: куда постим и чем. У Telegram бот у портала уже есть —
  // нужен только адрес канала; у MAX своего бота нет, и токен автор заводит сам.
  router.post('/channel/:platform', async (req, res) => {
    const platform = req.params.platform;
    if (!['telegram', 'max'].includes(platform)) {
      throw new PublicError('Неизвестная площадка', 400);
    }

    const channel = normalizeChannel(platform, req.body?.channel);
    if (!channel) {
      throw new PublicError(
        'Адрес канала не годится. Подойдёт имя вида @moy-kanal, ссылка на канал ' +
          'или числовой идентификатор закрытого канала. Ссылка-приглашение не подойдёт: ' +
          'постить по ней нельзя.',
        400
      );
    }

    await savePlatformApp(pool, config, {
      name: platform,
      clientId: '',
      // Пустой токен означает «не менять»: показать сохранённый нельзя.
      clientSecret: String(req.body?.token ?? ''),
      mode: 'auto',
      settings: { channel }
    });

    let app = await channelApp(pool, config, platform);

    // MAX адресует канал числом, а вставляют в поле ссылку — она под рукой.
    // Спрашиваем у площадки список каналов бота и находим номер сами: просить
    // человека выяснять его вручную значит отправлять его читать чужую
    // документацию из-за нашей лени.
    if (platform === 'max' && app.token && !/^-?\d+$/.test(app.channel)) {
      const found = await findMaxChat({ token: app.token, needle: app.channel });
      if (!found?.chatId) {
        throw new PublicError(
          'Канал не найден среди каналов этого бота. Проверьте, что бот добавлен в канал, ' +
            'и вставьте ссылку на канал или его числовой идентификатор.',
          400
        );
      }
      await savePlatformApp(pool, config, {
        name: platform,
        clientId: '',
        clientSecret: '',
        mode: 'auto',
        settings: { channel: found.chatId, link: found.link }
      });
      app = await channelApp(pool, config, platform);
    }

    res.json({ channel: app.channel, configured: app.configured });
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
