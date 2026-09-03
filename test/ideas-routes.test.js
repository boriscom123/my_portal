// Проверка борда поверх HTTP. Последний тест — дословный критерий приёмки:
// предложил, проголосовал вторым аккаунтом, сменил статус — уведомление ушло.
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

function as(userId, role = 'user') {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${signSession({ userId, role }, config.jwtSecret)}`
  };
}

async function seed(pool) {
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role)
     VALUES ('Пётр', 'user'), ('Анна', 'user'), ('Автор', 'admin') RETURNING id`
  );
  const [petr, anna, admin] = rows.map((r) => Number(r.id));
  // У Анны есть подписка на пуш — значит уведомление ей есть чем доставить.
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, 'https://push.example/anna', 'k', 's')`,
    [anna]
  );
  return { petr, anna, admin };
}

function приложение(pool, отправлено) {
  const app = createApp({ config, pool });
  app.locals.channels = { webpush: async (_, m) => отправлено.push(m) };
  return finalize(app);
}

async function предложить(base, headers, title = 'Урок про очереди') {
  const res = await fetch(`${base}/api/ideas`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title })
  });
  return { status: res.status, idea: (await res.json()).idea };
}

test('гость идею не предлагает', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await withServer(приложение(pool, []), async (base) => {
      const res = await fetch(`${base}/api/ideas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ title: 'Про очереди' })
      });
      assert.equal(res.status, 401);
    });
  });
});

test('гость и голосовать не может', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr } = await seed(pool);
    await withServer(приложение(pool, []), async (base) => {
      const { idea } = await предложить(base, as(petr));
      const res = await fetch(`${base}/api/ideas/${idea.id}/vote`, {
        method: 'POST',
        headers: { Accept: 'application/json' }
      });
      assert.equal(res.status, 401);
    });
  });
});

test('статус меняет только автор портала', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr } = await seed(pool);
    await withServer(приложение(pool, []), async (base) => {
      const { idea } = await предложить(base, as(petr));
      const res = await fetch(`${base}/api/ideas/${idea.id}/status`, {
        method: 'POST',
        headers: as(petr),
        body: JSON.stringify({ status: 'accepted' })
      });
      assert.equal(res.status, 403);
    });
  });
});

test('предложил, проголосовал, сменил статус — уведомление ушло', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr, anna, admin } = await seed(pool);
    const отправлено = [];
    await withServer(приложение(pool, отправлено), async (base) => {
      const { idea } = await предложить(base, as(petr));
      await fetch(`${base}/api/ideas/${idea.id}/vote`, { method: 'POST', headers: as(anna) });

      const res = await fetch(`${base}/api/ideas/${idea.id}/status`, {
        method: 'POST',
        headers: as(admin, 'admin'),
        body: JSON.stringify({ status: 'accepted' })
      });
      assert.equal(res.status, 200);
    });
    assert.equal(отправлено.length, 1);
    assert.match(отправлено[0].body, /Урок про очереди/);
    assert.match(отправлено[0].title, /принята/i);
  });
});

test('повторная смена статуса на тот же не будит людей снова', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr, anna, admin } = await seed(pool);
    const отправлено = [];
    await withServer(приложение(pool, отправлено), async (base) => {
      const { idea } = await предложить(base, as(petr));
      await fetch(`${base}/api/ideas/${idea.id}/vote`, { method: 'POST', headers: as(anna) });
      for (let i = 0; i < 2; i += 1) {
        await fetch(`${base}/api/ideas/${idea.id}/status`, {
          method: 'POST',
          headers: as(admin, 'admin'),
          body: JSON.stringify({ status: 'accepted' })
        });
      }
    });
    assert.equal(отправлено.length, 1);
  });
});

test('вышедшая идея уводит уведомление на урок, а не на борд', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr, anna, admin } = await seed(pool);
    await pool.query(
      `INSERT INTO lessons (slug, title, status, published_at)
       VALUES ('ocheredi', 'Очереди', 'published', now())`
    );
    const отправлено = [];
    await withServer(приложение(pool, отправлено), async (base) => {
      const { idea } = await предложить(base, as(petr));
      await fetch(`${base}/api/ideas/${idea.id}/vote`, { method: 'POST', headers: as(anna) });
      await fetch(`${base}/api/ideas/${idea.id}/status`, {
        method: 'POST',
        headers: as(admin, 'admin'),
        body: JSON.stringify({ status: 'released', lessonSlug: 'ocheredi' })
      });
    });
    assert.equal(отправлено[0].url, '/lesson/ocheredi');
  });
});
