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
import {
  youtubeApp,
  savePlatformApp,
  loadPlatformApp,
  channelApp,
  forgetPlatformSecret
} from '../services/platform-apps.js';
import { normalizeChannel } from '../services/platforms/announcement.js';
import { findMaxChat } from '../services/platforms/max-channel.js';
import { checkTelegramChannel } from '../services/platforms/telegram-channel.js';
import {
  instagramApp,
  instagramConsentUrl,
  exchangeInstagramCode
} from '../services/platforms/instagram-auth.js';
import {
  loadDrawingSettings,
  saveDrawingSettings,
  forgetDrawingToken
} from '../services/drawing-settings.js';
import { checkDrawingToken } from '../services/images.js';
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

  // Подключение аккаунта Instagram. Устроено как у YouTube, и отличие одно, но
  // важное: обновляемого refresh-токена у площадки нет — есть долгий токен на
  // 60 дней, который портал продлевает сам, пока хоть что-то выкладывает.
  router.get('/instagram/connect', async (req, res) => {
    const app = await instagramApp(pool, config);
    if (!app.configured) {
      throw new PublicError('Приложение Instagram не настроено — заполните его в настройках', 503);
    }
    const state = signShortLived(
      { from: localPath(req.query.from) ?? localPath(req.get('referer')) ?? '/settings' },
      config.jwtSecret,
      STATE_SECONDS
    );
    res.redirect(instagramConsentUrl(app, state));
  });

  router.get('/instagram/callback', async (req, res) => {
    if (req.query.error) {
      throw new PublicError(`Instagram отказал: ${req.query.error_description ?? req.query.error}`, 400);
    }
    const code = String(req.query.code ?? '');
    if (!code) throw new PublicError('Instagram не прислал код', 400);

    const state = verifyShortLived(String(req.query.state ?? ''), config.jwtSecret);
    if (!state) throw new PublicError('Подключение устарело — начните заново', 400);

    const access = await exchangeInstagramCode(await instagramApp(pool, config), code, fetchImpl);
    await saveIntegration(pool, config, {
      name: 'instagram',
      token: access.token,
      // Номер аккаунта живёт в поле refresh-токена: своего refresh-токена у
      // площадки нет, а номер нужен каждому запросу выкладки.
      refreshToken: access.userId,
      expiresAt: access.expiresAt
    });
    res.redirect(`${localPath(state.from) ?? '/settings'}?instagram=connected`);
  });

  router.post('/instagram/disconnect', async (req, res) => {
    await pool.query(`DELETE FROM integrations WHERE name = 'instagram'`);
    res.json({ ok: true });
  });

  /**
   * Ключи приложений площадок коротких видео.
   *
   * Пока это только хранение: сама выкладка — следующие шаги. Заводится
   * заранее не из любви к заготовкам, а потому что ключи автор получает в
   * момент, когда проходит регистрацию на площадке, и складывать их до тех пор
   * ему некуда.
   */
  for (const [platform, titles] of [
    ['instagram', { id: 'Instagram App ID', secret: 'Instagram App Secret' }],
    ['tiktok', { id: 'Client key', secret: 'Client secret' }]
  ]) {
    router.post(`/${platform}/app`, async (req, res) => {
      const clientId = String(req.body?.clientId ?? '').trim();
      if (!clientId) throw new PublicError(`${titles.id} пустой`, 400);

      await savePlatformApp(pool, config, {
        name: platform,
        clientId,
        // Пустое поле означает «не менять»: показать сохранённый секрет нельзя.
        clientSecret: String(req.body?.clientSecret ?? ''),
        mode: 'semi'
      });

      const stored = await loadPlatformApp(pool, config, platform);
      res.json({ clientId: stored?.clientId ?? '', hasSecret: Boolean(stored?.clientSecret) });
    });
  }

  // Рисование через Hugging Face: токен и список моделей. Номера приложения у
  // Hugging Face нет — только токен, поэтому маршрут свой, а не общий с
  // площадками.
  router.post('/huggingface/app', async (req, res) => {
    await saveDrawingSettings(pool, config, {
      // Пустое поле означает «не менять»: показать сохранённый токен нельзя.
      token: String(req.body?.token ?? ''),
      models: String(req.body?.models ?? '')
    });
    const stored = await loadDrawingSettings(pool, config);
    // Сам токен наружу не отдаём — только то, что он есть.
    res.json({ models: stored.modelsText, hasToken: Boolean(stored.token) });
  });

  // Проверка токена бесплатным запросом: картинку не рисует, кредиты не тратит.
  router.post('/huggingface/check', async (req, res) => {
    const { token } = await loadDrawingSettings(pool, config);
    res.json(await checkDrawingToken(token, fetchImpl));
  });

  router.post('/huggingface/forget', async (req, res) => {
    await forgetDrawingToken(pool);
    res.json({ ok: true });
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

    // Пустое поле токена означает «не менять»: показать сохранённый нельзя, и
    // заставлять человека перевставлять его ради правки адреса канала незачем.
    // Проверять при этом надо тот токен, которым портал будет постить.
    const given = String(req.body?.token ?? '');
    const current = await channelApp(pool, config, platform);
    const token = given || current.token;

    if (!token) {
      throw new PublicError(
        platform === 'telegram'
          ? 'Нужен токен бота: своего бота у портала не настроено'
          : 'Нужен токен бота MAX: постить нечем',
        400
      );
    }

    // Проверка ДО сохранения, а не после. Иначе неподошедший токен остаётся в
    // настройках и продолжает ломать отправку, хотя человеку показали отказ.
    let settings = { channel };
    if (platform === 'telegram') {
      try {
        await checkTelegramChannel({ token, channel });
      } catch (error) {
        throw new PublicError(error.message, 400);
      }
    } else if (!/^-?\d+$/.test(channel)) {
      // MAX адресует канал числом, а вставляют в поле ссылку — она под рукой.
      // Спрашиваем у площадки список каналов бота и находим номер сами: просить
      // человека выяснять его вручную значит отправлять его читать чужую
      // документацию из-за нашей лени.
      const found = await findMaxChat({ token, needle: channel });
      if (!found?.chatId) {
        throw new PublicError(
          'Канал не найден среди каналов этого бота. Проверьте, что бот добавлен в канал, ' +
            'и вставьте ссылку на канал или его числовой идентификатор.',
          400
        );
      }
      settings = { channel: found.chatId, link: found.link };
    }

    await savePlatformApp(pool, config, {
      name: platform,
      clientId: '',
      clientSecret: given,
      mode: 'auto',
      settings
    });

    const app = await channelApp(pool, config, platform);
    res.json({ channel: app.channel, configured: app.configured });
  });

  /**
   * Убирает свой токен канала Telegram — постить снова будет бот портала.
   *
   * Отдельной кнопкой, потому что иначе убрать его нечем: показать сохранённый
   * токен нельзя, а пустое поле означает «не менять». Заказчик вставил в это
   * поле токен от MAX — и оказался заперт с настройкой, которая не работает и
   * не стирается.
   */
  router.post('/channel/telegram/reset', async (req, res) => {
    const token = config.telegram?.botToken ?? '';
    if (!token) {
      throw new PublicError('Своего бота у портала не настроено — токен нужен ваш', 400);
    }

    const { channel } = await channelApp(pool, config, 'telegram');
    if (channel) {
      // Прежде чем убрать чужой токен, убеждаемся, что бот портала канал видит:
      // молча оставить площадку ненастроенной — не починка.
      try {
        await checkTelegramChannel({ token, channel });
      } catch (error) {
        throw new PublicError(error.message, 400);
      }
    }

    await forgetPlatformSecret(pool, 'telegram');
    const app = await channelApp(pool, config, 'telegram');
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
