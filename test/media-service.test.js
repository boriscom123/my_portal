// Проверка учёта буфера. Срок жизни считается здесь, и ошибка в нём означает
// либо переполненный диск, либо файлы, исчезнувшие раньше, чем автор успел
// ими воспользоваться.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mediaPath,
  registerAsset,
  listExpired,
  forgetAsset,
  assetById
} from '../src/services/media.js';
import { saveLesson } from '../src/services/lessons.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = { media: { dir: '/app/media', ttlHours: 168 } };

test('путь собирается от каталога буфера', () => {
  assert.equal(mediaPath(config, 'lesson-1/source.mp4'), '/app/media/lesson-1/source.mp4');
});

test('выход за пределы буфера не допускается', () => {
  // Имя файла приходит из запроса: без этой проверки «../../» увело бы запись
  // в любое место диска.
  assert.throws(() => mediaPath(config, '../../etc/passwd'), /за пределы/i);
  assert.throws(() => mediaPath(config, '/etc/passwd'), /за пределы/i);
});

test('лёгкие файлы живут дольше тяжёлых', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'u', title: 'Урок' });
    const source = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'source',
      relativePath: 'u/source.mp4',
      bytes: 1_000_000_000
    });
    const cover = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'cover',
      relativePath: 'u/cover.jpg',
      bytes: 100_000
    });
    // Исходник весит гигабайты и уходит первым; обложка лёгкая и нужна
    // карточке урока долго после публикации.
    assert.ok(cover.expiresAt > source.expiresAt);
  });
});

test('просроченные находятся, живые — нет', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'u', title: 'Урок' });
    const live = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'source',
      relativePath: 'u/live.mp4',
      bytes: 1
    });
    await pool.query(
      `INSERT INTO assets (lesson_id, kind, path, bytes, expires_at)
       VALUES ($1, 'source', 'u/old.mp4', 1, now() - interval '1 hour')`,
      [lesson.id]
    );
    const expired = await listExpired(pool);
    assert.equal(expired.length, 1);
    assert.equal(expired[0].path, 'u/old.mp4');
    assert.ok(await assetById(pool, live.id));
  });
});

test('забытый файл исчезает из учёта', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'u', title: 'Урок' });
    const asset = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'audio',
      relativePath: 'u/audio.ogg',
      bytes: 1
    });
    await forgetAsset(pool, asset.id);
    assert.equal(await assetById(pool, asset.id), null);
  });
});

test('повторная запись того же файла обновляет, а не двоит', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'u', title: 'Урок' });
    const first = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'source',
      relativePath: 'u/source.mp4',
      bytes: 100
    });
    const second = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'source',
      relativePath: 'u/source.mp4',
      bytes: 200
    });
    // Повтор обработки перезаписывает файл на диске: запись должна обновиться,
    // иначе уборка удалит один файл дважды, а буфер посчитается вдвое больше.
    assert.equal(first.id, second.id);
    const { rows } = await pool.query('SELECT count(*)::int AS n, max(bytes) AS bytes FROM assets');
    assert.equal(rows[0].n, 1);
    assert.equal(Number(rows[0].bytes), 200);
  });
});
