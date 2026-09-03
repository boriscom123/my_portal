// Проверка события «вышел урок» — это ровно то, что заказчик будет проверять
// руками с ноутбука, глядя на телефон.
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
  telegram: { botToken: '', channelId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: 'mailto:a@b' }
};

/** Приложение с подменёнными каналами: тест не должен ходить в сеть. */
function makeApp(pool, sent) {
  const app = createApp({ config, pool });
  app.locals.channels = { webpush: async (_, m) => sent.push(m) };
  return finalize(app);
}

async function seed(pool) {
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin'), ('Пётр', 'user') RETURNING id`
  );
  const [admin, petr] = rows.map((r) => Number(r.id));
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, 'https://push.example/petr', 'k', 's')`,
    [petr]
  );
  return { admin, petr };
}

function headers(admin) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${signSession({ userId: admin, role: 'admin' }, config.jwtSecret)}`
  };
}

const body = JSON.stringify({
  title: 'Docker, часть 1',
  description: 'Контейнеры',
  status: 'published',
  publishedAt: '2026-09-03T10:00:00Z'
});

test('публикация урока рассылает уведомления подписчикам', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { admin } = await seed(pool);
    const sent = [];
    const app = makeApp(pool, sent);
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/lessons/docker-1`, {
        method: 'PUT',
        headers: headers(admin),
        body: body
      });
      assert.equal(res.status, 200);
    });
    assert.equal(sent.length, 1);
    assert.match(sent[0].body, /Docker/);
    assert.match(sent[0].url, /^\/lesson\/docker-1$/);
  });
});

test('повторное сохранение опубликованного урока не шлёт второй раз', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { admin } = await seed(pool);
    const sent = [];
    const app = makeApp(pool, sent);
    await withServer(app, async (base) => {
      for (let i = 0; i < 2; i += 1) {
        await fetch(`${base}/api/lessons/docker-1`, {
          method: 'PUT',
          headers: headers(admin),
          body: body
        });
      }
    });
    // Правка описания вышедшего урока — обычное дело; будить людей повторно
    // из-за неё нельзя. Защищает ключ вида lesson:<id>:published:<человек>.
    assert.equal(sent.length, 1);
  });
});

test('черновик никого не будит', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { admin } = await seed(pool);
    const sent = [];
    const app = makeApp(pool, sent);
    await withServer(app, async (base) => {
      await fetch(`${base}/api/lessons/chernovik`, {
        method: 'PUT',
        headers: headers(admin),
        body: JSON.stringify({ title: 'Ещё не готов' })
      });
    });
    assert.equal(sent.length, 0);
  });
});
