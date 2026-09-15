// Пока ролик едет на площадку, страница урока следит за выкладкой сама.
//
// Раньше после нажатия «Отправить на YouTube» страница перечитывалась один раз
// и так и оставалась с «загружается»: заказчик 2026-09-15 обновлял её руками.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
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

test('пока выкладка в пути, страница урока ждёт её конца', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows: [admin] } = await pool.query(
      `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
    );
    const { rows: [lesson] } = await pool.query(
      `INSERT INTO lessons (slug, title, status) VALUES ('urok', 'Урок', 'draft') RETURNING id`
    );
    const { rows: [publication] } = await pool.query(
      `INSERT INTO publications (lesson_id, platform, state) VALUES ($1, 'youtube', 'queued') RETURNING id`,
      [lesson.id]
    );
    const headers = {
      Authorization: `Bearer ${signSession({ userId: Number(admin.id), role: 'admin' }, config.jwtSecret)}`
    };
    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));

    await withServer(app, async (base) => {
      const state = async () =>
        (await fetch(`${base}/api/admin/lessons/urok/state`, { headers })).json();
      const page = async () =>
        (await fetch(`${base}/admin/lesson/urok`, { headers: { Accept: 'text/html', ...headers } })).text();

      assert.equal((await state()).publishing, true);
      assert.match(await page(), /data-publish-watch="urok"/);

      await pool.query(`UPDATE publications SET state = 'uploading' WHERE id = $1`, [publication.id]);
      assert.equal((await state()).publishing, true);

      await pool.query(`UPDATE publications SET state = 'published' WHERE id = $1`, [publication.id]);
      assert.equal((await state()).publishing, false);
      assert.doesNotMatch(await page(), /data-publish-watch=/);
    });
  });
});
