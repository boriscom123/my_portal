// Шаг рисования обложки и выбор между обложками. Кадр из записи никуда не
// девается: возвращаться к нему перерисовкой значило бы тратить минуту машины
// на то, что уже лежит в буфере.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { makeMakeCoverImage } from '../src/jobs/make-cover-image.js';
import { saveLesson } from '../src/services/lessons.js';
import { registerAsset } from '../src/services/media.js';
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
    media: { dir: await mkdtemp(path.join(tmpdir(), 'portal-cover-')), ttlHours: 168 }
  };
}

async function seed(pool, config) {
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Портал на VPS' });
  await mkdir(path.join(config.media.dir, `lesson-${lesson.id}`), { recursive: true });
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  return {
    lesson,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'admin' }, config.jwtSecret)}`
    }
  };
}

const drawing = {
  generate: async () => ({
    bytes: Buffer.from('нарисованная картинка'),
    mimeType: 'image/png',
    model: 'gemini-3-pro-image'
  })
};

test('нарисованная обложка ложится в буфер и в карточку', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson } = await seed(pool, config);
    const result = await makeMakeCoverImage(config, pool, drawing)({ lessonId: lesson.id });

    const file = await readFile(
      path.join(config.media.dir, `lesson-${lesson.id}/cover-drawn.png`)
    );
    assert.equal(file.toString(), 'нарисованная картинка');

    const { rows } = await pool.query('SELECT cover_url FROM lessons WHERE id = $1', [lesson.id]);
    assert.equal(rows[0].cover_url, `/media/asset/${result.assetId}`);
  });
});

test('без заголовка рисовать не по чему', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'pustoj', title: '' });
    await assert.rejects(
      makeMakeCoverImage(config, pool, drawing)({ lessonId: lesson.id }),
      /заголовка/
    );
  });
});

test('без настроенного рисования шаг говорит об этом внятно', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson } = await seed(pool, config);
    await assert.rejects(
      makeMakeCoverImage(config, pool, null)({ lessonId: lesson.id }),
      /не настроено/
    );
  });
});

test('повтор заменяет картинку, а не копит их в буфере', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson } = await seed(pool, config);
    const job = makeMakeCoverImage(config, pool, drawing);
    await job({ lessonId: lesson.id });
    await job({ lessonId: lesson.id });
    const { rows } = await pool.query(
      `SELECT count(*)::int n FROM assets WHERE lesson_id = $1 AND kind = 'cover'`,
      [lesson.id]
    );
    assert.equal(rows[0].n, 1);
  });
});

test('автор возвращает кадр из записи одним нажатием', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    const frame = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'cover',
      relativePath: `lesson-${lesson.id}/cover.jpg`,
      bytes: 10
    });
    await makeMakeCoverImage(config, pool, drawing)({ lessonId: lesson.id });

    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons/urok/cover/${frame.id}`, {
        method: 'POST',
        headers
      });
      assert.equal(res.status, 200);
    });
    // Перерисовывать ради возврата к кадру значило бы тратить минуту машины на
    // то, что уже лежит в буфере.
    const { rows } = await pool.query('SELECT cover_url FROM lessons WHERE id = $1', [lesson.id]);
    assert.equal(rows[0].cover_url, `/media/asset/${frame.id}`);
  });
});

test('обложкой не назначить чужой файл', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    const other = await saveLesson(pool, { slug: 'drugoj', title: 'Другой' });
    const alien = await registerAsset(pool, config, {
      lessonId: other.id,
      kind: 'cover',
      relativePath: `lesson-${other.id}/cover.jpg`,
      bytes: 10
    });
    const source = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'source',
      relativePath: `lesson-${lesson.id}/source.mp4`,
      bytes: 10
    });

    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      for (const id of [alien.id, source.id]) {
        const res = await fetch(`${base}/api/admin/lessons/urok/cover/${id}`, {
          method: 'POST',
          headers
        });
        assert.equal(res.status, 404, `назначился файл ${id}`);
      }
    });
  });
});

test('удалённая обложка исчезает и с диска, и из учёта', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    const { writeFile } = await import('node:fs/promises');
    const relative = `lesson-${lesson.id}/cover-uploaded.png`;
    await writeFile(path.join(config.media.dir, relative), Buffer.from('картинка'));
    const asset = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'cover',
      relativePath: relative,
      bytes: 8
    });

    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons/urok/cover/${asset.id}`, {
        method: 'DELETE',
        headers
      });
      assert.equal(res.status, 200);
    });

    const { stat } = await import('node:fs/promises');
    await assert.rejects(stat(path.join(config.media.dir, relative)), 'файл остался на диске');
    const { rows } = await pool.query('SELECT count(*)::int n FROM assets WHERE id = $1', [
      asset.id
    ]);
    assert.equal(rows[0].n, 0);
  });
});

test('удаление выбранной обложки ставит другую', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    const frame = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'cover',
      relativePath: `lesson-${lesson.id}/cover.jpg`,
      bytes: 10
    });
    // Нарисованная становится выбранной, и её же удаляем.
    const drawn = await makeMakeCoverImage(config, pool, drawing)({ lessonId: lesson.id });

    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      await fetch(`${base}/api/admin/lessons/urok/cover/${drawn.assetId}`, {
        method: 'DELETE',
        headers
      });
    });
    // Иначе карточка урока показывала бы битую картинку, а превью ссылки
    // приходило бы пустым.
    const { rows } = await pool.query('SELECT cover_url FROM lessons WHERE id = $1', [lesson.id]);
    assert.equal(rows[0].cover_url, `/media/asset/${frame.id}`);
  });
});

test('удаление последней обложки оставляет урок без неё, а не со ссылкой в пустоту', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    const only = await makeMakeCoverImage(config, pool, drawing)({ lessonId: lesson.id });

    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      await fetch(`${base}/api/admin/lessons/urok/cover/${only.assetId}`, {
        method: 'DELETE',
        headers
      });
    });
    const { rows } = await pool.query('SELECT cover_url FROM lessons WHERE id = $1', [lesson.id]);
    // Витрина рисует на месте пропавшей обложки фирменный градиент — это
    // честнее, чем ссылка на удалённый файл.
    assert.equal(rows[0].cover_url, null);
  });
});

test('удалить исходник или чужую обложку этим маршрутом нельзя', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    const source = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'source',
      relativePath: `lesson-${lesson.id}/source.mp4`,
      bytes: 10
    });
    const other = await saveLesson(pool, { slug: 'drugoj', title: 'Другой' });
    const alien = await registerAsset(pool, config, {
      lessonId: other.id,
      kind: 'cover',
      relativePath: `lesson-${other.id}/cover.jpg`,
      bytes: 10
    });

    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      for (const id of [source.id, alien.id]) {
        const res = await fetch(`${base}/api/admin/lessons/urok/cover/${id}`, {
          method: 'DELETE',
          headers
        });
        assert.equal(res.status, 404, `удалился файл ${id}`);
      }
    });
    const { rows } = await pool.query('SELECT count(*)::int n FROM assets');
    assert.equal(rows[0].n, 2, 'ни один файл удалиться не должен был');
  });
});

test('отказ рисования показывается один раз и уходит', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    await pool.query(
      `UPDATE lessons SET generated = jsonb_set(generated, '{sideError}', $1::jsonb) WHERE id = $2`,
      [JSON.stringify({ step: 'makeCoverImage', message: 'квота исчерпана' }), lesson.id]
    );

    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const page = () =>
        fetch(`${base}/admin/lesson/urok`, {
          headers: { Accept: 'text/html', ...headers }
        }).then((response) => response.text());

      // Первый заход после попытки — отказ виден.
      assert.match(await page(), /Нарисовать не вышло: квота исчерпана/);
      // Второй — уже нет: иначе красная надпись про чужую квоту встречает
      // автора при каждом заходе, хотя нажимал он однажды.
      assert.ok(!(await page()).includes('Нарисовать не вышло'));
    });
  });
});

test('новая попытка не показывает прошлый отказ как свежий', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    await pool.query(
      `UPDATE lessons SET generated = jsonb_set(generated, '{sideError}', $1::jsonb) WHERE id = $2`,
      [JSON.stringify({ step: 'makeCoverImage', message: 'старый отказ' }), lesson.id]
    );

    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons/urok/cover-image`, {
        method: 'POST',
        headers
      });
      assert.equal(res.status, 200);
    });
    const { rows } = await pool.query(
      `SELECT generated ? 'sideError' AS has FROM lessons WHERE id = $1`,
      [lesson.id]
    );
    assert.equal(rows[0].has, false);
  });
});
