// Проверка слоя уведомлений. Главное правило заказчика: один человек получает
// ОДНО уведомление, а не три по трём каналам, и повтор задачи его не задваивает.
import test from 'node:test';
import assert from 'node:assert/strict';
import { notify } from '../src/services/notify/index.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

/** Каналы-заглушки: запоминают, что и куда ушло. Сеть в тесте не трогаем. */
function каналы() {
  const отправлено = [];
  return {
    отправлено,
    channels: {
      webpush: async (подписки, message) =>
        отправлено.push({ канал: 'webpush', адрес: подписки[0].endpoint, message }),
      telegram: async (чат, message) => отправлено.push({ канал: 'telegram', чат, message })
    }
  };
}

async function человекСПушем(pool, имя = 'Пётр') {
  const { rows } = await pool.query(`INSERT INTO users (display_name) VALUES ($1) RETURNING id`, [
    имя
  ]);
  const id = Number(rows[0].id);
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, 'k', 's')`,
    [id, `https://push.example/${id}`]
  );
  return id;
}

async function человекСТелеграмом(pool) {
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

const событие = { kind: 'lesson_published', title: 'Новый урок', body: 'Docker', url: '/' };

test('есть подписка на пуш — уходит пушем', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const userId = await человекСПушем(pool);
    const { channels, отправлено } = каналы();
    const итог = await notify(pool, { ...событие, userId, dedupKey: 'а' }, channels);
    assert.equal(итог.channel, 'webpush');
    assert.equal(отправлено.length, 1);
  });
});

test('пуша нет, телеграм есть — уходит ботом', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const userId = await человекСТелеграмом(pool);
    const { channels, отправлено } = каналы();
    const итог = await notify(pool, { ...событие, userId, dedupKey: 'б' }, channels);
    assert.equal(итог.channel, 'telegram');
    assert.equal(отправлено[0].чат, '777');
  });
});

test('человек получает одно уведомление, а не три', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const userId = await человекСПушем(pool);
    await pool.query(
      `INSERT INTO identities (user_id, provider, external_id) VALUES ($1, 'tg_widget', '888')`,
      [userId]
    );
    const { channels, отправлено } = каналы();
    await notify(pool, { ...событие, userId, dedupKey: 'в' }, channels);
    assert.equal(отправлено.length, 1);
    assert.equal(отправлено[0].канал, 'webpush');
  });
});

test('повтор с тем же ключом ничего не отправляет', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const userId = await человекСПушем(pool);
    const { channels, отправлено } = каналы();
    await notify(pool, { ...событие, userId, dedupKey: 'г' }, channels);
    const второй = await notify(pool, { ...событие, userId, dedupKey: 'г' }, channels);
    assert.equal(отправлено.length, 1);
    assert.equal(второй.reason, 'уже отправляли');
  });
});

test('связаться нечем — молчим и записываем это', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(
      `INSERT INTO users (display_name) VALUES ('Молчун') RETURNING id`
    );
    const { channels, отправлено } = каналы();
    const итог = await notify(
      pool,
      { ...событие, userId: Number(rows[0].id), dedupKey: 'д' },
      channels
    );
    assert.equal(итог.channel, null);
    assert.equal(отправлено.length, 0);
    const { rows: журнал } = await pool.query('SELECT channel FROM notifications');
    assert.equal(журнал[0].channel, null);
  });
});

test('упавшая отправка не оставляет ложной записи в журнале', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const userId = await человекСПушем(pool);
    const падающие = {
      webpush: async () => {
        throw new Error('канал недоступен');
      }
    };
    await assert.rejects(
      notify(pool, { ...событие, userId, dedupKey: 'е' }, падающие),
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
    const userId = await человекСПушем(pool);
    const { channels } = каналы();
    await notify(pool, { ...событие, userId, dedupKey: 'ж' }, channels);
    const { rows } = await pool.query('SELECT kind, channel, payload FROM notifications');
    assert.equal(rows[0].kind, 'lesson_published');
    assert.equal(rows[0].channel, 'webpush');
    assert.equal(rows[0].payload.title, 'Новый урок');
  });
});
