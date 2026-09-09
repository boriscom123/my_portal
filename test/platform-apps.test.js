// Приложение площадки: ключи, которые автор вводит в кабинете.
//
// Секрет хранится зашифрованным — тем же ключом, что и токены: дамп базы без
// ключа из окружения бесполезен. Наружу секрет не отдаётся вовсе: ни страница,
// ни ответ API его не показывают.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  savePlatformApp,
  loadPlatformApp,
  youtubeApp,
  channelApp
} from '../src/services/platform-apps.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  tokenEncryptionKey: 'a'.repeat(64),
  publicBaseUrl: 'https://portal.example',
  youtube: { clientId: '', clientSecret: '', redirectUri: '', mode: 'semi' }
};

test('ключи сохраняются и читаются', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await savePlatformApp(pool, config, {
      name: 'youtube',
      clientId: 'client-1',
      clientSecret: 'secret-1',
      mode: 'semi'
    });

    const app = await loadPlatformApp(pool, config, 'youtube');
    assert.equal(app.clientId, 'client-1');
    assert.equal(app.clientSecret, 'secret-1');
    assert.equal(app.mode, 'semi');
  });
});

test('секрет лежит в базе зашифрованным', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await savePlatformApp(pool, config, {
      name: 'youtube',
      clientId: 'client-1',
      clientSecret: 'secret-1',
      mode: 'semi'
    });

    const { rows } = await pool.query('SELECT client_secret FROM platform_apps');
    assert.doesNotMatch(rows[0].client_secret, /secret-1/, 'секрет не должен лежать открытым');
  });
});

test('пустой секрет при правке не стирает сохранённый', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await savePlatformApp(pool, config, {
      name: 'youtube',
      clientId: 'client-1',
      clientSecret: 'secret-1',
      mode: 'semi'
    });
    // Автор поправил только номер приложения: поле секрета на странице пустое,
    // потому что показывать его нельзя. Стирать секрет при этом — значит молча
    // сломать подключение.
    await savePlatformApp(pool, config, {
      name: 'youtube',
      clientId: 'client-2',
      clientSecret: '',
      mode: 'auto'
    });

    const app = await loadPlatformApp(pool, config, 'youtube');
    assert.equal(app.clientId, 'client-2');
    assert.equal(app.clientSecret, 'secret-1');
    assert.equal(app.mode, 'auto');
  });
});

test('пусто в базе — берём из окружения', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    // Портал уже выкачен с ключами в .env: переезд настроек в кабинет не должен
    // ломать то, что работает.
    const fromEnv = {
      ...config,
      youtube: { clientId: 'env-id', clientSecret: 'env-secret', redirectUri: '', mode: 'auto' }
    };
    const app = await youtubeApp(pool, fromEnv);
    assert.equal(app.clientId, 'env-id');
    assert.equal(app.clientSecret, 'env-secret');
    assert.equal(app.mode, 'auto');
  });
});

test('сохранённое в кабинете важнее окружения', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const fromEnv = {
      ...config,
      youtube: { clientId: 'env-id', clientSecret: 'env-secret', redirectUri: '', mode: 'auto' }
    };
    await savePlatformApp(pool, config, {
      name: 'youtube',
      clientId: 'db-id',
      clientSecret: 'db-secret',
      mode: 'semi'
    });

    const app = await youtubeApp(pool, fromEnv);
    assert.equal(app.clientId, 'db-id');
    assert.equal(app.mode, 'semi');
  });
});

test('адрес возврата не спрашивается, а вычисляется', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    // Он наш собственный, и лишнее поле здесь — лишняя опечатка в месте, где
    // она даёт redirect_uri_mismatch и час поисков.
    const app = await youtubeApp(pool, config);
    assert.equal(app.redirectUri, 'https://portal.example/api/integrations/youtube/callback');
  });
});

test('ключей нет вовсе — площадка не настроена, и это не ошибка', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const app = await youtubeApp(pool, config);
    assert.equal(app.clientId, '');
    assert.equal(app.configured, false);
  });
});

test('у канала может быть свой бот, а может общий', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const withBot = { ...config, telegram: { botToken: 'bot-portala' } };

    // Токен не задан — постит бот портала: так настройка, сделанная до
    // появления этого поля, продолжает работать.
    await savePlatformApp(pool, withBot, {
      name: 'telegram',
      clientId: '',
      clientSecret: '',
      mode: 'auto',
      settings: { channel: '@kanal' }
    });
    const shared = await channelApp(pool, withBot, 'telegram');
    assert.equal(shared.token, 'bot-portala');
    assert.equal(shared.configured, true);

    // Задан свой — он и важнее: у канала бывает отдельный бот, с именем и
    // картинкой под канал, а не под вход на сайт.
    await savePlatformApp(pool, withBot, {
      name: 'telegram',
      clientId: '',
      clientSecret: 'bot-kanala',
      mode: 'auto',
      settings: { channel: '@kanal' }
    });
    assert.equal((await channelApp(pool, withBot, 'telegram')).token, 'bot-kanala');
  });
});

test('у MAX без своего токена канал не настроен', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    // Общего бота для MAX у портала нет, и подставить нечего.
    await savePlatformApp(pool, config, {
      name: 'max',
      clientId: '',
      clientSecret: '',
      mode: 'auto',
      settings: { channel: '-100' }
    });
    const app = await channelApp(pool, config, 'max');
    assert.equal(app.configured, false);
  });
});
