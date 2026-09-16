// Кнопка «Загрузить видео в Telegram» на экране урока.
//
// Заказчик 2026-09-16: долгую загрузку делает автор один раз, а зрители потом
// получают то же видео мгновенно. Кнопка только ставит задачу: загрузка идёт
// минуты, а запрос через nginx рвётся на шестидесяти секундах.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveLesson } from '../src/services/lessons.js';
import { registerAsset } from '../src/services/media.js';
import { rememberTelegramFile } from '../src/services/telegram-files.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://portal.example',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '1:aa', botId: '1', botUsername: 'portal_bot', apiUrl: '' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: '' },
  redis: { url: 'redis://redis:6379', prefix: 'portal:' },
  yandex: { apiKey: '', folderId: '' },
  yandexOauth: { clientId: '', clientSecret: '' },
  tokenEncryptionKey: 'a'.repeat(64),
  media: { dir: '/tmp', ttlHours: 168 },
  youtube: { clientId: '', clientSecret: '', redirectUri: '/back', mode: 'semi' }
};

async function seed(pool, { recording = true } = {}) {
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок про портал' });
  let asset = null;
  if (recording) {
    asset = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'source',
      relativePath: `lesson-${lesson.id}/source.mp4`,
      bytes: 250 * 1024 * 1024
    });
  }
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'admin' }, config.jwtSecret)}`
  };
  return { lesson, asset, headers };
}

test('кнопка ставит загрузку в очередь, без записи — отказ словами', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool);
    const added = [];
    const app = finalize(
      createApp({ config, pool, queue: { add: async (name, data) => added.push({ name, data }) } })
    );

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/admin/lessons/urok/telegram-video`, {
        method: 'POST',
        headers
      });
      assert.equal(response.status, 200);
      assert.deepEqual(added, [{ name: 'uploadLessonVideo', data: { lessonId: lesson.id } }]);
    });
  });

  await withTestDb(async (pool) => {
    const { headers } = await seed(pool, { recording: false });
    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));
    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/admin/lessons/urok/telegram-video`, {
        method: 'POST',
        headers
      });
      assert.equal(response.status, 409);
      assert.match((await response.json()).error, /Записи/);
    });
  });
});

test('на экране урока видно, загружено видео или ещё нет', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { asset, headers } = await seed(pool);
    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));

    await withServer(app, async (base) => {
      const page = async () =>
        (await fetch(`${base}/admin/lesson/urok`, { headers: { ...headers, Accept: 'text/html' } })).text();

      const before = await page();
      assert.match(before, /data-telegram-video="urok"/, 'кнопки загрузки нет');
      assert.doesNotMatch(before, /t\.me\/portal_bot\?start=/, 'ссылка ведёт в никуда: файла ещё нет');

      await rememberTelegramFile(pool, asset.id, 'BAACAgIAAxkBAAI');
      const after = await page();
      // Ссылка появляется только когда файл на площадке уже есть.
      assert.match(after, /t\.me\/portal_bot\?start=l\d+/);
    });
  });
});
