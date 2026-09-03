// Проверка загрузки кусками. Гигабайтный файл одним запросом рвётся на первой
// же потере связи и начинается заново — поэтому куски и учёт принятого.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveLesson } from '../src/services/lessons.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

async function makeConfig() {
  return {
    publicBaseUrl: 'https://soloaijourney.online',
    jwtSecret: 'x'.repeat(32),
    adminIdentities: [],
    telegram: { botToken: '', botId: '', botUsername: '' },
    google: { clientId: '', clientSecret: '' },
    vapid: { publicKey: '', privateKey: '', subject: '' },
    redis: { url: 'redis://redis:6379', prefix: 'portal:' },
    yandex: { apiKey: '', folderId: '' },
    media: { dir: await mkdtemp(path.join(tmpdir(), 'portal-media-')), ttlHours: 168 }
  };
}

function asAdmin(config, userId) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${signSession({ userId, role: 'admin' }, config.jwtSecret)}`
  };
}

async function seed(pool) {
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  return { lessonId: lesson.id, adminId: Number(rows[0].id) };
}

test('гость загрузить не может', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/upload/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ lessonId: 1, fileName: 'a.mp4', bytes: 10 })
      });
      assert.equal(res.status, 401);
    });
  });
});

test('файл собирается из кусков в правильном порядке', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lessonId, adminId } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const parts = ['первый-', 'второй-', 'третий'];
      const bytes = Buffer.byteLength(parts.join(''));

      const init = await (
        await fetch(`${base}/api/upload/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...asAdmin(config, adminId) },
          body: JSON.stringify({ lessonId, fileName: 'urok.mp4', bytes })
        })
      ).json();
      assert.ok(init.uploadId, `init вернул: ${JSON.stringify(init)}`);

      // Куски шлём вразнобой: порядок склейки задаёт номер, а не очерёдность
      // прихода — при повторе после обрыва они и придут не по порядку.
      for (const index of [2, 0, 1]) {
        const res = await fetch(`${base}/api/upload/${init.uploadId}/${index}`, {
          method: 'PUT',
          headers: asAdmin(config, adminId),
          body: parts[index]
        });
        assert.equal(res.status, 200);
      }

      const done = await (
        await fetch(`${base}/api/upload/${init.uploadId}/finish`, {
          method: 'POST',
          headers: asAdmin(config, adminId)
        })
      ).json();

      assert.equal(done.asset.bytes, bytes);
      const { rows } = await pool.query('SELECT path FROM assets WHERE id = $1', [done.asset.id]);
      const collected = await readFile(path.join(config.media.dir, rows[0].path), 'utf8');
      assert.equal(collected, parts.join(''));

      // Урок ушёл в обработку и знает свой исходник.
      const { rows: lesson } = await pool.query(
        'SELECT pipeline_state, source_asset_id FROM lessons WHERE id = $1',
        [lessonId]
      );
      assert.equal(lesson[0].pipeline_state, 'processing');
      assert.equal(Number(lesson[0].source_asset_id), done.asset.id);
    });
  });
});

test('после обрыва видно, сколько кусков уже принято', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lessonId, adminId } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const init = await (
        await fetch(`${base}/api/upload/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...asAdmin(config, adminId) },
          body: JSON.stringify({ lessonId, fileName: 'urok.mp4', bytes: 30 })
        })
      ).json();

      await fetch(`${base}/api/upload/${init.uploadId}/0`, {
        method: 'PUT',
        headers: asAdmin(config, adminId),
        body: 'kusok'
      });

      const state = await (
        await fetch(`${base}/api/upload/${init.uploadId}`, { headers: asAdmin(config, adminId) })
      ).json();
      // По этому списку клиент понимает, с какого куска продолжать.
      assert.deepEqual(state.received, [0]);
    });
  });
});

test('чужое имя файла не уводит запись за пределы буфера', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lessonId, adminId } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/upload/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...asAdmin(config, adminId) },
        body: JSON.stringify({ lessonId, fileName: '../../../etc/passwd', bytes: 10 })
      });
      const init = await res.json();
      // Имя обеззараживается, а не отвергается: человек не виноват, что его
      // файл называется странно.
      assert.equal(res.status, 200);
      assert.ok(!init.fileName.includes('..'));
      assert.ok(!init.fileName.includes('/'));
    });
  });
});
