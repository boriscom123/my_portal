// Экраны автора: блок «Проект» у урока, выбор проекта при заведении урока и в
// форме новости.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveLesson } from '../src/services/lessons.js';
import { saveNews } from '../src/services/news.js';
import { saveSeries, setLessonSeries } from '../src/services/series.js';
import { saveProject, setProjects } from '../src/services/projects.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://portal.example',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', botId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: '' },
  redis: { url: 'redis://redis:6379', prefix: 'portal:' },
  yandex: { apiKey: '', folderId: '' },
  yandexOauth: { clientId: '', clientSecret: '' },
  tokenEncryptionKey: 'a'.repeat(64),
  media: { dir: '/tmp', ttlHours: 168 },
  youtube: { clientId: '', clientSecret: '', redirectUri: '/back', mode: 'semi' }
};

async function authorHeaders(pool) {
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  return {
    Accept: 'text/html',
    Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'admin' }, config.jwtSecret)}`
  };
}

test('экран урока: блок «Проект», у урока в серии основной заперт', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const headers = await authorHeaders(pool);
    const idle = await saveProject(pool, { title: 'IDLE игра' });
    await saveLesson(pool, { slug: 'svoy', title: 'Сам по себе' });
    const series = await saveSeries(pool, { title: 'Игра с нуля' });
    await setProjects(pool, 'series', series.id, { mainId: idle.id });
    const inSeries = await saveLesson(pool, { slug: 'v-serii', title: 'В серии' });
    await setLessonSeries(pool, inSeries.id, series.id);
    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));

    await withServer(app, async (base) => {
      const free = await (await fetch(`${base}/admin/lesson/svoy`, { headers })).text();
      assert.match(free, /<form data-lesson-projects="svoy"/);
      assert.match(free, /<option value="solo-ai-journey" selected>/);
      assert.doesNotMatch(free, /<select name="mainSlug"[^>]*disabled/);

      const locked = await (await fetch(`${base}/admin/lesson/v-serii`, { headers })).text();
      assert.match(locked, /<select name="mainSlug"[^>]*disabled/);
      assert.match(locked, /задаётся серией/);
      assert.match(locked, /href="\/series\/igra-s-nulya"/);
    });
  });
});

test('заведение урока и форма новости спрашивают проект', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const headers = await authorHeaders(pool);
    const idle = await saveProject(pool, { title: 'IDLE игра' });
    const item = await saveNews(pool, { title: 'Новость' });
    await setProjects(pool, 'news', item.id, { mainId: idle.id });
    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));

    await withServer(app, async (base) => {
      // Последний заведённый материал — новость в IDLE игре: он и по умолчанию.
      const fresh = await (await fetch(`${base}/lessons/new`, { headers })).text();
      assert.match(fresh, /<select name="projectSlug"[^>]*required/);
      assert.match(fresh, /<option value="idle-igra" selected>/);

      const edit = await (await fetch(`${base}/news/${item.slug}/edit`, { headers })).text();
      assert.match(edit, /<select name="mainSlug"/);
      assert.match(edit, /<option value="idle-igra" selected>/);

      const created = await (await fetch(`${base}/news/new`, { headers })).text();
      assert.match(created, /<option value="idle-igra" selected>/);
    });
  });
});
