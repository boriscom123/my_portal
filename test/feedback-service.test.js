// Проверка обратной связи. Два правила заказчика проверяются именно здесь:
// реакция засчитывается один раз, неодобренный комментарий гостю не виден.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  setReaction,
  removeReaction,
  countReactions,
  getViewerReaction,
  addComment,
  listComments,
  moderateComment
} from '../src/services/feedback.js';
import { saveLesson } from '../src/services/lessons.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

async function seed(pool) {
  const lesson = await saveLesson(pool, { slug: 'docker-1', title: 'Docker' });
  const { rows } = await pool.query(
    `INSERT INTO users (display_name) VALUES ('Пётр'), ('Анна') RETURNING id`
  );
  return { lessonId: lesson.id, petr: Number(rows[0].id), anna: Number(rows[1].id) };
}

test('реакция одного человека засчитывается один раз', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, petr } = await seed(pool);
    const where = { objectType: 'lesson', objectId: lessonId };
    await setReaction(pool, { ...where, userId: petr, kind: 'like' });
    await setReaction(pool, { ...where, userId: petr, kind: 'like' });
    assert.deepEqual(await countReactions(pool, where), { like: 1 });
  });
});

test('смена реакции заменяет прежнюю, а не добавляет', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, petr } = await seed(pool);
    const where = { objectType: 'lesson', objectId: lessonId };
    await setReaction(pool, { ...where, userId: petr, kind: 'like' });
    await setReaction(pool, { ...where, userId: petr, kind: 'fire' });
    assert.deepEqual(await countReactions(pool, where), { fire: 1 });
  });
});

test('видно, какую реакцию поставил этот человек', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, petr, anna } = await seed(pool);
    const where = { objectType: 'lesson', objectId: lessonId };
    await setReaction(pool, { ...where, userId: petr, kind: 'fire' });
    assert.equal(await getViewerReaction(pool, { ...where, userId: petr }), 'fire');
    assert.equal(await getViewerReaction(pool, { ...where, userId: anna }), null);
    assert.equal(await getViewerReaction(pool, { ...where, userId: null }), null);
  });
});

test('реакцию можно снять', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, petr } = await seed(pool);
    const where = { objectType: 'lesson', objectId: lessonId };
    await setReaction(pool, { ...where, userId: petr, kind: 'like' });
    await removeReaction(pool, { ...where, userId: petr });
    assert.deepEqual(await countReactions(pool, where), {});
  });
});

test('новый комментарий ждёт модерации и гостю не виден', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, petr } = await seed(pool);
    const where = { objectType: 'lesson', objectId: lessonId };
    const comment = await addComment(pool, { ...where, userId: petr, body: 'Спасибо!' });
    assert.equal(comment.status, 'pending');
    assert.deepEqual(await listComments(pool, { ...where, viewerId: null, isAdmin: false }), []);
  });
});

test('автор комментария видит свой до одобрения', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, petr, anna } = await seed(pool);
    const where = { objectType: 'lesson', objectId: lessonId };
    await addComment(pool, { ...where, userId: petr, body: 'Спасибо!' });
    assert.equal((await listComments(pool, { ...where, viewerId: petr })).length, 1);
    assert.equal((await listComments(pool, { ...where, viewerId: anna })).length, 0);
  });
});

test('админ видит всё — иначе ему нечего модерировать', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, petr } = await seed(pool);
    const where = { objectType: 'lesson', objectId: lessonId };
    await addComment(pool, { ...where, userId: petr, body: 'Спасибо!' });
    assert.equal((await listComments(pool, { ...where, isAdmin: true })).length, 1);
  });
});

test('одобренный комментарий виден всем', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, petr } = await seed(pool);
    const where = { objectType: 'lesson', objectId: lessonId };
    const comment = await addComment(pool, { ...where, userId: petr, body: 'Спасибо!' });
    await moderateComment(pool, { commentId: comment.id, status: 'approved' });
    assert.equal((await listComments(pool, { ...where, viewerId: null })).length, 1);
  });
});

test('пустой комментарий не принимается', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, petr } = await seed(pool);
    await assert.rejects(
      addComment(pool, { objectType: 'lesson', objectId: lessonId, userId: petr, body: '   ' }),
      /пуст/i
    );
  });
});
