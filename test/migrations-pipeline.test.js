// Проверка таблиц конвейера. Здесь важны две вещи: срок жизни файла
// обязателен (буфер обязан чиститься сам) и удаление урока не оставляет
// осиротевших файлов и сегментов.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

async function makeLesson(pool) {
  const { rows } = await pool.query(
    `INSERT INTO lessons (slug, title) VALUES ('urok', 'Урок') RETURNING id`
  );
  return rows[0].id;
}

test('пустой срок жизни допустим — это файл витрины', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const id = await makeLesson(pool);
    // Раньше срок был обязателен: файл без него однажды переполнил бы диск.
    // Но обложка живёт на витрине, и удалять её по времени значит ломать
    // карточку урока — поэтому пустой срок теперь означает «храним, пока
    // используется». Рабочим файлам срок по-прежнему ставит registerAsset, и
    // это проверяет media-service.test.js.
    await pool.query(
      `INSERT INTO assets (lesson_id, kind, path, bytes) VALUES ($1, 'cover', '/a', 1)`,
      [id]
    );
    const { rows } = await pool.query(`SELECT expires_at FROM assets WHERE path = '/a'`);
    assert.equal(rows[0].expires_at, null);
  });
});

test('вид файла ограничен списком', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const id = await makeLesson(pool);
    await assert.rejects(
      pool.query(
        `INSERT INTO assets (lesson_id, kind, path, bytes, expires_at)
         VALUES ($1, 'nechto', '/a', 1, now())`,
        [id]
      ),
      /check constraint|нарушает/i
    );
  });
});

test('удаление урока уносит файлы, транскрипт и сегменты', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const id = await makeLesson(pool);
    await pool.query(
      `INSERT INTO assets (lesson_id, kind, path, bytes, expires_at)
       VALUES ($1, 'source', 'a', 1, now() + interval '1 day')`,
      [id]
    );
    await pool.query(`INSERT INTO transcripts (lesson_id, text) VALUES ($1, 'текст')`, [id]);
    await pool.query(
      `INSERT INTO transcript_segments (lesson_id, started_ms, ended_ms, text)
       VALUES ($1, 0, 1000, 'слово')`,
      [id]
    );
    await pool.query('DELETE FROM lessons WHERE id = $1', [id]);
    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM assets) + (SELECT count(*) FROM transcripts)
            + (SELECT count(*) FROM transcript_segments) AS n`
    );
    assert.equal(Number(rows[0].n), 0);
  });
});

test('транскрипт у урока один', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const id = await makeLesson(pool);
    await pool.query(`INSERT INTO transcripts (lesson_id, text) VALUES ($1, 'раз')`, [id]);
    // Вторая расшифровка заменяет первую, а не копится рядом: два текста
    // одного урока сделали бы поиск бессмысленным.
    await assert.rejects(
      pool.query(`INSERT INTO transcripts (lesson_id, text) VALUES ($1, 'два')`, [id]),
      /duplicate key|unique/i
    );
  });
});

test('отрезок не может кончиться раньше, чем начался', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const id = await makeLesson(pool);
    await assert.rejects(
      pool.query(
        `INSERT INTO transcript_segments (lesson_id, started_ms, ended_ms, text)
         VALUES ($1, 5000, 1000, 'задом наперёд')`,
        [id]
      ),
      /check constraint|нарушает/i
    );
  });
});

test('состояние конвейера ограничено списком', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const id = await makeLesson(pool);
    await assert.rejects(
      pool.query(`UPDATE lessons SET pipeline_state = 'letit' WHERE id = $1`, [id]),
      /check constraint|нарушает/i
    );
  });
});
