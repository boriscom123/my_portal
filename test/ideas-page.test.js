// Проверка страницы борда: идеи видны всем, форма предложения — только
// вошедшим, тексты от людей экранируются.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { createIdea, voteIdea, setIdeaStatus } from '../src/services/ideas.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://soloaijourney.online',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', channelId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: 'mailto:a@b' }
};

async function makeUser(pool, name = 'Пётр') {
  const { rows } = await pool.query(`INSERT INTO users (display_name) VALUES ($1) RETURNING id`, [
    name
  ]);
  return Number(rows[0].id);
}

async function board(pool, userId = null) {
  const app = finalize(createApp({ config, pool }));
  return withServer(app, async (base) => {
    const headers = userId
      ? { Authorization: `Bearer ${signSession({ userId, role: 'user' }, config.jwtSecret)}` }
      : {};
    const res = await fetch(`${base}/ideas`, { headers });
    return { status: res.status, html: await res.text() };
  });
}

test('борд виден гостю, но форма ему не предлагается', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await createIdea(pool, { userId: await makeUser(pool), title: 'Урок про очереди', body: '' });
    const { status, html } = await board(pool);
    assert.equal(status, 200);
    assert.match(html, /Урок про очереди/);
    assert.match(html, /Войдите/);
    assert.ok(!html.includes('id="idea-form"'));
  });
});

test('вошедшему показывается форма', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const id = await makeUser(pool);
    const { html } = await board(pool, id);
    assert.match(html, /id="idea-form"/);
  });
});

test('видно, за что этот человек уже голосовал', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const petr = await makeUser(pool);
    const anna = await makeUser(pool, 'Анна');
    const idea = await createIdea(pool, { userId: petr, title: 'Про очереди', body: '' });
    await voteIdea(pool, { ideaId: idea.id, userId: anna });
    const mine = await board(pool, anna);
    assert.match(mine.html, /class="vote voted"/);
    const foreign = await board(pool, petr);
    assert.ok(!foreign.html.includes('class="vote voted"'));
  });
});

test('вышедшая идея ведёт на урок', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const id = await makeUser(pool);
    await pool.query(
      `INSERT INTO lessons (slug, title, status, published_at)
       VALUES ('ocheredi', 'Очереди', 'published', now())`
    );
    const idea = await createIdea(pool, { userId: id, title: 'Про очереди', body: '' });
    await setIdeaStatus(pool, { ideaId: idea.id, status: 'released', lessonSlug: 'ocheredi' });
    const { html } = await board(pool);
    assert.match(html, /href="\/lesson\/ocheredi"/);
    assert.match(html, /вышла/);
  });
});

test('тема идеи с разметкой экранируется', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await createIdea(pool, {
      userId: await makeUser(pool),
      title: '<img src=x onerror=alert(1)>',
      body: ''
    });
    const { html } = await board(pool);
    assert.ok(!html.includes('<img src=x'));
    assert.match(html, /&lt;img/);
  });
});
