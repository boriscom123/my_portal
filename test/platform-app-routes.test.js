// Ключи приложения площадки через кабинет.
//
// Главное здесь — что секрет не возвращается наружу ни при каких условиях: он
// уходит и в ответ, и в журнал доступа, если попадёт в адрес.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { loadPlatformApp, savePlatformApp } from '../src/services/platform-apps.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://portal.example',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', botId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: '' },
  redis: { url: 'redis://redis:6379', prefix: 'portal:' },
  yandex: { apiKey: '', folderId: '' },
  yandexOauth: { clientId: '', clientSecret: '' },
  tokenEncryptionKey: 'a'.repeat(64),
  media: { dir: '/tmp', ttlHours: 168 },
  youtube: { clientId: '', clientSecret: '', redirectUri: '', mode: 'semi' }
};

async function seedAdmin(pool) {
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  return Number(rows[0].id);
}

function asUser(userId, role) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${signSession({ userId, role }, config.jwtSecret)}`
  };
}

test('ключи сохраняются, а секрет обратно не отдаётся', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const adminId = await seedAdmin(pool);
    const app = finalize(createApp({ config, pool }));

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/integrations/youtube/app`, {
        method: 'POST',
        headers: asUser(adminId, 'admin'),
        body: JSON.stringify({ clientId: 'client-1', clientSecret: 'secret-1', mode: 'semi' })
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.clientId, 'client-1');
      assert.equal(body.configured, true);
      assert.equal(JSON.stringify(body).includes('secret-1'), false, 'секрет наружу не отдаём');
    });

    const stored = await loadPlatformApp(pool, config, 'youtube');
    assert.equal(stored.clientSecret, 'secret-1');
  });
});

test('пустой секрет при правке сохранённый не стирает', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const adminId = await seedAdmin(pool);
    const app = finalize(createApp({ config, pool }));

    await withServer(app, async (base) => {
      const send = (body) =>
        fetch(`${base}/api/integrations/youtube/app`, {
          method: 'POST',
          headers: asUser(adminId, 'admin'),
          body: JSON.stringify(body)
        });

      await send({ clientId: 'client-1', clientSecret: 'secret-1', mode: 'semi' });
      // Автор поправил номер приложения: поле секрета на странице пустое, потому
      // что показывать сохранённый секрет нельзя.
      await send({ clientId: 'client-2', clientSecret: '', mode: 'auto' });
    });

    const stored = await loadPlatformApp(pool, config, 'youtube');
    assert.equal(stored.clientId, 'client-2');
    assert.equal(stored.clientSecret, 'secret-1');
    assert.equal(stored.mode, 'auto');
  });
});

test('пустой номер приложения не принимаем', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const adminId = await seedAdmin(pool);
    const app = finalize(createApp({ config, pool }));

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/integrations/youtube/app`, {
        method: 'POST',
        headers: asUser(adminId, 'admin'),
        body: JSON.stringify({ clientId: '  ', clientSecret: 'secret', mode: 'semi' })
      });
      assert.equal(response.status, 400);
    });
  });
});

test('чужой человек ключи не меняет', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(
      `INSERT INTO users (display_name, role) VALUES ('Гость', 'user') RETURNING id`
    );
    const app = finalize(createApp({ config, pool }));

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/integrations/youtube/app`, {
        method: 'POST',
        headers: asUser(Number(rows[0].id), 'user'),
        body: JSON.stringify({ clientId: 'chuzhoy', clientSecret: 'secret', mode: 'semi' })
      });
      assert.ok(response.status === 403 || response.status === 401, `код ${response.status}`);
    });

    assert.equal(await loadPlatformApp(pool, config, 'youtube'), null);
  });
});

test('отключение канала не трогает ключи приложения', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const adminId = await seedAdmin(pool);
    const app = finalize(createApp({ config, pool }));

    await withServer(app, async (base) => {
      await fetch(`${base}/api/integrations/youtube/app`, {
        method: 'POST',
        headers: asUser(adminId, 'admin'),
        body: JSON.stringify({ clientId: 'client-1', clientSecret: 'secret-1', mode: 'semi' })
      });
      await pool.query(
        `INSERT INTO integrations (name, token) VALUES ('youtube', 'zashifrovano')`
      );

      const response = await fetch(`${base}/api/integrations/youtube/disconnect`, {
        method: 'POST',
        headers: asUser(adminId, 'admin')
      });
      assert.equal(response.status, 200);
    });

    const { rows } = await pool.query(`SELECT 1 FROM integrations WHERE name = 'youtube'`);
    assert.equal(rows.length, 0, 'токены забываем');
    // Заводить ключи заново ради смены аккаунта незачем.
    assert.equal((await loadPlatformApp(pool, config, 'youtube')).clientId, 'client-1');
  });
});

test('после подключения человек возвращается туда, откуда ушёл', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const adminId = await seedAdmin(pool);
    // Без ключей приложения уход на согласие невозможен — сперва заводим их.
    await savePlatformApp(pool, config, {
      name: 'youtube',
      clientId: 'client-1',
      clientSecret: 'secret-1',
      mode: 'semi'
    });
    const app = finalize(
      createApp({
        config,
        pool,
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({ access_token: 'a', refresh_token: 'r', expires_in: 3599 })
        })
      })
    );

    await withServer(app, async (base) => {
      // Сначала уходим на согласие из настроек: сервер кладёт страницу
      // отправления в state.
      const away = await fetch(
        `${base}/api/integrations/youtube/connect?from=/settings`,
        { headers: asUser(adminId, 'admin'), redirect: 'manual' }
      );
      assert.equal(away.status, 302);
      const state = new URL(away.headers.get('location')).searchParams.get('state');
      assert.ok(state, 'state обязан уйти на Google');

      // Google возвращает его нетронутым.
      const back = await fetch(
        `${base}/api/integrations/youtube/callback?code=kod&state=${encodeURIComponent(state)}`,
        { headers: asUser(adminId, 'admin'), redirect: 'manual' }
      );
      assert.equal(back.status, 302);
      assert.match(back.headers.get('location'), /^\/settings\?youtube=connected/);
    });
  });
});

test('код возврата без подписанного state не принимается', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const adminId = await seedAdmin(pool);
    const app = finalize(createApp({ config, pool }));

    await withServer(app, async (base) => {
      // Чужой код возврата мы не запрашивали — принимать его нельзя.
      const response = await fetch(`${base}/api/integrations/youtube/callback?code=chuzhoy`, {
        headers: asUser(adminId, 'admin'),
        redirect: 'manual'
      });
      assert.equal(response.status, 400);
    });
  });
});
