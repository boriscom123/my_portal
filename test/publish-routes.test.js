// Кнопка выкладки и кнопка «Проверить». Очередь и площадка подменяются: в тесте
// незачем ни Redis, ни сеть.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveLesson } from '../src/services/lessons.js';
import { publicationsFor, startPublication } from '../src/services/publications.js';
import { saveIntegration } from '../src/services/disk.js';
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
  youtube: { clientId: 'id', clientSecret: 'secret', redirectUri: '/back', mode: 'semi' }
};

function asAdmin(adminId) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${signSession({ userId: adminId, role: 'admin' }, config.jwtSecret)}`
  };
}

/** Урок с записью в буфере и админ, от чьего имени идут запросы. */
async function seed(pool, { withSource = true } = {}) {
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  if (withSource) {
    await pool.query(
      `INSERT INTO assets (lesson_id, kind, path, bytes, expires_at)
       VALUES ($1, 'source', 'lesson-1/urok.mp4', 1024, now() + interval '7 days')`,
      [lesson.id]
    );
  }
  return { lesson, adminId: Number(rows[0].id) };
}

/** Подключённый канал со свежим токеном: обновлять его не придётся. */
async function connectChannel(pool) {
  await saveIntegration(pool, config, {
    name: 'youtube',
    token: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: new Date(Date.now() + 3600_000)
  });
}

test('кнопка ставит выкладку в очередь', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, adminId } = await seed(pool);
    const queued = [];
    const app = finalize(createApp({
      config,
      pool,
      queue: { add: async (name, data) => queued.push({ name, data }) }
    }));

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/admin/lessons/urok/publish/youtube`, {
        method: 'POST',
        headers: asAdmin(adminId)
      });
      assert.equal(response.status, 200);
    });

    const [publication] = await publicationsFor(pool, lesson.id);
    assert.equal(publication.state, 'queued');
    assert.equal(publication.mode, 'semi');
    assert.equal(queued.length, 1, 'задача обязана уйти в очередь');
    assert.equal(queued[0].name, 'publishYoutube');
    assert.equal(queued[0].data.publicationId, publication.id);
  });
});

test('без записи выкладку не ставим и говорим почему', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { adminId } = await seed(pool, { withSource: false });
    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/admin/lessons/urok/publish/youtube`, {
        method: 'POST',
        headers: asAdmin(adminId)
      });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /запис/i);
    });
  });
});

test('«Проверить» переводит открытый ролик в published', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, adminId } = await seed(pool);
    await connectChannel(pool);
    const { id } = await startPublication(pool, {
      lessonId: lesson.id,
      platform: 'youtube',
      assetId: null,
      mode: 'semi'
    });
    await pool.query(
      `UPDATE publications SET state = 'ready', external_id = 'video-1',
                               url = 'https://youtu.be/video-1' WHERE id = $1`,
      [id]
    );

    const app = finalize(createApp({
      config,
      pool,
      queue: { add: async () => {} },
      fetchImpl: async (url) => {
        assert.match(String(url), /videos\?part=status/);
        return {
          ok: true,
          json: async () => ({ items: [{ status: { privacyStatus: 'public' } }] })
        };
      }
    }));

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/admin/lessons/urok/publish/youtube/check`, {
        method: 'POST',
        headers: asAdmin(adminId)
      });
      assert.equal((await response.json()).state, 'published');
    });

    const [publication] = await publicationsFor(pool, lesson.id);
    assert.equal(publication.state, 'published');
    assert.equal(publication.url, 'https://youtu.be/video-1', 'ссылка не должна потеряться');
  });
});

test('всё ещё приватный ролик остаётся ready', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, adminId } = await seed(pool);
    await connectChannel(pool);
    const { id } = await startPublication(pool, {
      lessonId: lesson.id,
      platform: 'youtube',
      assetId: null,
      mode: 'semi'
    });
    await pool.query(
      `UPDATE publications SET state = 'ready', external_id = 'video-1' WHERE id = $1`,
      [id]
    );

    const app = finalize(createApp({
      config,
      pool,
      queue: { add: async () => {} },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ items: [{ status: { privacyStatus: 'private' } }] })
      })
    }));

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/admin/lessons/urok/publish/youtube/check`, {
        method: 'POST',
        headers: asAdmin(adminId)
      });
      assert.equal((await response.json()).state, 'ready');
    });
  });
});

test('проверять нечего, пока ролик не уехал', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { adminId } = await seed(pool);
    await connectChannel(pool);
    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/admin/lessons/urok/publish/youtube/check`, {
        method: 'POST',
        headers: asAdmin(adminId)
      });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /не уехал/i);
    });
  });
});
