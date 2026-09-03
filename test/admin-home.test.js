// Кабинет автора — точка входа во всё, что он делает: уроки, загрузка,
// подключения. Без него приходится помнить адреса наизусть.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveLesson } from '../src/services/lessons.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://soloaijourney.online',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', botId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: '' },
  redis: { url: 'redis://redis:6379', prefix: 'portal:' },
  yandex: { apiKey: '', folderId: '' },
  yandexOauth: { clientId: '', clientSecret: '' },
  tokenEncryptionKey: 'a'.repeat(64),
  media: { dir: '/tmp', ttlHours: 168 }
};

async function openAs(pool, role, path = '/admin') {
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Кто-то', $1) RETURNING id`,
    [role]
  );
  const app = finalize(createApp({ config, pool }));
  return withServer(app, async (base) => {
    const res = await fetch(`${base}${path}`, {
      headers: {
        Accept: 'text/html',
        Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role }, config.jwtSecret)}`
      }
    });
    return { status: res.status, html: await res.text() };
  });
}

test('кабинет собирает всё в одном месте', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveLesson(pool, { slug: 'urok', title: 'Урок про Docker' });
    const r = await openAs(pool, 'admin');
    assert.equal(r.status, 200);
    assert.match(r.html, /Урок про Docker/);
    // Из кабинета видны все разделы: помнить адреса наизусть не нужно.
    assert.match(r.html, /href="\/admin\/upload"/);
    assert.match(r.html, /href="\/ideas"/);
  });
});

test('состояние обработки видно прямо в списке', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await pool.query(
      `UPDATE lessons SET pipeline_state = 'failed', pipeline_error = 'transcribe: нет денег'
        WHERE id = $1`,
      [lesson.id]
    );
    const r = await openAs(pool, 'admin');
    assert.match(r.html, /обработка упала/i);
    // Причину видно сразу, без похода в журнал контейнера.
    assert.match(r.html, /нет денег/);
  });
});

test('кабинет закрыт для обычного пользователя', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    assert.equal((await openAs(pool, 'user')).status, 403);
  });
});

test('в шапке у автора есть ссылка на кабинет, у гостя — нет', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const свой = await openAs(pool, 'admin', '/');
    assert.match(свой.html, /href="\/admin"/);

    const app = finalize(createApp({ config, pool }));
    const гость = await withServer(app, async (base) =>
      (await fetch(`${base}/`, { headers: { Accept: 'text/html' } })).text()
    );
    assert.ok(!гость.includes('href="/admin"'));
  });
});

test('пустой кабинет объясняет, с чего начать', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const r = await openAs(pool, 'admin');
    // Пустой список выглядит поломкой; лучше сказать, что делать дальше.
    assert.match(r.html, /Заведите первый урок/i);
  });
});
