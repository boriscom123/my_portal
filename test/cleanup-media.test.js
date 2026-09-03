// Автоудаление буфера — то, чем портал отличается от видеоархива. Спека прямо
// запрещает хранить архив: файлы живут срок и уходят, карточка урока остаётся.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeCleanupMedia } from '../src/jobs/cleanup-media.js';
import { scheduleCleanup } from '../src/queue.js';
import { saveLesson } from '../src/services/lessons.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

async function makeConfig() {
  return { media: { dir: await mkdtemp(path.join(tmpdir(), 'portal-clean-')), ttlHours: 168 } };
}

/** Кладёт файл в буфер и записывает его в учёт с заданным сроком. */
async function seedAsset(pool, config, { lessonId, name, kind = 'source', expires }) {
  await mkdir(path.join(config.media.dir, 'urok'), { recursive: true });
  const file = path.join(config.media.dir, `urok/${name}`);
  await writeFile(file, 'данные');
  const { rows } = await pool.query(
    `INSERT INTO assets (lesson_id, kind, path, bytes, expires_at)
     VALUES ($1, $2, $3, 12, now() + $4::interval) RETURNING id`,
    [lessonId, kind, `urok/${name}`, expires]
  );
  return { file, id: Number(rows[0].id) };
}

test('просроченный файл исчезает, карточка урока остаётся', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    const { file } = await seedAsset(pool, config, {
      lessonId: lesson.id,
      name: 'source.mp4',
      expires: '-1 hour'
    });

    const result = await makeCleanupMedia(config, pool)();
    assert.equal(result.removed, 1);
    await assert.rejects(access(file));
    const { rows } = await pool.query('SELECT count(*)::int n FROM lessons');
    assert.equal(rows[0].n, 1, 'урок должен пережить уборку своих файлов');
  });
});

test('живой файл не трогаем', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    const { file } = await seedAsset(pool, config, {
      lessonId: lesson.id,
      name: 'live.mp4',
      expires: '1 day'
    });
    const result = await makeCleanupMedia(config, pool)();
    assert.equal(result.removed, 0);
    await access(file);
  });
});

test('пропавший файл не мешает уборке', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    // Файла на диске нет — например, том пересоздали. Запись в учёте всё
    // равно должна уйти, иначе уборка будет спотыкаться о неё вечно.
    await pool.query(
      `INSERT INTO assets (lesson_id, kind, path, bytes, expires_at)
       VALUES ($1, 'source', 'urok/net.mp4', 6, now() - interval '1 hour')`,
      [lesson.id]
    );
    const result = await makeCleanupMedia(config, pool)();
    assert.equal(result.removed, 1);
    const { rows } = await pool.query('SELECT count(*)::int n FROM assets');
    assert.equal(rows[0].n, 0);
  });
});

test('вместе с обложкой из карточки уходит ссылка на неё', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    const { id } = await seedAsset(pool, config, {
      lessonId: lesson.id,
      name: 'cover.jpg',
      kind: 'cover',
      expires: '-1 hour'
    });
    await pool.query('UPDATE lessons SET cover_url = $1 WHERE id = $2', [
      `/media/asset/${id}`,
      lesson.id
    ]);

    await makeCleanupMedia(config, pool)();
    // Иначе карточка урока показывала бы битую картинку, а превью ссылки в
    // мессенджере пришло бы без изображения.
    const { rows } = await pool.query('SELECT cover_url FROM lessons WHERE id = $1', [lesson.id]);
    assert.equal(rows[0].cover_url, null);
  });
});

test('уборка ставится расписанием, а не одноразовой задачей', async () => {
  // В BullMQ 6 параметр repeat у add() убран: вызов с ним не падает, а молча
  // выполняет задачу один раз. На живом сервере это выглядело как работающая
  // уборка — «Задача cleanupMedia выполнена» в журнале, — но расписания не
  // возникало, и второй раз она бы не запустилась никогда.
  const calls = [];
  const queue = {
    upsertJobScheduler: async (...args) => calls.push(args),
    add: async () => assert.fail('уборка должна ставиться расписанием, а не add()')
  };
  await scheduleCleanup(queue, { everyMs: 1000 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'cleanup-media');
  assert.deepEqual(calls[0][1], { every: 1000 });
  assert.equal(calls[0][2].name, 'cleanupMedia');
});
