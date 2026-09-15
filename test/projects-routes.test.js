// API проектов для автора: заведение, правка, удаление проектов и выбор
// проектов у урока, новости и серии. Очередь подменяется — Redis не нужен.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveLesson, getLessonBySlug } from '../src/services/lessons.js';
import { getNewsBySlug } from '../src/services/news.js';
import { saveSeries, setLessonSeries, getSeriesBySlug } from '../src/services/series.js';
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

async function admin(pool) {
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'admin' }, config.jwtSecret)}`
  };
}

function app(pool) {
  return finalize(createApp({ config, pool, queue: { add: async () => {} } }));
}

const post = (base, headers, path, body) =>
  fetch(`${base}/api/admin${path}`, { method: 'POST', headers, body: JSON.stringify(body) });

const drafts = { includeDrafts: true };

test('проект заводится, правится и удаляется', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const headers = await admin(pool);
    await withServer(app(pool), async (base) => {
      const created = await post(base, headers, '/projects', {
        title: 'IDLE игра',
        description: 'Игра'
      });
      assert.equal(created.status, 200);
      assert.equal((await created.json()).slug, 'idle-igra');

      const edited = await post(base, headers, '/projects', {
        slug: 'idle-igra',
        title: 'Idle',
        description: ''
      });
      assert.equal((await edited.json()).title, 'Idle');

      assert.equal((await post(base, headers, '/projects', { title: '' })).status, 400);

      const removed = await fetch(`${base}/api/admin/projects/idle-igra`, {
        method: 'DELETE',
        headers
      });
      assert.deepEqual(await removed.json(), {
        deleted: true,
        orphaned: { lessons: 0, news: 0, series: 0 }
      });
      const again = await fetch(`${base}/api/admin/projects/idle-igra`, { method: 'DELETE', headers });
      assert.equal(again.status, 404);
    });
  });
});

test('проекты урока: основной можно снять, неизвестный — 404', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const headers = await admin(pool);
    await saveProject(pool, { title: 'IDLE игра' });
    await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await withServer(app(pool), async (base) => {
      const ok = await post(base, headers, '/lessons/urok/projects', {
        mainSlug: 'idle-igra',
        relatedSlugs: ['solo-ai-journey']
      });
      assert.equal(ok.status, 200);
      // «Без проекта» — законный выбор: основной снимается.
      const empty = await post(base, headers, '/lessons/urok/projects', {
        mainSlug: '',
        relatedSlugs: []
      });
      assert.equal(empty.status, 200);
      assert.equal((await getLessonBySlug(pool, 'urok', drafts)).projects.main, null);
      await post(base, headers, '/lessons/urok/projects', {
        mainSlug: 'idle-igra',
        relatedSlugs: ['solo-ai-journey']
      });
      const unknown = await post(base, headers, '/lessons/urok/projects', { mainSlug: 'net' });
      assert.equal(unknown.status, 404);
    });
    const lesson = await getLessonBySlug(pool, 'urok', drafts);
    assert.equal(lesson.projects.main.slug, 'idle-igra');
    assert.deepEqual(
      lesson.projects.related.map((item) => item.slug),
      ['solo-ai-journey']
    );
  });
});

test('урок в серии: основной берётся у серии, другой — 409', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const headers = await admin(pool);
    const idle = await saveProject(pool, { title: 'IDLE игра' });
    const series = await saveSeries(pool, { title: 'Серия' });
    await setProjects(pool, 'series', series.id, { mainId: idle.id });
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await setLessonSeries(pool, lesson.id, series.id);
    await withServer(app(pool), async (base) => {
      // Выбор основного заперт на экране — форма его не шлёт.
      const kept = await post(base, headers, '/lessons/urok/projects', {
        relatedSlugs: ['solo-ai-journey']
      });
      assert.equal(kept.status, 200);
      const other = await post(base, headers, '/lessons/urok/projects', {
        mainSlug: 'solo-ai-journey'
      });
      assert.equal(other.status, 409);
    });
  });
});

test('новость и серия заводятся с выбранными проектами', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const headers = await admin(pool);
    await saveProject(pool, { title: 'IDLE игра' });
    await withServer(app(pool), async (base) => {
      const news = await (
        await post(base, headers, '/news', {
          title: 'Новость',
          body: '',
          mainSlug: 'idle-igra',
          relatedSlugs: ['solo-ai-journey']
        })
      ).json();
      const item = await getNewsBySlug(pool, news.slug);
      assert.equal(item.projects.main.slug, 'idle-igra');
      assert.deepEqual(
        item.projects.related.map((project) => project.slug),
        ['solo-ai-journey']
      );

      const series = await (
        await post(base, headers, '/series', { title: 'Серия', description: '', mainSlug: 'idle-igra' })
      ).json();

      // Новость с «Без проекта» и связанным проектом: основного нет, связанный есть.
      const loose = await (
        await post(base, headers, '/news', {
          title: 'Без проекта',
          body: '',
          mainSlug: '',
          relatedSlugs: ['idle-igra']
        })
      ).json();
      const looseItem = await getNewsBySlug(pool, loose.slug);
      assert.equal(looseItem.projects.main, null);
      assert.deepEqual(
        looseItem.projects.related.map((project) => project.slug),
        ['idle-igra']
      );
      assert.equal(
        (await getSeriesBySlug(pool, series.slug, drafts)).projects.main.slug,
        'idle-igra'
      );
    });
  });
});

test('урок заводится в выбранном проекте, новая серия с экрана урока — в проекте урока', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const headers = await admin(pool);
    await saveProject(pool, { title: 'IDLE игра' });
    await withServer(app(pool), async (base) => {
      const { lesson } = await (
        await post(base, headers, '/lessons', { projectSlug: 'idle-igra' })
      ).json();
      const saved = await getLessonBySlug(pool, lesson.slug, drafts);
      assert.equal(saved.projects.main.slug, 'idle-igra');

      const answer = await (
        await post(base, headers, `/lessons/${lesson.slug}/series`, {
          seriesSlug: '',
          title: 'Игра с нуля'
        })
      ).json();
      assert.equal(
        (await getSeriesBySlug(pool, answer.series.slug, drafts)).projects.main.slug,
        'idle-igra'
      );
    });
  });
});
