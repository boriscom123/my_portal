// Адрес урока пересобирается из заголовка — но только пока урок никуда не
// ушёл. После публикации адрес закрепляется навсегда: он уже стоит в описании
// ролика на YouTube и в постах каналов, и менять его значит ломать те ссылки.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { createLesson } from '../src/services/lesson-admin.js';
import { startPublication, markPublicationState } from '../src/services/publications.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://portal.example',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', botId: '', botUsername: '', apiUrl: 'https://api.telegram.org' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: '' },
  redis: { url: 'redis://redis:6379', prefix: 'portal:' },
  yandex: { apiKey: '', folderId: '' },
  yandexOauth: { clientId: '', clientSecret: '' },
  tokenEncryptionKey: 'a'.repeat(64),
  media: { dir: '/tmp', ttlHours: 168 },
  youtube: { clientId: '', clientSecret: '', redirectUri: '', mode: 'semi' }
};

async function adminHeaders(pool) {
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'admin' }, config.jwtSecret)}`
  };
}

/** Утверждение урока — тем же запросом, что делает экран проверки. */
async function approve(base, headers, slug, body) {
  const response = await fetch(`${base}/api/admin/lessons/${slug}/approve`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ description: '', tags: '', chapters: '', ...body })
  });
  return { status: response.status, body: await response.json() };
}

test('адрес нового урока пересобирается из заголовка', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    // Урок заводят до расшифровки, заголовка ещё нет — временный, с датой.
    const created = await createLesson(pool, { title: 'Урок от 2026-09-12' });
    assert.equal(created.slug, 'urok-ot-2026-09-12');
    const headers = await adminHeaders(pool);
    const app = finalize(createApp({ config, pool }));

    await withServer(app, async (base) => {
      const { status, body } = await approve(base, headers, created.slug, {
        title: 'Автоматизация подготовки видеоуроков',
        publish: true
      });
      assert.equal(status, 200);
      assert.equal(body.lesson.slug, 'avtomatizaciya-podgotovki-videourokov');
    });

    const { rows } = await pool.query('SELECT slug FROM lessons WHERE id = $1', [created.id]);
    assert.equal(rows[0].slug, 'avtomatizaciya-podgotovki-videourokov');
  });
});

test('у опубликованного урока адрес остаётся прежним', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const created = await createLesson(pool, { title: 'Урок от 2026-09-12' });
    await pool.query(`UPDATE lessons SET status = 'published', published_at = now() WHERE id = $1`, [
      created.id
    ]);
    const headers = await adminHeaders(pool);
    const app = finalize(createApp({ config, pool }));

    await withServer(app, async (base) => {
      const { body } = await approve(base, headers, created.slug, { title: 'Совсем другое название' });
      assert.equal(body.lesson.slug, created.slug, 'ссылки на витрине уже разошлись');
    });
  });
});

test('урок уже ушёл на площадку — адрес тоже не меняем', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const created = await createLesson(pool, { title: 'Урок от 2026-09-12' });
    // Черновик на сайте, но ролик уже на YouTube: в его описании стоит адрес.
    const { id } = await startPublication(pool, {
      lessonId: created.id,
      platform: 'youtube',
      mode: 'semi'
    });
    await markPublicationState(pool, id, { state: 'published', externalId: 'abc' });
    const headers = await adminHeaders(pool);
    const app = finalize(createApp({ config, pool }));

    await withServer(app, async (base) => {
      const { body } = await approve(base, headers, created.slug, { title: 'Другое название' });
      assert.equal(body.lesson.slug, created.slug);
    });
  });
});

test('из заголовка адреса не выходит — адрес по номеру урока', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const created = await createLesson(pool, { title: 'Урок от 2026-09-12' });
    const headers = await adminHeaders(pool);
    const app = finalize(createApp({ config, pool }));

    await withServer(app, async (base) => {
      const { body } = await approve(base, headers, created.slug, { title: '!!! ???' });
      assert.equal(body.lesson.slug, String(created.id));
    });
  });
});

test('такой адрес уже занят — добавляется номер', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const first = await createLesson(pool, { title: 'Работа с Docker' });
    assert.equal(first.slug, 'rabota-s-docker');
    const second = await createLesson(pool, { title: 'Урок от 2026-09-12' });
    const headers = await adminHeaders(pool);
    const app = finalize(createApp({ config, pool }));

    await withServer(app, async (base) => {
      const { body } = await approve(base, headers, second.slug, { title: 'Работа с Docker' });
      assert.equal(body.lesson.slug, 'rabota-s-docker-2');
    });
  });
});

test('заголовок не менялся — адрес остаётся тем же', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const created = await createLesson(pool, { title: 'Работа с Docker' });
    const headers = await adminHeaders(pool);
    const app = finalize(createApp({ config, pool }));

    await withServer(app, async (base) => {
      const { body } = await approve(base, headers, created.slug, { title: 'Работа с Docker' });
      // Тот же заголовок не должен превращаться в «rabota-s-docker-2».
      assert.equal(body.lesson.slug, 'rabota-s-docker');
    });
  });
});
