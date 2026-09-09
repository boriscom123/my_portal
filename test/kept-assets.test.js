// Файлы витрины не исчезают по сроку.
//
// Обложке отводилось семьдесят суток, после чего уборщик её удалял, а карточка
// урока оставалась без картинки. Витрина разрушала себя сама через два с
// половиной месяца после выхода первого урока — считать это задумкой нельзя.
import test from 'node:test';
import assert from 'node:assert/strict';
import { saveLesson } from '../src/services/lessons.js';
import { registerAsset, listExpired } from '../src/services/media.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = { media: { dir: '/tmp', ttlHours: 168 } };

test('у обложки срока нет вовсе', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    const cover = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'cover',
      relativePath: 'lesson-1/cover.jpg',
      bytes: 100
    });
    assert.equal(cover.expiresAt, null);
  });
});

test('рабочие файлы срок сохраняют', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    const source = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'source',
      relativePath: 'lesson-1/urok.mp4',
      bytes: 100
    });
    // Гигабайты исходников хранить вечно незачем: зритель их не видит.
    assert.ok(source.expiresAt instanceof Date);
  });
});

test('уборка не забирает файлы без срока', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    const cover = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'cover',
      relativePath: 'lesson-1/cover.jpg',
      bytes: 100
    });
    // Просроченный рабочий файл рядом — чтобы видеть, что уборка вообще
    // работает, а не молчит по другой причине.
    await pool.query(
      `INSERT INTO assets (lesson_id, kind, path, bytes, expires_at)
       VALUES ($1, 'source', 'lesson-1/staryi.mp4', 10, now() - interval '1 day')`,
      [lesson.id]
    );

    const expired = await listExpired(pool);
    assert.equal(expired.length, 1);
    assert.equal(expired[0].kind, 'source');
    assert.ok(!expired.some((asset) => asset.id === cover.id), 'обложку забирать нельзя');
  });
});
