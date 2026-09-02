// Проверка шкалы оценки. Требование заказчика: девять смайликов, где пятый —
// ровно середина. Значение хранится как есть, а среднее считает база: 34
// голоса и «7,2 из 9» человеку говорят больше, чем девять отдельных счётчиков.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ШКАЛА, СЕРЕДИНА, допустимаяОценка } from '../src/lib/reactions.js';
import { setReaction, ratingSummary, countReactions } from '../src/services/feedback.js';
import { saveLesson } from '../src/services/lessons.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

test('шкала — ровно девять ступеней с серединой посередине', () => {
  assert.equal(ШКАЛА.length, 9);
  assert.deepEqual(
    ШКАЛА.map((с) => с.значение),
    ['1', '2', '3', '4', '5', '6', '7', '8', '9']
  );
  assert.equal(СЕРЕДИНА, '5');
  // Пятая ступень — пятая по счёту, то есть ровно середина девяти.
  assert.equal(ШКАЛА[4].значение, СЕРЕДИНА);
  // У каждой ступени свой смайлик и словесное описание: кнопка из одного
  // смайлика без подписи непонятна и недоступна для чтения с экрана.
  assert.equal(new Set(ШКАЛА.map((с) => с.смайлик)).size, 9);
  assert.ok(ШКАЛА.every((с) => с.описание.length > 2));
});

test('за шкалу не выходим', () => {
  assert.equal(допустимаяОценка('5'), true);
  assert.equal(допустимаяОценка('0'), false);
  assert.equal(допустимаяОценка('10'), false);
  assert.equal(допустимаяОценка('like'), false);
  assert.equal(допустимаяОценка(''), false);
});

async function seed(pool) {
  const lesson = await saveLesson(pool, { slug: 'docker-1', title: 'Docker' });
  const { rows } = await pool.query(
    `INSERT INTO users (display_name) VALUES ('Пётр'), ('Анна'), ('Иван') RETURNING id`
  );
  return { lessonId: lesson.id, люди: rows.map((r) => Number(r.id)) };
}

test('оценка вне шкалы не принимается', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, люди } = await seed(pool);
    await assert.rejects(
      setReaction(pool, {
        userId: люди[0],
        objectType: 'lesson',
        objectId: lessonId,
        kind: 'like'
      }),
      /оцен/i
    );
  });
});

test('среднее и распределение считаются по всем голосам', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, люди } = await seed(pool);
    const куда = { objectType: 'lesson', objectId: lessonId };
    for (const [i, оценка] of ['9', '8', '4'].entries()) {
      await setReaction(pool, { ...куда, userId: люди[i], kind: оценка });
    }
    const итог = await ratingSummary(pool, куда);
    assert.equal(итог.total, 3);
    assert.equal(итог.average, 7); // (9 + 8 + 4) / 3
    assert.deepEqual(await countReactions(pool, куда), { 4: 1, 8: 1, 9: 1 });
  });
});

test('без голосов среднего нет, а не ноль', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId } = await seed(pool);
    const итог = await ratingSummary(pool, { objectType: 'lesson', objectId: lessonId });
    // Ноль на шкале от одного до девяти означал бы «хуже некуда», а не
    // «никто не оценил». Отсутствие оценки — это null.
    assert.equal(итог.average, null);
    assert.equal(итог.total, 0);
  });
});

test('человек переставляет оценку, а не добавляет вторую', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, люди } = await seed(pool);
    const куда = { objectType: 'lesson', objectId: lessonId };
    await setReaction(pool, { ...куда, userId: люди[0], kind: '2' });
    await setReaction(pool, { ...куда, userId: люди[0], kind: '9' });
    const итог = await ratingSummary(pool, куда);
    assert.equal(итог.total, 1);
    assert.equal(итог.average, 9);
  });
});
