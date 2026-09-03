// Подключение Яндекс Диска через код подтверждения.
//
// В приложении заказчика адрес возврата поменять нельзя — там стоит адрес
// Яндекса, показывающий код на экране. Поэтому подключение идёт копированием
// кода, и проверяется именно этот путь.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://soloaijourney.online',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', botId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: '' },
  redis: { url: 'redis://redis:6379', prefix: 'portal:' },
  yandex: { apiKey: '', folderId: '' },
  yandexOauth: { clientId: 'app-id', clientSecret: 'app-secret' },
  tokenEncryptionKey: 'a'.repeat(64),
  media: { dir: '/tmp', ttlHours: 168 }
};

async function makeAdmin(pool) {
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'admin' }, config.jwtSecret)}`
  };
}

test('подключать сервисы может только автор портала', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/integrations/yandex-disk/code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ code: '1234567' })
      });
      assert.equal(res.status, 401);
    });
  });
});

test('код обменивается на токен, токен ложится зашифрованным', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const headers = await makeAdmin(pool);
    const fetchStub = async (url, options) => {
      assert.match(String(url), /oauth\.yandex\.ru\/token/);
      assert.match(options.body.toString(), /grant_type=authorization_code/);
      assert.match(options.body.toString(), /code=1234567/);
      return {
        ok: true,
        json: async () => ({ access_token: 'секретный-токен', expires_in: 3600 })
      };
    };
    const app = finalize(createApp({ config, pool, fetchImpl: fetchStub }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/integrations/yandex-disk/code`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ code: '1234567' })
      });
      assert.equal(res.status, 200);
    });

    const { rows } = await pool.query(`SELECT token FROM integrations WHERE name = 'yandex-disk'`);
    assert.ok(!rows[0].token.includes('секретный'));
  });
});

test('просроченный код объясняется человеку', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const headers = await makeAdmin(pool);
    const fetchStub = async () => ({
      ok: false,
      status: 400,
      text: async () => 'invalid_grant'
    });
    const app = finalize(createApp({ config, pool, fetchImpl: fetchStub }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/integrations/yandex-disk/code`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ code: 'старый' })
      });
      assert.equal(res.status, 400);
      // Код живёт минуты — человек должен понять, что надо взять новый.
      assert.match((await res.json()).error, /не принял код/i);
    });
  });
});

test('список файлов до подключения отвечает внятно', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const headers = await makeAdmin(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/integrations/yandex-disk/files`, { headers });
      assert.equal(res.status, 409);
      assert.match((await res.json()).error, /не подключён/i);
    });
  });
});
