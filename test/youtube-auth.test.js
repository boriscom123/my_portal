// Обмен токенами с Google. В сеть не ходим: fetch подставляется.
//
// Проверяем три вещи, каждая из которых уже ломала подключения в этом проекте:
// адрес согласия просит offline-доступ (без него refresh-токена не будет вовсе,
// и подключение перестанет работать через час), протухший токен обновляется сам,
// и секрет не утекает в текст ошибки — он уходит и в журнал, и на экран.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  youtubeConsentUrl,
  exchangeYoutubeCode,
  youtubeAccessToken
} from '../src/services/platforms/youtube-auth.js';
import { saveIntegration } from '../src/services/disk.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  tokenEncryptionKey: 'a'.repeat(64),
  publicBaseUrl: 'https://portal.example',
  youtube: {
    clientId: 'client-id',
    clientSecret: 'secret-value',
    redirectUri: '',
    mode: 'semi'
  }
};

// Приложение площадки: то, что автор ввёл в кабинете. Ключи из окружения тут
// запасной путь, и он же проверяется тестом про обновление токена.
const app = {
  clientId: 'client-id',
  clientSecret: 'secret-value',
  redirectUri: 'https://portal.example/api/integrations/youtube/callback',
  mode: 'semi',
  configured: true
};

test('адрес согласия просит offline-доступ и одну область', () => {
  const url = new URL(youtubeConsentUrl(app));
  assert.equal(url.searchParams.get('access_type'), 'offline');
  // Без prompt=consent Google не выдаёт refresh-токен на повторном
  // подключении — молча, и подключение живёт ровно час.
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(
    url.searchParams.get('scope'),
    'https://www.googleapis.com/auth/youtube.force-ssl'
  );
  assert.equal(url.searchParams.get('redirect_uri'), app.redirectUri);
});

test('код меняется на пару токенов', async () => {
  const fetchStub = async (url, options) => {
    assert.equal(String(url), 'https://oauth2.googleapis.com/token');
    assert.match(options.body, /grant_type=authorization_code/);
    return {
      ok: true,
      json: async () => ({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3599 })
    };
  };

  const result = await exchangeYoutubeCode(app, 'code-from-google', fetchStub);
  assert.equal(result.token, 'access-1');
  assert.equal(result.refreshToken, 'refresh-1');
  assert.ok(result.expiresAt > new Date(), 'срок годности должен быть в будущем');
});

test('секрет не попадает в текст ошибки', async () => {
  const fetchStub = async () => ({
    ok: false,
    status: 400,
    text: async () => 'invalid_grant, client_secret=secret-value'
  });

  await assert.rejects(exchangeYoutubeCode(app, 'stale', fetchStub), (error) => {
    assert.doesNotMatch(error.message, /secret-value/);
    assert.match(error.message, /invalid_grant/);
    return true;
  });
});

test('протухший токен обновляется сам', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveIntegration(pool, config, {
      name: 'youtube',
      token: 'stale-access',
      refreshToken: 'refresh-1',
      expiresAt: new Date(Date.now() - 60_000)
    });

    let asked = 0;
    const fetchStub = async (url, options) => {
      asked += 1;
      assert.match(options.body, /grant_type=refresh_token/);
      return { ok: true, json: async () => ({ access_token: 'access-2', expires_in: 3599 }) };
    };

    const token = await youtubeAccessToken(pool, config, fetchStub);
    assert.equal(token, 'access-2');
    assert.equal(asked, 1);

    // Свежий токен обновлять незачем: второй вызов в сеть не идёт.
    const again = await youtubeAccessToken(pool, config, fetchStub);
    assert.equal(again, 'access-2');
    assert.equal(asked, 1);
  });
});

test('обновление не теряет refresh-токен', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveIntegration(pool, config, {
      name: 'youtube',
      token: 'stale-access',
      refreshToken: 'refresh-1',
      expiresAt: new Date(Date.now() - 60_000)
    });

    // Google при обновлении refresh-токен не присылает. Не сохранить прежний
    // значит потерять подключение на следующем же обновлении.
    await youtubeAccessToken(pool, config, async () => ({
      ok: true,
      json: async () => ({ access_token: 'access-2', expires_in: 1 })
    }));

    let refreshed = false;
    await youtubeAccessToken(pool, config, async (url, options) => {
      refreshed = /refresh-1/.test(options.body);
      return { ok: true, json: async () => ({ access_token: 'access-3', expires_in: 3599 }) };
    });
    assert.ok(refreshed, 'обновление должно идти прежним refresh-токеном');
  });
});

test('без подключения токена нет, и это не ошибка', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    assert.equal(await youtubeAccessToken(pool, config, async () => {}), null);
  });
});
