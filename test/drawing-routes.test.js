// Настройки рисования через кабинет. Главное — токен не возвращается наружу
// ни ответом API, ни страницей, а проверка токена не рисует картинку.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { loadDrawingSettings } from '../src/services/drawing-settings.js';
import { WHOAMI_URL } from '../src/services/images.js';
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

async function adminHeaders(pool) {
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'admin' }, config.jwtSecret)}`
  };
}

test('токен сохраняется, а наружу не отдаётся ни ответом, ни страницей', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const headers = await adminHeaders(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/integrations/huggingface/app`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ token: 'hf_secret_token', models: '' })
      });
      assert.equal(response.status, 200);
      const answer = await response.json();
      assert.deepEqual(answer, { models: '', hasToken: true });

      const page = await (await fetch(`${base}/settings`, { headers })).text();
      assert.match(page, /data-block="drawing"/);
      assert.match(page, /сохранён — оставьте пустым/);
      assert.ok(!page.includes('hf_secret_token'), 'токен попал в разметку');
    });
    assert.equal((await loadDrawingSettings(pool, config)).token, 'hf_secret_token');
  });
});

test('проверка токена спрашивает, чей он, и не рисует', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const headers = await adminHeaders(pool);
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, auth: options?.headers?.Authorization });
      return { ok: true, status: 200, json: async () => ({ name: 'boris' }) };
    };
    const app = finalize(createApp({ config, pool, fetchImpl }));
    await withServer(app, async (base) => {
      await fetch(`${base}/api/integrations/huggingface/app`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ token: 'hf_secret_token', models: '' })
      });
      const response = await fetch(`${base}/api/integrations/huggingface/check`, {
        method: 'POST',
        headers
      });
      assert.deepEqual(await response.json(), { ok: true, account: 'boris' });
    });
    assert.deepEqual(calls, [{ url: WHOAMI_URL, auth: 'Bearer hf_secret_token' }]);
  });
});

test('убранный токен выключает рисование', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const headers = await adminHeaders(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      await fetch(`${base}/api/integrations/huggingface/app`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ token: 'hf_secret_token', models: '' })
      });
      const response = await fetch(`${base}/api/integrations/huggingface/forget`, {
        method: 'POST',
        headers
      });
      assert.equal(response.status, 200);
    });
    assert.equal((await loadDrawingSettings(pool, config)).token, '');
  });
});

test('зрителю настройки рисования недоступны', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(
      `INSERT INTO users (display_name, role) VALUES ('Зритель', 'user') RETURNING id`
    );
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/integrations/huggingface/app`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'user' }, config.jwtSecret)}`
        },
        body: JSON.stringify({ token: 'hf_x', models: '' })
      });
      assert.equal(response.status, 403);
    });
  });
});
