// Виды обращений: идея, пожелание, отзыв.
//
// Раздел «Идеи» стал «Обратной связью»: по сути это одно и то же — человек
// говорит автору, чего хочет, — и разница в том, про что. Голосование при этом
// осмысленно только у идей.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdea, listIdeas, voteIdea } from '../src/services/ideas.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

async function makeUser(pool, name = 'Гость') {
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ($1, 'user') RETURNING id`,
    [name]
  );
  return Number(rows[0].id);
}

test('вид обращения сохраняется', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const userId = await makeUser(pool);
    const idea = await createIdea(pool, { userId, title: 'Урок про nginx', kind: 'idea' });
    const wish = await createIdea(pool, { userId, title: 'Тёмная тема пожирнее', kind: 'wish' });
    const review = await createIdea(pool, { userId, title: 'Спасибо за портал', kind: 'review' });

    assert.equal(idea.kind, 'idea');
    assert.equal(wish.kind, 'wish');
    assert.equal(review.kind, 'review');
  });
});

test('незнакомый вид становится идеей, а не ошибкой', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const userId = await makeUser(pool);
    // Вид приходит из формы, то есть от человека: подделанное значение не
    // должно ронять отправку — оно должно превращаться в обычную идею.
    const idea = await createIdea(pool, { userId, title: 'Тема', kind: 'chuzhoe' });
    assert.equal(idea.kind, 'idea');
  });
});

test('голосовать можно только за идеи', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const author = await makeUser(pool, 'Автор идеи');
    const voter = await makeUser(pool, 'Голосующий');
    const review = await createIdea(pool, { userId: author, title: 'Отзыв', kind: 'review' });

    // Кнопку голосования у отзыва мы не рисуем, но запрос подделать легче
    // разметки — поэтому правило живёт в коде, а не в шаблоне.
    await assert.rejects(voteIdea(pool, { ideaId: review.id, userId: voter }), /только за идеи/i);
  });
});

test('вид виден в списке — по нему страница раскладывает обращения', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const userId = await makeUser(pool);
    await createIdea(pool, { userId, title: 'Пожелание', kind: 'wish' });
    const [item] = await listIdeas(pool, {});
    assert.equal(item.kind, 'wish');
    assert.equal(item.authorId, userId, 'по автору страница покажет человеку его собственные');
  });
});
