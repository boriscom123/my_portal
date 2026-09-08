// Публикация привязана к файлу, а не только к уроку: на площадку коротких видео
// поедут все три вертикальных ролика урока, и прежнее ограничение «одна строка
// на площадку и урок» вторую вставить не давало.
//
// Состояние ready — «ролик на канале, но приватный». Без него пришлось бы либо
// врать словом published, либо держать урок в uploading после конца загрузки.
import test from 'node:test';
import assert from 'node:assert/strict';
import { saveLesson } from '../src/services/lessons.js';
import { registerAsset } from '../src/services/media.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = { media: { dir: '/tmp', ttlHours: 168 } };

test('на одну площадку помещается несколько файлов урока', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    const first = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'clip',
      relativePath: 'lesson-1/clip-1.mp4',
      bytes: 10
    });
    const second = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'clip',
      relativePath: 'lesson-1/clip-2.mp4',
      bytes: 10
    });

    await pool.query(
      `INSERT INTO publications (lesson_id, platform, asset_id) VALUES ($1, 'youtube', $2)`,
      [lesson.id, first.id]
    );
    await pool.query(
      `INSERT INTO publications (lesson_id, platform, asset_id) VALUES ($1, 'youtube', $2)`,
      [lesson.id, second.id]
    );

    const { rows } = await pool.query(
      'SELECT count(*)::int AS count FROM publications WHERE lesson_id = $1',
      [lesson.id]
    );
    assert.equal(rows[0].count, 2);
  });
});

test('один и тот же файл на площадку дважды не встаёт', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    const asset = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'source',
      relativePath: 'lesson-1/urok.mp4',
      bytes: 10
    });
    await pool.query(
      `INSERT INTO publications (lesson_id, platform, asset_id) VALUES ($1, 'youtube', $2)`,
      [lesson.id, asset.id]
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO publications (lesson_id, platform, asset_id) VALUES ($1, 'youtube', $2)`,
        [lesson.id, asset.id]
      ),
      /duplicate key/
    );
  });
});

test('без файла публикация тоже одна на площадку', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await pool.query(
      `INSERT INTO publications (lesson_id, platform) VALUES ($1, 'youtube')`,
      [lesson.id]
    );
    // Без NULLS NOT DISTINCT postgres считает две строки с пустым файлом
    // разными, и защита от двойной публикации молча перестаёт работать.
    await assert.rejects(
      pool.query(`INSERT INTO publications (lesson_id, platform) VALUES ($1, 'youtube')`, [
        lesson.id
      ]),
      /duplicate key/
    );
  });
});

test('состояние ready допустимо', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await pool.query(
      `INSERT INTO publications (lesson_id, platform, state) VALUES ($1, 'youtube', 'ready')`,
      [lesson.id]
    );
    const { rows } = await pool.query('SELECT state FROM publications WHERE lesson_id = $1', [
      lesson.id
    ]);
    assert.equal(rows[0].state, 'ready');
  });
});
