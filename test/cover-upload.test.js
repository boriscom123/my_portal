// Загрузка обложки с компьютера. Вид файла определяется по его первым байтам,
// а не по тому, что заявил браузер: обложка потом отдаётся всем подряд.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { imageTypeOf } from '../src/lib/image-type.js';
import { saveLesson } from '../src/services/lessons.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

/** Настоящие подписи форматов — те самые байты, по которым их узнают все. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7)
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4, 0),
  Buffer.from('WEBP'),
  Buffer.alloc(64, 7)
]);

async function makeConfig() {
  return {
    publicBaseUrl: 'https://soloaijourney.online',
    jwtSecret: 'x'.repeat(32),
    adminIdentities: [],
    telegram: { botToken: '', botId: '', botUsername: '' },
    google: { clientId: '', clientSecret: '' },
    vapid: { publicKey: '', privateKey: '', subject: '' },
    media: { dir: await mkdtemp(path.join(tmpdir(), 'portal-up-')), ttlHours: 168 }
  };
}

async function seed(pool, config) {
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  return {
    lesson,
    headers: {
      Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'admin' }, config.jwtSecret)}`
    }
  };
}

test('вид картинки узнаётся по подписи, а не по расширению', () => {
  assert.equal(imageTypeOf(PNG), 'png');
  assert.equal(imageTypeOf(JPEG), 'jpg');
  assert.equal(imageTypeOf(WEBP), 'webp');
  // Заголовок и расширение задаёт отправляющая сторона: назвать «.png» можно
  // что угодно, и такое мы не примем.
  assert.equal(imageTypeOf(Buffer.from('<html>обманка</html>')), null);
  assert.equal(imageTypeOf(Buffer.alloc(4)), null, 'слишком короткий файл');
  assert.equal(imageTypeOf(null), null);
});

test('загруженная картинка становится обложкой урока', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/upload/cover/urok`, {
        method: 'PUT',
        headers,
        body: PNG
      });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).type, 'png');
    });

    const file = await readFile(
      path.join(config.media.dir, `lesson-${lesson.id}/cover-uploaded.png`)
    );
    assert.equal(file.length, PNG.length);
    const { rows } = await pool.query('SELECT cover_url FROM lessons WHERE id = $1', [lesson.id]);
    assert.match(rows[0].cover_url, /^\/media\/asset\/\d+$/);
  });
});

test('не картинка не принимается', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { headers } = await seed(pool, config);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/upload/cover/urok`, {
        method: 'PUT',
        // Браузер честно назвал бы это картинкой, если бы мы ему верили.
        headers: { ...headers, 'Content-Type': 'image/png' },
        body: Buffer.from('<html>обманка</html>')
      });
      assert.equal(res.status, 415);
    });
  });
});

test('вторая загрузка заменяет первую, а не копится в буфере', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      for (const bytes of [PNG, PNG]) {
        await fetch(`${base}/api/upload/cover/urok`, { method: 'PUT', headers, body: bytes });
      }
    });
    const { rows } = await pool.query(
      `SELECT count(*)::int n FROM assets WHERE lesson_id = $1 AND kind = 'cover'`,
      [lesson.id]
    );
    assert.equal(rows[0].n, 1);
  });
});

test('слишком большой файл отклоняется', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { headers } = await seed(pool, config);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/upload/cover/urok`, {
        method: 'PUT',
        headers,
        // Одиннадцать мегабайт — это уже не обложка, а способ занять диск.
        body: Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024, 1)])
      });
      assert.equal(res.status, 413);
    });
  });
});

test('посторонний обложку не подменяет', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    await seed(pool, config);
    const { rows } = await pool.query(
      `INSERT INTO users (display_name, role) VALUES ('Зритель', 'user') RETURNING id`
    );
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/upload/cover/urok`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'user' }, config.jwtSecret)}`
        },
        body: PNG
      });
      assert.equal(res.status, 403);
    });
  });
});
