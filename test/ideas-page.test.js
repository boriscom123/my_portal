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

async function человек(pool, имя = 'Пётр') {
  const { rows } = await pool.query(`INSERT INTO users (display_name) VALUES ($1) RETURNING id`, [
    имя
  ]);
  return Number(rows[0].id);
}

async function борд(pool, userId = null) {
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
    await createIdea(pool, { userId: await человек(pool), title: 'Урок про очереди', body: '' });
    const { status, html } = await борд(pool);
    assert.equal(status, 200);
    assert.match(html, /Урок про очереди/);
    assert.match(html, /Войдите/);
    assert.ok(!html.includes('id="форма-идеи"'));
  });
});

test('вошедшему показывается форма', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const id = await человек(pool);
    const { html } = await борд(pool, id);
    assert.match(html, /id="форма-идеи"/);
  });
});

test('видно, за что этот человек уже голосовал', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const петр = await человек(pool);
    const анна = await человек(pool, 'Анна');
    const idea = await createIdea(pool, { userId: петр, title: 'Про очереди', body: '' });
    await voteIdea(pool, { ideaId: idea.id, userId: анна });
    const свой = await борд(pool, анна);
    assert.match(свой.html, /class="голос отдан"/);
    const чужой = await борд(pool, петр);
    assert.ok(!чужой.html.includes('class="голос отдан"'));
  });
});

test('вышедшая идея ведёт на урок', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const id = await человек(pool);
    await pool.query(
      `INSERT INTO lessons (slug, title, status, published_at)
       VALUES ('ocheredi', 'Очереди', 'published', now())`
    );
    const idea = await createIdea(pool, { userId: id, title: 'Про очереди', body: '' });
    await setIdeaStatus(pool, { ideaId: idea.id, status: 'released', lessonSlug: 'ocheredi' });
    const { html } = await борд(pool);
    assert.match(html, /href="\/lesson\/ocheredi"/);
    assert.match(html, /вышла/);
  });
});

test('тема идеи с разметкой экранируется', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await createIdea(pool, {
      userId: await человек(pool),
      title: '<img src=x onerror=alert(1)>',
      body: ''
    });
    const { html } = await борд(pool);
    assert.ok(!html.includes('<img src=x'));
    assert.match(html, /&lt;img/);
  });
});
