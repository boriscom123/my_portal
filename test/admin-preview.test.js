// Просмотр записи с субтитрами. Автор должен увидеть, как подписи ложатся на
// запись, до того как урок уйдёт на площадки — и не скачивая ради этого
// полгигабайта.
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
  media: { dir: '/tmp', ttlHours: 168 }
};

async function seed(pool, { withSubtitles = true } = {}) {
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
  const source = await registerAsset(pool, config, {
    lessonId: lesson.id,
    kind: 'source',
    relativePath: 'urok/source.mp4',
    bytes: 100
  });
  await pool.query('UPDATE lessons SET source_asset_id = $1 WHERE id = $2', [source.id, lesson.id]);
  // Старая запись того же урока: при повторной загрузке она остаётся в буфере
  // до истечения срока, и плеер однажды открыл именно её.
  await registerAsset(pool, config, {
    lessonId: lesson.id,
    kind: 'source',
    relativePath: 'urok/staryj.mov',
    bytes: 100
  });
  if (withSubtitles) {
    for (const name of ['subtitles.srt', 'subtitles.vtt']) {
      await registerAsset(pool, config, {
        lessonId: lesson.id,
        kind: 'subtitles',
        relativePath: `urok/${name}`,
        bytes: 10
      });
    }
  }
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  return {
    headers: {
      Accept: 'text/html',
      Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'admin' }, config.jwtSecret)}`
    }
  };
}

test('плеер получает запись и дорожку субтитров', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { headers } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (await fetch(`${base}/admin/lesson/urok/preview`, { headers })).text();
      assert.match(html, /<video/);
      assert.match(html, /<track kind="subtitles"/);
      // Ссылки подписанные и временные: буфер по прямому адресу наружу не
      // смотрит даже автору.
      const links = [...html.matchAll(/https:\/\/soloaijourney\.online\/media\/([\w.-]+)/g)];
      assert.equal(links.length, 2, 'нужны две ссылки: запись и субтитры');
      assert.notEqual(links[0][1], links[1][1], 'ссылки должны вести на разные файлы');
      assert.ok(!html.includes('staryj.mov'), 'открылась старая запись вместо текущей');
    });
  });
});

test('в плеер идёт vtt, а не srt', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { headers } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (await fetch(`${base}/admin/lesson/urok/preview`, { headers })).text();
      // Браузеры понимают только vtt; от srt он отличается одним знаком в
      // записи времени, и подписи просто не появятся.
      const track = html.match(/<track[^>]*src="([^"]+)"/)[1];
      const { rows } = await pool.query(
        `SELECT path FROM assets WHERE kind = 'subtitles' AND path LIKE '%.vtt'`
      );
      assert.equal(rows.length, 1);
      assert.ok(track.includes('/media/'), 'дорожка должна идти по временной ссылке');
    });
  });
});

test('без субтитров страница показывает запись и говорит об этом', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { headers } = await seed(pool, { withSubtitles: false });
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (await fetch(`${base}/admin/lesson/urok/preview`, { headers })).text();
      assert.match(html, /<video/);
      assert.ok(!html.includes('<track'));
      assert.match(html, /Субтитров ещё нет/);
    });
  });
});

test('посторонний запись не смотрит', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    const { rows } = await pool.query(
      `INSERT INTO users (display_name, role) VALUES ('Зритель', 'user') RETURNING id`
    );
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/admin/lesson/urok/preview`, {
        headers: {
          Accept: 'text/html',
          Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'user' }, config.jwtSecret)}`
        }
      });
      assert.equal(res.status, 403);
    });
  });
});
