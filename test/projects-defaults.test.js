// Проект необязателен: материал заводится без проекта, если его не выбрали, и
// с выбранным, если выбрали. Правка существующего проекты не трогает — ими
// распоряжается блок проектов.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLesson } from '../src/services/lesson-admin.js';
import { saveLesson, getLessonBySlug } from '../src/services/lessons.js';
import { saveNews, getNewsBySlug } from '../src/services/news.js';
import { saveSeries, getSeriesBySlug } from '../src/services/series.js';
import { saveProject, setProjects } from '../src/services/projects.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const drafts = { includeDrafts: true };

test('урок, новость и серия без выбора заводятся без проекта', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await createLesson(pool, {});
    assert.equal((await getLessonBySlug(pool, lesson.slug, drafts)).projects.main, null);

    const item = await saveNews(pool, { title: 'Новость' });
    assert.equal((await getNewsBySlug(pool, item.slug)).projects.main, null);

    const series = await saveSeries(pool, { title: 'Серия' });
    assert.equal((await getSeriesBySlug(pool, series.slug, drafts)).projects.main, null);
  });
});

test('выбранный проект ставится при заведении', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const idle = await saveProject(pool, { title: 'IDLE игра' });
    const lesson = await createLesson(pool, { projectId: idle.id });
    assert.equal((await getLessonBySlug(pool, lesson.slug, drafts)).projects.main.slug, 'idle-igra');
    // Следующий без выбора не наследует чужой проект: подстановки нет.
    const next = await saveLesson(pool, { slug: 'dalshe', title: 'Дальше' });
    assert.equal((await getLessonBySlug(pool, next.slug, drafts)).projects.main, null);
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

test('проектов нет вовсе — урок всё равно заводится', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await pool.query('DELETE FROM projects');
    const lesson = await createLesson(pool, {});
    assert.equal((await getLessonBySlug(pool, lesson.slug, drafts)).projects.main, null);
  });
});
