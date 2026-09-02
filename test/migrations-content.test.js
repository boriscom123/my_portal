// Проверка ограничений витрины: slug уникален (по нему строится адрес),
// черновик не может притвориться опубликованным без даты, один урок не
// публикуется дважды на одну площадку.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

test('slug урока уникален', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await pool.query(`INSERT INTO lessons (slug, title) VALUES ('docker-1', 'Docker, часть 1')`);
    await assert.rejects(
      pool.query(`INSERT INTO lessons (slug, title) VALUES ('docker-1', 'Другой')`),
      /duplicate key|unique/i
    );
  });
});

test('опубликованный урок обязан иметь дату выхода', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await assert.rejects(
      pool.query(
        `INSERT INTO lessons (slug, title, status) VALUES ('docker-2', 'Docker 2', 'published')`
      ),
      /check constraint|нарушает/i
    );
  });
});

test('одна площадка на урок — одна строка публикации', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(
      `INSERT INTO lessons (slug, title) VALUES ('docker-3', 'Docker 3') RETURNING id`
    );
    await pool.query(`INSERT INTO publications (lesson_id, platform) VALUES ($1, 'youtube')`, [
      rows[0].id
    ]);
    await assert.rejects(
      pool.query(`INSERT INTO publications (lesson_id, platform) VALUES ($1, 'youtube')`, [
        rows[0].id
      ]),
      /duplicate key|unique/i
    );
  });
});

test('удаление урока уносит его теги и публикации', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(
      `INSERT INTO lessons (slug, title) VALUES ('docker-4', 'Docker 4') RETURNING id`
    );
    await pool.query(`INSERT INTO publications (lesson_id, platform) VALUES ($1, 'vk')`, [
      rows[0].id
    ]);
    await pool.query(`INSERT INTO tags (slug, title) VALUES ('docker', 'docker')`);
    await pool.query(
      `INSERT INTO lesson_tags (lesson_id, tag_id) SELECT $1, id FROM tags WHERE slug = 'docker'`,
      [rows[0].id]
    );
    await pool.query('DELETE FROM lessons WHERE id = $1', [rows[0].id]);
    const пусто = await pool.query(
      'SELECT (SELECT count(*) FROM publications) + (SELECT count(*) FROM lesson_tags) AS n'
    );
    assert.equal(Number(пусто.rows[0].n), 0);
  });
});

test('неизвестная площадка не принимается', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(
      `INSERT INTO lessons (slug, title) VALUES ('docker-5', 'Docker 5') RETURNING id`
    );
    await assert.rejects(
      pool.query(`INSERT INTO publications (lesson_id, platform) VALUES ($1, 'одноклассники')`, [
        rows[0].id
      ]),
      /check constraint|нарушает/i
    );
  });
});
