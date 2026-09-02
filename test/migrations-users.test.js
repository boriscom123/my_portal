// Проверка ограничений базы, на которые опирается вход. Их нельзя проверить
// на заглушке: это работа самого postgres, и именно она не даёт одному
// человеку расползтись на два аккаунта.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

test('одна и та же привязка не заводится дважды', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(
      `INSERT INTO users (display_name) VALUES ('Пётр') RETURNING id`
    );
    const userId = rows[0].id;
    await pool.query(
      `INSERT INTO identities (user_id, provider, external_id) VALUES ($1, 'google', '42')`,
      [userId]
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO identities (user_id, provider, external_id) VALUES ($1, 'google', '42')`,
        [userId]
      ),
      /duplicate key|unique/i
    );
  });
});

test('один человек держит привязки разных провайдеров', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(
      `INSERT INTO users (display_name) VALUES ('Пётр') RETURNING id`
    );
    const userId = rows[0].id;
    await pool.query(
      `INSERT INTO identities (user_id, provider, external_id)
       VALUES ($1, 'google', '42'), ($1, 'tg_widget', '7')`,
      [userId]
    );
    const { rows: found } = await pool.query(
      'SELECT provider FROM identities WHERE user_id = $1 ORDER BY provider',
      [userId]
    );
    assert.deepEqual(
      found.map((r) => r.provider),
      ['google', 'tg_widget']
    );
  });
});

test('неизвестный провайдер не принимается', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(
      `INSERT INTO users (display_name) VALUES ('Пётр') RETURNING id`
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO identities (user_id, provider, external_id) VALUES ($1, 'вконтактик', '1')`,
        [rows[0].id]
      ),
      /check constraint|нарушает/i
    );
  });
});

test('роль ограничена двумя значениями', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await assert.rejects(
      pool.query(`INSERT INTO users (display_name, role) VALUES ('Пётр', 'бог')`),
      /check constraint|нарушает/i
    );
  });
});
