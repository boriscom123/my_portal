// Проекты в базе: основной проект у материала один, удаление проекта уносит
// только связи. Эти правила держит сама база — проверяем на настоящем postgres.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const SOLO = `(SELECT id FROM projects WHERE slug = 'solo-ai-journey')`;

test('после миграций проект «Solo AI Journey» есть', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(
      `SELECT title, description FROM projects WHERE slug = 'solo-ai-journey'`
    );
    assert.equal(rows[0]?.title, 'Solo AI Journey');
    assert.equal(rows[0]?.description, 'Портал видеоуроков: от идеи до продукта.');
  });
});

test('основной проект у урока не больше одного', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const {
      rows: [lesson]
    } = await pool.query(`INSERT INTO lessons (slug, title) VALUES ('urok', 'Урок') RETURNING id`);
    const {
      rows: [idle]
    } = await pool.query(
      `INSERT INTO projects (slug, title) VALUES ('idle-igra', 'IDLE игра') RETURNING id`
    );
    await pool.query(
      `INSERT INTO lesson_projects (lesson_id, project_id, is_main) VALUES ($1, ${SOLO}, true)`,
      [lesson.id]
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO lesson_projects (lesson_id, project_id, is_main) VALUES ($1, $2, true)`,
        [lesson.id, idle.id]
      ),
      /duplicate key|unique/i
    );
    // Связанных — сколько угодно.
    await pool.query(
      `INSERT INTO lesson_projects (lesson_id, project_id, is_main) VALUES ($1, $2, false)`,
      [lesson.id, idle.id]
    );
  });
});

test('удаление проекта уносит связи, а материалы остаются', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const {
      rows: [idle]
    } = await pool.query(
      `INSERT INTO projects (slug, title) VALUES ('idle-igra', 'IDLE игра') RETURNING id`
    );
    const {
      rows: [lesson]
    } = await pool.query(`INSERT INTO lessons (slug, title) VALUES ('urok', 'Урок') RETURNING id`);
    const {
      rows: [item]
    } = await pool.query(`INSERT INTO news (slug, title) VALUES ('novost', 'Новость') RETURNING id`);
    const {
      rows: [series]
    } = await pool.query(`INSERT INTO series (slug, title) VALUES ('seriya', 'Серия') RETURNING id`);
    await pool.query(`INSERT INTO lesson_projects VALUES ($1, $2, true)`, [lesson.id, idle.id]);
    await pool.query(`INSERT INTO news_projects VALUES ($1, $2, true)`, [item.id, idle.id]);
    await pool.query(`INSERT INTO series_projects VALUES ($1, $2, true)`, [series.id, idle.id]);

    await pool.query('DELETE FROM projects WHERE id = $1', [idle.id]);

    const count = async (sql) => Number((await pool.query(sql)).rows[0].count);
    assert.equal(await count('SELECT count(*) FROM lesson_projects'), 0);
    assert.equal(await count('SELECT count(*) FROM news_projects'), 0);
    assert.equal(await count('SELECT count(*) FROM series_projects'), 0);
    assert.equal(await count('SELECT count(*) FROM lessons'), 1);
    assert.equal(await count('SELECT count(*) FROM news'), 1);
    assert.equal(await count('SELECT count(*) FROM series'), 1);
  });
});
