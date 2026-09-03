// Проверка борда идей: один голос на человека, статусы меняются только по
// разрешённому списку, при смене статуса известно, кого уведомить.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createIdea,
  listIdeas,
  voteIdea,
  unvoteIdea,
  setIdeaStatus
} from '../src/services/ideas.js';
import { saveLesson } from '../src/services/lessons.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

async function seed(pool) {
  const { rows } = await pool.query(
    `INSERT INTO users (display_name) VALUES ('Пётр'), ('Анна') RETURNING id`
  );
  return { petr: Number(rows[0].id), anna: Number(rows[1].id) };
}

test('идея заводится со статусом «новая»', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr } = await seed(pool);
    const idea = await createIdea(pool, { userId: petr, title: 'Урок про очереди', body: '' });
    assert.equal(idea.status, 'new');
    assert.equal(idea.votes, 0);
  });
});

test('идея без темы не принимается', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr } = await seed(pool);
    await assert.rejects(createIdea(pool, { userId: petr, title: '  ', body: '' }), /тем/i);
  });
});

test('голос считается один раз на человека', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr, anna } = await seed(pool);
    const idea = await createIdea(pool, { userId: petr, title: 'Про очереди', body: '' });
    await voteIdea(pool, { ideaId: idea.id, userId: anna });
    await voteIdea(pool, { ideaId: idea.id, userId: anna });
    const [сИдеей] = await listIdeas(pool, { viewerId: anna });
    assert.equal(сИдеей.votes, 1);
    assert.equal(сИдеей.votedByViewer, true);
  });
});

test('гость видит счётчик, но не помечен голосовавшим', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr, anna } = await seed(pool);
    const idea = await createIdea(pool, { userId: petr, title: 'Про очереди', body: '' });
    await voteIdea(pool, { ideaId: idea.id, userId: anna });
    const [гостю] = await listIdeas(pool, {});
    assert.equal(гостю.votes, 1);
    assert.equal(гостю.votedByViewer, false);
  });
});

test('голос можно отозвать', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr, anna } = await seed(pool);
    const idea = await createIdea(pool, { userId: petr, title: 'Про очереди', body: '' });
    await voteIdea(pool, { ideaId: idea.id, userId: anna });
    await unvoteIdea(pool, { ideaId: idea.id, userId: anna });
    const [сИдеей] = await listIdeas(pool, { viewerId: anna });
    assert.equal(сИдеей.votes, 0);
    assert.equal(сИдеей.votedByViewer, false);
  });
});

test('желанные идеи идут первыми', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr, anna } = await seed(pool);
    await createIdea(pool, { userId: petr, title: 'Никому не нужна', body: '' });
    const нужная = await createIdea(pool, { userId: petr, title: 'Желанная', body: '' });
    await voteIdea(pool, { ideaId: нужная.id, userId: anna });
    const список = await listIdeas(pool, {});
    assert.equal(список[0].title, 'Желанная');
  });
});

test('смена статуса возвращает список проголосовавших', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr, anna } = await seed(pool);
    const idea = await createIdea(pool, { userId: petr, title: 'Про очереди', body: '' });
    await voteIdea(pool, { ideaId: idea.id, userId: anna });
    const { idea: обновлённая, voterIds } = await setIdeaStatus(pool, {
      ideaId: idea.id,
      status: 'accepted'
    });
    assert.equal(обновлённая.status, 'accepted');
    assert.deepEqual(voterIds, [anna]);
  });
});

test('вышедшая идея связывается с уроком', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr } = await seed(pool);
    await saveLesson(pool, {
      slug: 'ocheredi',
      title: 'Очереди',
      status: 'published',
      publishedAt: new Date()
    });
    const idea = await createIdea(pool, { userId: petr, title: 'Про очереди', body: '' });
    const { idea: закрытая } = await setIdeaStatus(pool, {
      ideaId: idea.id,
      status: 'released',
      lessonSlug: 'ocheredi'
    });
    assert.equal(закрытая.lessonSlug, 'ocheredi');
    const [из_списка] = await listIdeas(pool, {});
    assert.equal(из_списка.lessonSlug, 'ocheredi');
  });
});

test('неизвестный статус не принимается', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr } = await seed(pool);
    const idea = await createIdea(pool, { userId: petr, title: 'Про очереди', body: '' });
    await assert.rejects(setIdeaStatus(pool, { ideaId: idea.id, status: 'придумал' }), /статус/i);
  });
});

test('несуществующая идея — не найдена, а не тихий успех', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await assert.rejects(setIdeaStatus(pool, { ideaId: 999, status: 'accepted' }), /не найдена/i);
  });
});
