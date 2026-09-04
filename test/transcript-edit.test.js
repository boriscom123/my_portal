// Правка титров и заполнение полей из расшифровки. Распознавание ошибается в
// именах и терминах, и правит их автор — здесь же, а не перезаписью субтитров
// руками в скачанном файле.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveLesson } from '../src/services/lessons.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

async function makeConfig() {
  const dir = await mkdtemp(path.join(tmpdir(), 'portal-tr-edit-'));
  return {
    publicBaseUrl: 'https://soloaijourney.online',
    jwtSecret: 'x'.repeat(32),
    adminIdentities: [],
    telegram: { botToken: '', botId: '', botUsername: '' },
    google: { clientId: '', clientSecret: '' },
    vapid: { publicKey: '', privateKey: '', subject: '' },
    media: { dir, ttlHours: 168 }
  };
}

async function seed(pool, config) {
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Черновик' });
  await mkdir(path.join(config.media.dir, `lesson-${lesson.id}`), { recursive: true });
  await pool.query(
    `INSERT INTO transcripts (lesson_id, text, provider)
     VALUES ($1, 'Разбираем докер компоуз сегодня', 'whisper.cpp')`,
    [lesson.id]
  );
  const { rows } = await pool.query(
    `INSERT INTO transcript_segments (lesson_id, started_ms, ended_ms, text) VALUES
       ($1, 0, 3000, 'Разбираем докер компоуз'),
       ($1, 3000, 6000, 'сегодня')
     RETURNING id`,
    [lesson.id]
  );
  const { rows: users } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  return {
    lesson,
    segmentIds: rows.map((row) => Number(row.id)),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${signSession({ userId: Number(users[0].id), role: 'admin' }, config.jwtSecret)}`
    }
  };
}

test('правка титра переписывает и субтитры', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, segmentIds, headers } = await seed(pool, config);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons/urok/transcript`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ segments: [{ id: segmentIds[0], text: 'Разбираем Docker Compose' }] })
      });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).changed, 1);
    });

    // Иначе автор правит титры, скачивает файл и получает старый текст —
    // и обнаруживает это уже на площадке.
    const srt = await readFile(
      path.join(config.media.dir, `lesson-${lesson.id}/subtitles.srt`),
      'utf8'
    );
    assert.match(srt, /Docker Compose/);
    assert.ok(!srt.includes('докер компоуз'));
  });
});

test('цельный текст расшифровки идёт следом за репликами', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, segmentIds, headers } = await seed(pool, config);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      await fetch(`${base}/api/admin/lessons/urok/transcript`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ segments: [{ id: segmentIds[0], text: 'Разбираем Docker Compose' }] })
      });
    });
    // По цельному тексту идёт заполнение полей и поиск: разойдясь с репликами,
    // он выдавал бы в заголовок то, чего в уроке уже нет.
    const { rows } = await pool.query('SELECT text FROM transcripts WHERE lesson_id = $1', [
      lesson.id
    ]);
    assert.match(rows[0].text, /Docker Compose/);
  });
});

test('пустая реплика не принимается', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { segmentIds, headers } = await seed(pool, config);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons/urok/transcript`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ segments: [{ id: segmentIds[0], text: '   ' }] })
      });
      // Пустая реплика — это дыра в субтитрах на её месте.
      assert.equal((await res.json()).changed, 0);
    });
  });
});

test('чужую реплику через свой урок не поправить', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { headers } = await seed(pool, config);
    const other = await saveLesson(pool, { slug: 'drugoj', title: 'Другой' });
    const { rows } = await pool.query(
      `INSERT INTO transcript_segments (lesson_id, started_ms, ended_ms, text)
       VALUES ($1, 0, 1000, 'чужая реплика') RETURNING id`,
      [other.id]
    );
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons/urok/transcript`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ segments: [{ id: Number(rows[0].id), text: 'подмена' }] })
      });
      assert.equal((await res.json()).changed, 0);
    });
    const { rows: after } = await pool.query('SELECT text FROM transcript_segments WHERE id = $1', [
      rows[0].id
    ]);
    assert.equal(after[0].text, 'чужая реплика');
  });
});

test('пока заготовки нет, ответ говорит «ждите»', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { headers } = await seed(pool, config);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons/urok/suggest`, { headers });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).pending, true);
    });
  });
});

test('готовая заготовка отдаётся как есть', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    await pool.query(
      `UPDATE lessons SET generated = jsonb_set(generated, '{suggested}', $1::jsonb) WHERE id = $2`,
      [JSON.stringify({ title: 'Т', description: 'О', tags: ['docker'], source: 'model' }), lesson.id]
    );
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const body = await (await fetch(`${base}/api/admin/lessons/urok/suggest`, { headers })).json();
      assert.equal(body.title, 'Т');
      assert.equal(body.source, 'model');
    });
  });
});

test('запуск ставит задачу и стирает прошлую заготовку', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    await pool.query(
      `UPDATE lessons SET generated = jsonb_set(generated, '{suggested}', $1::jsonb) WHERE id = $2`,
      [JSON.stringify({ title: 'старая' }), lesson.id]
    );
    const added = [];
    const app = finalize(
      createApp({ config, pool, queue: { add: async (name, data) => added.push({ name, data }) } })
    );
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons/urok/suggest`, {
        method: 'POST',
        headers
      });
      assert.equal(res.status, 200);
    });
    assert.equal(added[0].name, 'suggestTexts');
    // Иначе клиент, спрашивая готовность, получит старую и решит, что новая
    // готова.
    const { rows } = await pool.query(
      `SELECT generated->'suggested' AS suggested FROM lessons WHERE id = $1`,
      [lesson.id]
    );
    assert.equal(rows[0].suggested, null);
  });
});

test('без расшифровки заполнять нечего, и это сказано', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { headers } = await seed(pool, config);
    await pool.query('DELETE FROM transcripts');
    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons/urok/suggest`, {
        method: 'POST',
        headers
      });
      assert.equal(res.status, 409);
      assert.match((await res.json()).error, /расшифровк/i);
    });
  });
});

test('отказ модели оставляет автору заготовку, а не пустоту', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson } = await seed(pool, config);
    const { makeSuggestTexts } = await import('../src/jobs/suggest-texts.js');
    const failing = {
      suggest: async () => {
        throw new Error('высокий спрос');
      }
    };
    const result = await makeSuggestTexts(config, pool, failing)({ lessonId: lesson.id });

    assert.equal(result.source, 'transcript');
    const { rows } = await pool.query(
      `SELECT generated->'suggested' AS suggested FROM lessons WHERE id = $1`,
      [lesson.id]
    );
    assert.ok(rows[0].suggested.title, 'поля должны быть заполнены хоть чем-то');
    assert.match(rows[0].suggested.warning, /высокий спрос/);
  });
});

test('посторонний титры не правит', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { segmentIds } = await seed(pool, config);
    const { rows } = await pool.query(
      `INSERT INTO users (display_name, role) VALUES ('Зритель', 'user') RETURNING id`
    );
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons/urok/transcript`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'user' }, config.jwtSecret)}`
        },
        body: JSON.stringify({ segments: [{ id: segmentIds[0], text: 'подмена' }] })
      });
      assert.equal(res.status, 403);
    });
  });
});
