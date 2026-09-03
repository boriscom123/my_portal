// Проверка слоя уведомлений. Главное правило заказчика: один человек получает
// ОДНО уведомление, а не три по трём каналам, и повтор задачи его не задваивает.
import test from 'node:test';
import assert from 'node:assert/strict';
import { notify } from '../src/services/notify/index.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

/** Каналы-заглушки: запоминают, что и куда ушло. Сеть в тесте не трогаем. */
function makeChannels() {
  const sent = [];
  return {
    sent,
    channels: {
      webpush: async (subscriptions, message) =>
        sent.push({ channel: 'webpush', url: subscriptions[0].endpoint, message }),
      telegram: async (chat, message) => sent.push({ channel: 'telegram', chat, message })
    }
  };
}

async function userWithPush(pool, name = 'Пётр') {
  const { rows } = await pool.query(`INSERT INTO users (display_name) VALUES ($1) RETURNING id`, [
    name
  ]);
  const id = Number(rows[0].id);
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, 'k', 's')`,
    [id, `https://push.example/${id}`]
  );
  return id;
}

async function userWithTelegram(pool) {
  const { rows } = await pool.query(
    `INSERT INTO users (display_name) VALUES ('Анна') RETURNING id`
  );
  const id = Number(rows[0].id);
  await pool.query(
    `INSERT INTO identities (user_id, provider, external_id) VALUES ($1, 'tg_widget', '777')`,
    [id]
  );
  return id;
}

const event = { kind: 'lesson_published', title: 'Новый урок', body: 'Docker', url: '/' };

test('есть подписка на пуш — уходит пушем', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const userId = await userWithPush(pool);
    const { channels, sent } = makeChannels();
    const result = await notify(pool, { ...event, userId, dedupKey: 'а' }, channels);
    assert.equal(result.channel, 'webpush');
    assert.equal(sent.length, 1);
  });
});

test('пуша нет, телеграм есть — уходит ботом', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const userId = await userWithTelegram(pool);
    const { channels, sent } = makeChannels();
    const result = await notify(pool, { ...event, userId, dedupKey: 'б' }, channels);
    assert.equal(result.channel, 'telegram');
    assert.equal(sent[0].chat, '777');
  });
});

test('человек получает одно уведомление, а не три', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const userId = await userWithPush(pool);
    await pool.query(
      `INSERT INTO identities (user_id, provider, external_id) VALUES ($1, 'tg_widget', '888')`,
      [userId]
    );
    const { channels, sent } = makeChannels();
    await notify(pool, { ...event, userId, dedupKey: 'в' }, channels);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].channel, 'webpush');
  });
});

test('повтор с тем же ключом ничего не отправляет', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const userId = await userWithPush(pool);
    const { channels, sent } = makeChannels();
    await notify(pool, { ...event, userId, dedupKey: 'г' }, channels);
    const second = await notify(pool, { ...event, userId, dedupKey: 'г' }, channels);
    assert.equal(sent.length, 1);
    assert.equal(second.reason, 'уже отправляли');
  });
});

test('связаться нечем — молчим и записываем это', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(
      `INSERT INTO users (display_name) VALUES ('Молчун') RETURNING id`
    );
    const { channels, sent } = makeChannels();
    const result = await notify(
      pool,
      { ...event, userId: Number(rows[0].id), dedupKey: 'д' },
      channels
    );
    assert.equal(result.channel, null);
    assert.equal(sent.length, 0);
    const { rows: log } = await pool.query('SELECT channel FROM notifications');
    assert.equal(log[0].channel, null);
  });
});

test('упавшая отправка не оставляет ложной записи в журнале', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const userId = await userWithPush(pool);
    const failing = {
      webpush: async () => {
        throw new Error('канал недоступен');
      }
    };
    await assert.rejects(
      notify(pool, { ...event, userId, dedupKey: 'е' }, failing),
      /недоступен/
    );
    // Иначе повтор задачи после сбоя решил бы, что уже отправлено, и человек
    // не получил бы ничего вообще.
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM notifications');
    assert.equal(rows[0].n, 0);
  });
});

test('в журнале остаётся, что именно отправили', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const userId = await userWithPush(pool);
    const { channels } = makeChannels();
    await notify(pool, { ...event, userId, dedupKey: 'ж' }, channels);
    const { rows } = await pool.query('SELECT kind, channel, payload FROM notifications');
    assert.equal(rows[0].kind, 'lesson_published');
    assert.equal(rows[0].channel, 'webpush');
    assert.equal(rows[0].payload.title, 'Новый урок');
  });
});
