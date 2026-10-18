// Урок с титрами, вшитыми в видео при монтаже (CapCut).
//
// Беда, от которой защищаемся, одна — две строки титров на кадре: свои поверх
// вшитых в плеере и вертикальные ролики, где вшитые к тому же обрезаны по
// краям. И второе: экраны должны говорить автору, откуда взялась расшифровка.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveLesson } from '../src/services/lessons.js';
import { registerAsset } from '../src/services/media.js';
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

/** Урок с записью, субтитрами и репликой; вшиты ли титры — доводом. */
async function seed(pool, { burned = false, provider = 'srt' } = {}) {
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок из CapCut' });
  await pool.query('UPDATE lessons SET settings = $1::jsonb WHERE id = $2', [
    JSON.stringify({ burnedSubtitles: burned }),
    lesson.id
  ]);
  const source = await registerAsset(pool, config, {
    lessonId: lesson.id,
    kind: 'source',
    relativePath: `lesson-${lesson.id}/source.mp4`,
    bytes: 100
  });
  await pool.query('UPDATE lessons SET source_asset_id = $1 WHERE id = $2', [source.id, lesson.id]);
  await registerAsset(pool, config, {
    lessonId: lesson.id,
    kind: 'subtitles',
    relativePath: `lesson-${lesson.id}/subtitles.vtt`,
    bytes: 10
  });
  await pool.query(`INSERT INTO transcripts (lesson_id, text, provider) VALUES ($1, 'текст', $2)`, [
    lesson.id,
    provider
  ]);
  await pool.query(
    `INSERT INTO transcript_segments (lesson_id, started_ms, ended_ms, text) VALUES ($1, 0, 1000, 'текст')`,
    [lesson.id]
  );
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  const headers = {
    Accept: 'text/html',
    Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'admin' }, config.jwtSecret)}`
  };
  return { lessonId: Number(lesson.id), headers };
}

async function page(pool, headers, url) {
  const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));
  return withServer(app, async (base) => {
    const res = await fetch(`${base}${url}`, { headers });
    return { status: res.status, body: await res.text() };
  });
}

test('вшитые титры: в предпросмотре дорожка есть, но не включена', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { headers } = await seed(pool, { burned: true });
    const { body } = await page(pool, headers, '/admin/lesson/urok/preview');
    assert.match(body, /<track kind="subtitles"/);
    assert.doesNotMatch(body, /<track[^>]*\bdefault\b/);
  });
});

test('без вшитых титров дорожка в предпросмотре включена', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { headers } = await seed(pool, { burned: false });
    const { body } = await page(pool, headers, '/admin/lesson/urok/preview');
    assert.match(body, /<track[^>]*\bdefault\b/);
  });
});

test('урока с вшитыми титрами нет в выборе для нарезки', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { headers } = await seed(pool, { burned: true });
    const list = await page(pool, headers, '/shorts/new');
    assert.doesNotMatch(list.body, /Урок из CapCut/);

    // По старой ссылке урок открывается, но без кнопки сборки.
    const chosen = await page(pool, headers, '/shorts/new?lesson=urok');
    assert.doesNotMatch(chosen.body, /data-clips=/);
    assert.match(chosen.body, /Ролики из него не режутся/);
  });
});

test('нарезку урока с вшитыми титрами сервер не запускает', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { headers } = await seed(pool, { burned: true });
    const added = [];
    const app = finalize(
      createApp({ config, pool, queue: { add: async (name) => added.push(name) } })
    );
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons/urok/clips`, {
        method: 'POST',
        headers: { ...headers, Accept: 'application/json' }
      });
      assert.equal(res.status, 409);
      assert.match((await res.json()).error, /вшиты/);
    });
    assert.deepEqual(added, []);
  });
});

test('экран урока говорит, что расшифровка из файла, и даёт её убрать', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { headers, lessonId } = await seed(pool, { provider: 'srt' });
    const { body } = await page(pool, headers, '/admin/lesson/urok');
    assert.match(body, new RegExp(`data-imported-subtitles="${lessonId}"`));
    assert.match(body, /взята из загруженного файла титров/);
    assert.match(body, /data-subtitles-remove/);
    assert.match(body, /речь распознаваться не будет/);
  });
});

test('у расшифровки от whisper кнопки «убрать» нет, а приложить файл можно', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { headers } = await seed(pool, { provider: 'whisper.cpp' });
    const { body } = await page(pool, headers, '/admin/lesson/urok');
    assert.match(body, /data-subtitles-file/);
    assert.doesNotMatch(body, /data-subtitles-remove/);
  });
});

test('страница загрузки урока предлагает файл титров и отметку «вшиты»', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { headers, lessonId } = await seed(pool, { burned: true });
    const { body } = await page(pool, headers, '/admin/upload?lesson=urok');
    assert.match(body, new RegExp(`data-imported-subtitles="${lessonId}"`));
    assert.match(body, /<input type="checkbox" data-burned-subtitles checked>/);
  });
});
