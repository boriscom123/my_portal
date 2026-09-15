// Служба проектов: основной и связанные, серия задаёт проект урокам,
// удаление проекта уносит только связи, проект необязателен.
import test from 'node:test';
import assert from 'node:assert/strict';
import { saveLesson } from '../src/services/lessons.js';
import { saveNews } from '../src/services/news.js';
import { saveSeries, setLessonSeries } from '../src/services/series.js';
import {
  ProjectError,
  listProjects,
  getProjectBySlug,
  saveProject,
  deleteProject,
  projectsFor,
  setProjects,
  resolveProjectId,
  projectIdsBySlugs
} from '../src/services/projects.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

async function three(pool) {
  const solo = await getProjectBySlug(pool, 'solo-ai-journey');
  const idle = await saveProject(pool, { title: 'IDLE игра' });
  const notifier = await saveProject(pool, { title: 'Уведомлятор' });
  return { solo, idle, notifier };
}

const isProjectError = (code) => (error) => error instanceof ProjectError && error.code === code;

test('проект получает адрес из названия, повтор названия — свой адрес', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const first = await saveProject(pool, { title: 'IDLE игра', description: 'Игра' });
    const second = await saveProject(pool, { title: 'IDLE игра' });
    assert.equal(first.slug, 'idle-igra');
    assert.notEqual(second.slug, first.slug);

    // Правка не меняет адрес: по нему уже ходят ссылки с фильтром.
    const edited = await saveProject(pool, {
      slug: first.slug,
      title: 'Idle Clicker',
      description: 'Новое'
    });
    assert.equal(edited.slug, 'idle-igra');
    assert.equal(edited.title, 'Idle Clicker');

    await assert.rejects(saveProject(pool, { title: '   ' }), isProjectError('empty_title'));
  });
});

test('основной и связанные: основной среди связанных не бывает', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { solo, idle, notifier } = await three(pool);
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });

    await setProjects(pool, 'lesson', lesson.id, {
      mainId: idle.id,
      relatedIds: [idle.id, notifier.id, solo.id]
    });
    const links = (await projectsFor(pool, 'lesson', [lesson.id])).get(lesson.id);
    assert.equal(links.main.slug, 'idle-igra');
    assert.deepEqual(links.related.map((item) => item.id).sort(), [solo.id, notifier.id].sort());

    // Проект необязателен: основной снимается, связанные остаются и без него —
    // по ним урок всё равно попадает в фильтр.
    await setProjects(pool, 'lesson', lesson.id, { mainId: null, relatedIds: [notifier.id] });
    const cleared = (await projectsFor(pool, 'lesson', [lesson.id])).get(lesson.id);
    assert.equal(cleared.main, null);
    assert.deepEqual(cleared.related.map((item) => item.id), [notifier.id]);
  });
});

test('проект серии переходит на её уроки, совпавший связанный убирается', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { solo, idle, notifier } = await three(pool);
    const series = await saveSeries(pool, { title: 'Игра с нуля' });
    const first = await saveLesson(pool, { slug: 'pervyy', title: 'Первый' });
    const second = await saveLesson(pool, { slug: 'vtoroy', title: 'Второй' });
    await setLessonSeries(pool, first.id, series.id);
    await setLessonSeries(pool, second.id, series.id);
    await setProjects(pool, 'lesson', first.id, { mainId: solo.id, relatedIds: [notifier.id] });

    await setProjects(pool, 'series', series.id, { mainId: notifier.id, relatedIds: [idle.id] });

    const links = await projectsFor(pool, 'lesson', [first.id, second.id]);
    assert.equal(links.get(first.id).main.id, notifier.id);
    assert.equal(links.get(second.id).main.id, notifier.id);
    assert.deepEqual(links.get(first.id).related, [], 'Уведомлятор стал основным — из связанных ушёл');
  });
});

test('у урока в серии основной проект задаёт серия', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { solo, idle } = await three(pool);
    const series = await saveSeries(pool, { title: 'Игра с нуля' });
    await setProjects(pool, 'series', series.id, { mainId: idle.id });
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await setLessonSeries(pool, lesson.id, series.id);
    // До задачи 4 урок сам проект серии не получает — ставим его явно.
    await setProjects(pool, 'lesson', lesson.id, { mainId: idle.id });

    await assert.rejects(
      setProjects(pool, 'lesson', lesson.id, { mainId: solo.id }),
      isProjectError('series_locked')
    );
    // Тот же основной и свои связанные — можно.
    await setProjects(pool, 'lesson', lesson.id, { mainId: idle.id, relatedIds: [solo.id] });
  });
});

test('удаление проекта называет осиротевшие материалы и уносит только связи', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { solo, idle } = await three(pool);
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    const item = await saveNews(pool, { title: 'Новость' });
    await setProjects(pool, 'lesson', lesson.id, { mainId: idle.id });
    await setProjects(pool, 'news', item.id, { mainId: solo.id, relatedIds: [idle.id] });

    const result = await deleteProject(pool, 'idle-igra');
    assert.deepEqual(result, { deleted: true, orphaned: { lessons: 1, news: 0, series: 0 } });

    assert.equal((await projectsFor(pool, 'lesson', [lesson.id])).get(lesson.id).main, null);
    assert.deepEqual((await projectsFor(pool, 'news', [item.id])).get(item.id).related, []);
    assert.deepEqual(await deleteProject(pool, 'idle-igra'), { deleted: false, orphaned: null });
  });
});

test('список проектов со счётчиками', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { idle } = await three(pool);
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await setProjects(pool, 'lesson', lesson.id, { mainId: idle.id });
    const found = (await listProjects(pool)).find((item) => item.slug === 'idle-igra');
    assert.equal(found.lessonCount, 1);
    assert.equal(found.mainCount, 1);
    assert.equal(found.newsCount, 0);
  });
});

test('названный проект проверяется, неназванный — это «без проекта»', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { idle } = await three(pool);
    assert.equal(await resolveProjectId(pool, idle.id), idle.id);
    await assert.rejects(resolveProjectId(pool, 999999), isProjectError('not_found'));
    // Проект не выбран — материал заводится без проекта, подстановки нет.
    assert.equal(await resolveProjectId(pool), null);
    await pool.query('DELETE FROM projects');
    assert.equal(await resolveProjectId(pool), null);
  });
});

test('серия без проекта урокам ничего не задаёт, снятый проект серии у уроков остаётся', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { solo, idle } = await three(pool);
    const series = await saveSeries(pool, { title: 'Серия' });
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await setLessonSeries(pool, lesson.id, series.id);
    // У серии проекта нет — урок выбирает сам.
    await setProjects(pool, 'lesson', lesson.id, { mainId: solo.id });

    await setProjects(pool, 'series', series.id, { mainId: idle.id });
    assert.equal((await projectsFor(pool, 'lesson', [lesson.id])).get(lesson.id).main.id, idle.id);

    await setProjects(pool, 'series', series.id, { mainId: null });
    const links = (await projectsFor(pool, 'lesson', [lesson.id])).get(lesson.id);
    assert.equal(links.main.id, idle.id, 'проект урока не пропал вместе с проектом серии');
    // И теперь он свободен: серия больше ничего не задаёт.
    await setProjects(pool, 'lesson', lesson.id, { mainId: solo.id });
  });
});

test('адреса проектов переводятся в номера, неизвестный — отказ', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { solo, idle } = await three(pool);
    assert.deepEqual(await projectIdsBySlugs(pool, ['idle-igra', 'solo-ai-journey']), [
      idle.id,
      solo.id
    ]);
    assert.deepEqual(await projectIdsBySlugs(pool, []), []);
    await assert.rejects(projectIdsBySlugs(pool, ['net-takogo']), isProjectError('not_found'));
  });
});
