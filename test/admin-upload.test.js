// Страница загрузки доступна только автору портала: исходники грузит он один,
// а гостю здесь нечего делать даже посмотреть.
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
  media: { dir: '/tmp', ttlHours: 168 }
};

async function openUploadPage(pool, role) {
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Кто-то', $1) RETURNING id`,
    [role]
  );
  const app = finalize(createApp({ config, pool }));
  return withServer(app, async (base) => {
    const res = await fetch(`${base}/admin/upload`, {
      headers: {
        Accept: 'text/html',
        Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role }, config.jwtSecret)}`
      }
    });
    return { status: res.status, html: await res.text() };
  });
}

test('автор портала видит страницу загрузки', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveLesson(pool, { slug: 'urok', title: 'Урок про Docker' });
    const r = await openUploadPage(pool, 'admin');
    assert.equal(r.status, 200);
    assert.match(r.html, /id="upload-form"/);
    assert.match(r.html, /accept="video\//);
    // Урок нужно выбрать: файл сам по себе никуда не относится.
    assert.match(r.html, /Урок про Docker/);
  });
});

test('обычному пользователю страница закрыта', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const r = await openUploadPage(pool, 'user');
    assert.equal(r.status, 403);
  });
});

test('без уроков страница объясняет, что делать', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const r = await openUploadPage(pool, 'admin');
    // Пустой список в выпадающем поле выглядит поломкой; лучше сказать прямо.
    assert.match(r.html, /сначала заведите урок/i);
  });
});
