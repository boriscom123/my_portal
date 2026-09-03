// Проверка подписки на пуши: гость подписаться не может, повторная подписка с
// того же устройства не двоится, отписка убирает.
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
  // Ключи настоящие по форме (base64url без «=»), но выпущены для теста:
  // строка «ПУБЛИЧНЫЙ» проверяла бы не отдачу ключа, а обработку мусора.
  vapid: {
    publicKey:
      'BKd0FOtDZ6E8Z9zvS7DkLzWlR3n6xk0PujC7SsxHqZ3xJk9m5UbXk4hQz1nB0cLZ8fWv2tGqYkR7pM6sTn1oQ4E',
    privateKey: 'p8Y3nK1vQ7sW9xZ2rT4uJ6bN0cM5hL8dF1gA3kE7yI0',
    subject: 'mailto:admin@soloaijourney.online'
  }
};

const подписка = { endpoint: 'https://push.example/abc', keys: { p256dh: 'ключ', auth: 'соль' } };

function as(userId) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${signSession({ userId, role: 'user' }, config.jwtSecret)}`
  };
}

async function человек(pool) {
  const { rows } = await pool.query(
    `INSERT INTO users (display_name) VALUES ('Пётр') RETURNING id`
  );
  return Number(rows[0].id);
}

test('публичный ключ отдаётся всем', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const { key } = await (await fetch(`${base}/api/push/key`)).json();
      assert.equal(key, config.vapid.publicKey);
    });
  });
});

test('без настроенных ключей отдаётся пусто, а не ошибка', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const без = { ...config, vapid: { publicKey: '', privateKey: '', subject: '' } };
    const app = finalize(createApp({ config: без, pool }));
    await withServer(app, async (base) => {
      // По пустому ключу клиент понимает, что предлагать подписку не нужно,
      // и не показывает кнопку, которая всё равно не сработает.
      assert.equal((await (await fetch(`${base}/api/push/key`)).json()).key, '');
    });
  });
});

test('гость подписаться не может', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/push/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(подписка)
      });
      assert.equal(res.status, 401);
    });
  });
});

test('повторная подписка того же устройства не двоится', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const id = await человек(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      for (let i = 0; i < 2; i += 1) {
        await fetch(`${base}/api/push/subscribe`, {
          method: 'POST',
          headers: as(id),
          body: JSON.stringify(подписка)
        });
      }
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM push_subscriptions');
      assert.equal(rows[0].n, 1);
    });
  });
});

test('отписка убирает подписку', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const id = await человек(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      await fetch(`${base}/api/push/subscribe`, {
        method: 'POST',
        headers: as(id),
        body: JSON.stringify(подписка)
      });
      await fetch(`${base}/api/push/unsubscribe`, {
        method: 'POST',
        headers: as(id),
        body: JSON.stringify({ endpoint: подписка.endpoint })
      });
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM push_subscriptions');
      assert.equal(rows[0].n, 0);
    });
  });
});

test('чужую подписку отписать нельзя', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const петр = await человек(pool);
    const { rows } = await pool.query(
      `INSERT INTO users (display_name) VALUES ('Анна') RETURNING id`
    );
    const анна = Number(rows[0].id);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      await fetch(`${base}/api/push/subscribe`, {
        method: 'POST',
        headers: as(петр),
        body: JSON.stringify(подписка)
      });
      await fetch(`${base}/api/push/unsubscribe`, {
        method: 'POST',
        headers: as(анна),
        body: JSON.stringify({ endpoint: подписка.endpoint })
      });
      const { rows: осталось } = await pool.query(
        'SELECT count(*)::int AS n FROM push_subscriptions'
      );
      assert.equal(осталось[0].n, 1);
    });
  });
});
