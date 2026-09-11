// Кнопки «видео урока»: встают в очередь только после анонса и при записи в
// буфере; на экране урока — своя строка рядом с анонсом.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveLesson } from '../src/services/lessons.js';
import {
  startPublication,
  markPublicationState,
  publicationsFor
} from '../src/services/publications.js';
import { savePlatformApp } from '../src/services/platform-apps.js';
import { adminReviewPage } from '../src/views/admin-review.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://portal.example',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: 'portal-bot', botId: '', botUsername: '', apiUrl: 'https://api.telegram.org' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: '' },
  redis: { url: 'redis://redis:6379', prefix: 'portal:' },
  yandex: { apiKey: '', folderId: '' },
  yandexOauth: { clientId: '', clientSecret: '' },
  tokenEncryptionKey: 'a'.repeat(64),
  media: { dir: '/tmp', ttlHours: 168 },
  youtube: { clientId: '', clientSecret: '', redirectUri: '', mode: 'semi' }
};

/** Урок с записью в буфере, настроенный канал Telegram и админ. */
async function seed(pool, { withSource = true } = {}) {
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
  if (withSource) {
    await pool.query(
      `INSERT INTO assets (lesson_id, kind, path, bytes, expires_at)
       VALUES ($1, 'source', 'lesson-1/urok.mp4', 1024, now() + interval '7 days')`,
      [lesson.id]
    );
  }
  // Канал с адресом; токен — бота портала из настроек.
  await savePlatformApp(pool, config, {
    name: 'telegram',
    clientId: '',
    clientSecret: '',
    mode: 'auto',
    settings: { channel: '@kanal' }
  });
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'admin' }, config.jwtSecret)}`
  };
  return { lesson, headers };
}

async function announce(pool, lessonId, platform = 'telegram') {
  const { id } = await startPublication(pool, { lessonId, platform, mode: 'auto' });
  await markPublicationState(pool, id, { state: 'published', externalId: '1' });
}

test('без анонса кнопка отказывает, после — ставит задачу', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool);
    const queued = [];
    const app = finalize(
      createApp({ config, pool, queue: { add: async (name, data) => queued.push({ name, data }) } })
    );
    await withServer(app, async (base) => {
      const early = await fetch(`${base}/api/admin/lessons/urok/publish/telegram_parts`, {
        method: 'POST',
        headers
      });
      assert.equal(early.status, 409);
      assert.match((await early.json()).error, /анонс/);
      assert.equal(queued.length, 0);

      await announce(pool, lesson.id);
      const later = await fetch(`${base}/api/admin/lessons/urok/publish/telegram_parts`, {
        method: 'POST',
        headers
      });
      assert.equal(later.status, 200);
    });
    assert.equal(queued.length, 1);
    assert.equal(queued[0].name, 'publishTelegramParts');
    const publication = (await publicationsFor(pool, lesson.id)).find(
      (item) => item.platform === 'telegram_parts'
    );
    assert.equal(publication.state, 'queued');
    assert.equal(queued[0].data.publicationId, publication.id);
  });
});

test('без записи в буфере — отказ со словами', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, { withSource: false });
    await announce(pool, lesson.id);
    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));
    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/admin/lessons/urok/publish/telegram_parts`, {
        method: 'POST',
        headers
      });
      assert.equal(response.status, 409);
      assert.match((await response.json()).error, /Записи урока нет в буфере/);
    });
  });
});

test('на экране урока — строка «видео урока» рядом с анонсом', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { headers } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (
        await fetch(`${base}/admin/lesson/urok`, { headers: { ...headers, Accept: 'text/html' } })
      ).text();
      assert.match(html, /Канал Telegram/);
      assert.match(html, /Telegram — видео урока/);
      // MAX не настроен — его строк нет вовсе.
      assert.doesNotMatch(html, /MAX — видео урока/);
    });
  });
});

test('кнопка «видео урока» заперта, пока анонс не ушёл', () => {
  const base = {
    config: { youtube: { clientId: 'id' } },
    user: { role: 'admin' },
    lesson: { slug: 'urok', title: 'Урок', description: '', tags: [], settings: {}, coverUrl: null },
    assets: [{ kind: 'source', path: 'lesson-1/urok.mp4', bytes: 10, expiresLabel: '15.09.2026' }],
    transcript: null,
    links: { subtitles: [], clips: [] },
    platforms: [
      {
        name: 'telegram_parts',
        title: 'Telegram — видео урока',
        action: 'Отправить видео урока',
        needsCover: false,
        needsAnnouncement: 'telegram'
      }
    ]
  };
  const button = /<button[^>]*data-publish="telegram_parts"[^>]*>/;

  const before = adminReviewPage({ ...base, publications: [] });
  assert.match(before.match(button)[0], /disabled title="Сначала отправьте анонс в этот канал"/);

  const after = adminReviewPage({
    ...base,
    publications: [{ platform: 'telegram', state: 'published', url: 'https://t.me/kanal/5', error: null }]
  });
  // Обложка частям не нужна: превью возьмётся, если она есть, но без неё
  // отправлять можно.
  assert.doesNotMatch(after.match(button)[0], /disabled/);
  assert.match(after, /Отправить видео урока/);
});

test('ненастроенный канал MAX — отказ, как у анонса', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool);
    await announce(pool, lesson.id, 'max');
    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));
    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/admin/lessons/urok/publish/max_parts`, {
        method: 'POST',
        headers
      });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /не настроен/);
    });
  });
});
