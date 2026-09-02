// Проверка витрины. Главное здесь — черновик не виден никому, кроме автора:
// это и есть требование «наружу ничего не уходит, пока он не нажал».
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listLessons,
  getLessonBySlug,
  saveLesson,
  setLessonTags,
  listNews
} from '../src/services/lessons.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

async function seed(pool) {
  await saveLesson(pool, {
    slug: 'docker-1',
    title: 'Docker, часть 1',
    description: 'Контейнеры с нуля',
    status: 'published',
    publishedAt: new Date('2026-08-01T10:00:00Z')
  });
  await saveLesson(pool, { slug: 'chernovik', title: 'Ещё не готов', status: 'draft' });
}

test('в ленту попадают только опубликованные', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    const list = await listLessons(pool, {});
    assert.deepEqual(
      list.map((l) => l.slug),
      ['docker-1']
    );
  });
});

test('автор видит черновики отдельным флагом', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    assert.equal((await listLessons(pool, { includeDrafts: true })).length, 2);
  });
});

test('черновик не отдаётся по прямой ссылке', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    assert.equal(await getLessonBySlug(pool, 'chernovik', {}), null);
    assert.ok(await getLessonBySlug(pool, 'chernovik', { includeDrafts: true }));
  });
});

test('карточка несёт ссылки на площадки', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    const { rows } = await pool.query(`SELECT id FROM lessons WHERE slug = 'docker-1'`);
    await pool.query(
      `INSERT INTO publications (lesson_id, platform, url, state)
       VALUES ($1, 'youtube', 'https://youtu.be/x', 'published')`,
      [rows[0].id]
    );
    const lesson = await getLessonBySlug(pool, 'docker-1', {});
    assert.deepEqual(lesson.publications, [
      { platform: 'youtube', url: 'https://youtu.be/x', state: 'published' }
    ]);
  });
});

test('фильтр по тегу отбирает уроки', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    const { rows } = await pool.query(`SELECT id FROM lessons WHERE slug = 'docker-1'`);
    await setLessonTags(pool, Number(rows[0].id), ['docker']);
    assert.equal((await listLessons(pool, { tag: 'docker' })).length, 1);
    assert.equal((await listLessons(pool, { tag: 'kubernetes' })).length, 0);
    const lesson = await getLessonBySlug(pool, 'docker-1', {});
    assert.deepEqual(lesson.tags, ['docker']);
  });
});

test('повторное сохранение того же slug обновляет, а не двоит', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    await saveLesson(pool, { slug: 'docker-1', title: 'Docker, часть 1 (обновлён)' });
    const lesson = await getLessonBySlug(pool, 'docker-1', {});
    assert.equal(lesson.title, 'Docker, часть 1 (обновлён)');
    // Прежние поля не затираются пустыми: правка заголовка не должна снимать
    // урок с публикации и стирать описание.
    assert.equal(lesson.description, 'Контейнеры с нуля');
    assert.equal(lesson.status, 'published');
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM lessons');
    assert.equal(rows[0].n, 2);
  });
});

test('замена тегов не копит старые', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    const { rows } = await pool.query(`SELECT id FROM lessons WHERE slug = 'docker-1'`);
    await setLessonTags(pool, Number(rows[0].id), ['docker', 'vps']);
    await setLessonTags(pool, Number(rows[0].id), ['docker']);
    const lesson = await getLessonBySlug(pool, 'docker-1', {});
    assert.deepEqual(lesson.tags, ['docker']);
  });
});

test('новости отдаются свежими сверху', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await pool.query(
      `INSERT INTO news (slug, title, body, published_at) VALUES
       ('staraya', 'Старая', 'текст', '2026-07-01'),
       ('svezhaya', 'Свежая', 'текст', '2026-08-20')`
    );
    const news = await listNews(pool, {});
    assert.deepEqual(
      news.map((n) => n.slug),
      ['svezhaya', 'staraya']
    );
  });
});
