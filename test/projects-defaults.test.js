// Материал заводится с основным проектом: названным или по умолчанию. Правка
// существующего проекты не трогает — ими распоряжается блок проектов.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLesson } from '../src/services/lesson-admin.js';
import { saveLesson, getLessonBySlug } from '../src/services/lessons.js';
import { saveNews, getNewsBySlug } from '../src/services/news.js';
import { saveSeries, getSeriesBySlug } from '../src/services/series.js';
import { saveProject, setProjects } from '../src/services/projects.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const drafts = { includeDrafts: true };

test('урок, новость и серия заводятся с проектом по умолчанию', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await createLesson(pool, {});
    assert.equal(
      (await getLessonBySlug(pool, lesson.slug, drafts)).projects.main.slug,
      'solo-ai-journey'
    );

    const item = await saveNews(pool, { title: 'Новость' });
    assert.equal((await getNewsBySlug(pool, item.slug)).projects.main.slug, 'solo-ai-journey');

    const series = await saveSeries(pool, { title: 'Серия' });
    assert.equal(
      (await getSeriesBySlug(pool, series.slug, drafts)).projects.main.slug,
      'solo-ai-journey'
    );
  });
});

test('названный проект сильнее умолчания', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const idle = await saveProject(pool, { title: 'IDLE игра' });
    const lesson = await createLesson(pool, { projectId: idle.id });
    assert.equal((await getLessonBySlug(pool, lesson.slug, drafts)).projects.main.slug, 'idle-igra');
    // Следующий материал без выбора берёт проект последнего заведённого.
    const next = await saveLesson(pool, { slug: 'dalshe', title: 'Дальше' });
    assert.equal((await getLessonBySlug(pool, next.slug, drafts)).projects.main.slug, 'idle-igra');
  });
});

test('правка урока проекты не трогает', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const idle = await saveProject(pool, { title: 'IDLE игра' });
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await setProjects(pool, 'lesson', lesson.id, { mainId: idle.id });
    await saveLesson(pool, { slug: 'urok', title: 'Урок, правка' });
    assert.equal((await getLessonBySlug(pool, 'urok', drafts)).projects.main.slug, 'idle-igra');
  });
});

test('проектов нет — урок не заводится', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await pool.query('DELETE FROM projects');
    await assert.rejects(createLesson(pool, {}), /Сначала заведите проект/);
    const { rows } = await pool.query('SELECT count(*) FROM lessons');
    assert.equal(Number(rows[0].count), 0, 'урок без проекта в базе не остался');
  });
});

test('материал без основного проекта правится', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await pool.query('DELETE FROM lesson_projects WHERE lesson_id = $1', [lesson.id]);
    const edited = await saveLesson(pool, { slug: 'urok', title: 'Заголовок поправлен' });
    assert.equal(edited.title, 'Заголовок поправлен');
    assert.equal((await getLessonBySlug(pool, 'urok', drafts)).projects.main, null);
  });
});
