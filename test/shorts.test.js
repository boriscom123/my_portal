// Раздел коротких вертикальных роликов.
//
// Два источника содержимого — нарезка из урока и файл, снятый отдельно, — и
// главное здесь в том, чтобы первый не отбирал файл у урока, а второй не
// оказался чем-то, что площадки не возьмут.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveLesson } from '../src/services/lessons.js';
import { registerAsset, assetById } from '../src/services/media.js';
import {
  saveShort,
  publishShort,
  deleteShort,
  listShorts,
  getShortBySlug,
  shortFromClip,
  setShortFile,
  shortsOfLesson
} from '../src/services/shorts.js';
import { startPublication, shortPublications } from '../src/services/publications.js';
import { makePublishChannel } from '../src/jobs/publish-channel.js';
import { savePlatformApp } from '../src/services/platform-apps.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const hasFfmpeg = await new Promise((resolve) => {
  const child = spawn('ffmpeg', ['-version']);
  child.on('error', () => resolve(false));
  child.on('close', (code) => resolve(code === 0));
});

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
  media: { dir: '/tmp/portal-shorts-test', ttlHours: 168 },
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

async function connectChannel(pool, name = 'telegram') {
  await savePlatformApp(pool, config, {
    name,
    clientId: '',
    clientSecret: 'bot-token',
    mode: 'auto',
    settings: { channel: '@kanal' }
  });
}

function adapterStub() {
  const videos = [];
  return {
    videos,
    app: async () => ({ configured: true, token: 't', channel: '@kanal' }),
    post: async () => ({ messageId: '1', url: null }),
    postVideo: async (args) => (videos.push(args), { messageId: '9', url: 'https://t.me/kanal/9' }),
    edit: async () => {}
  };
}

/** Урок с готовой нарезкой — то, из чего делается ролик. */
async function lessonWithClip(pool) {
  const lesson = await saveLesson(pool, {
    slug: 'urok',
    title: 'Урок про портал',
    status: 'published',
    publishedAt: new Date('2026-09-01T10:00:00Z')
  });
  const relative = 'lesson-1/clip-1.mp4';
  // Файл настоящий, пусть и пустой: отдача проверяет не только права, но и то,
  // что портал действительно отдаёт файл, а не спотыкается о его отсутствие.
  await mkdir(path.join(config.media.dir, 'lesson-1'), { recursive: true });
  await writeFile(path.join(config.media.dir, relative), 'не видео, но файл');

  const clip = await registerAsset(pool, config, {
    lessonId: lesson.id,
    kind: 'clip',
    relativePath: relative,
    bytes: 5 * 1024 * 1024
  });
  return { lesson, clip };
}

test('нарезка становится роликом, а файл остаётся за уроком', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, clip } = await lessonWithClip(pool);
    const short = await shortFromClip(pool, {
      assetId: clip.id,
      lesson,
      title: 'Урок про портал — фрагмент 1'
    });

    assert.equal(short.assetId, clip.id);
    assert.equal(short.lessonId, lesson.id);

    // Файл остаётся файлом урока: отбери мы его — нарезка исчезла бы с экрана
    // урока, где автор её и смотрит.
    const asset = await assetById(pool, clip.id);
    assert.equal(asset.lessonId, lesson.id);
    // И перестаёт стареть: у нарезки срок как у исходника, а на неё теперь
    // смотрит зритель.
    assert.equal(asset.expiresAt, null);
  });
});

test('из одной нарезки второй ролик не заводится', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, clip } = await lessonWithClip(pool);
    await shortFromClip(pool, { assetId: clip.id, lesson, title: 'Первый' });
    // Иначе в разделе окажутся близнецы, и какой из них отправлен в канал —
    // не разобрать.
    assert.equal(await shortFromClip(pool, { assetId: clip.id, lesson, title: 'Второй' }), null);
    assert.equal((await shortsOfLesson(pool, lesson.id)).length, 1);
  });
});

test('черновика нет ни в разделе, ни по ссылке, ни файлом', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, clip } = await lessonWithClip(pool);
    const short = await shortFromClip(pool, { assetId: clip.id, lesson, title: 'Черновик' });
    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));

    await withServer(app, async (base) => {
      assert.doesNotMatch(await (await fetch(`${base}/shorts`)).text(), /Черновик/);
      assert.equal((await fetch(`${base}/short/${short.slug}`)).status, 404);
      // Прямая ссылка на файл обходила бы черновик — поэтому и она закрыта.
      assert.equal((await fetch(`${base}/media/asset/${clip.id}`)).status, 404);

      await publishShort(pool, short.slug);
      assert.equal((await fetch(`${base}/short/${short.slug}`)).status, 200);
      assert.equal((await fetch(`${base}/media/asset/${clip.id}`)).status, 200);
    });
  });
});

test('выпуск ставит дату один раз', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const short = await saveShort(pool, { title: 'Ролик' });
    const first = await publishShort(pool, short.slug);
    await publishShort(pool, short.slug, false);
    const again = await publishShort(pool, short.slug);
    assert.equal(
      new Date(again.publishedAt).getTime(),
      new Date(first.publishedAt).getTime()
    );
  });
});

test('в подписи поста — ссылка на ролик и на урок целиком', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, clip } = await lessonWithClip(pool);
    const short = await shortFromClip(pool, { assetId: clip.id, lesson, title: 'Фрагмент' });
    await saveShort(pool, { slug: short.slug, title: 'Фрагмент', description: 'О чём это' });
    await publishShort(pool, short.slug);

    const { id: publicationId } = await startPublication(pool, {
      shortId: short.id,
      platform: 'telegram',
      mode: 'auto'
    });
    const adapter = adapterStub();
    await makePublishChannel(config, pool, 'telegram', adapter)({
      shortId: short.id,
      publicationId
    });

    const [sent] = adapter.videos;
    assert.match(sent.caption, /Фрагмент/);
    assert.match(sent.caption, /О чём это/);
    assert.match(sent.caption, new RegExp(`https://portal.example/short/${short.slug}`));
    // Ссылка на полный урок — то, ради чего короткий ролик и режется.
    assert.match(sent.caption, /Урок целиком: https:\/\/portal\.example\/lesson\/urok/);
    assert.match(sent.filePath, /clip-1\.mp4$/);

    const [publication] = await shortPublications(pool, short.id);
    assert.equal(publication.state, 'published');
    assert.equal(publication.externalId, '9');
  });
});

test('у ролика без урока ссылки на урок в подписи нет', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const short = await saveShort(pool, { title: 'Свой ролик' });
    const asset = await registerAsset(pool, config, {
      shortId: short.id,
      kind: 'vertical',
      relativePath: `short-${short.id}/vertical.mp4`,
      bytes: 1024
    });
    await setShortFile(pool, short.id, { assetId: asset.id });
    await publishShort(pool, short.slug);

    const { id: publicationId } = await startPublication(pool, {
      shortId: short.id,
      platform: 'max',
      mode: 'auto'
    });
    const adapter = adapterStub();
    await makePublishChannel(config, pool, 'max', adapter)({ shortId: short.id, publicationId });

    assert.doesNotMatch(adapter.videos[0].caption, /Урок целиком/);
  });
});

test('слишком тяжёлый ролик не уезжает, и причина названа заранее', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const short = await saveShort(pool, { title: 'Тяжёлый' });
    const asset = await registerAsset(pool, config, {
      shortId: short.id,
      kind: 'vertical',
      relativePath: `short-${short.id}/vertical.mp4`,
      // Больше телеграмовских пятидесяти мегабайт, но меньше максовских 250.
      bytes: 120 * 1024 * 1024
    });
    await setShortFile(pool, short.id, { assetId: asset.id });
    await publishShort(pool, short.slug);

    const { id: publicationId } = await startPublication(pool, {
      shortId: short.id,
      platform: 'telegram',
      mode: 'auto'
    });
    const adapter = adapterStub();

    await assert.rejects(
      makePublishChannel(config, pool, 'telegram', adapter)({ shortId: short.id, publicationId }),
      /120 МБ.*не больше 50 МБ/
    );
    // Отказ до отправки: ответ площадки пришёл бы после того, как файл уже
    // уехал по сети.
    assert.equal(adapter.videos.length, 0);
    const [publication] = await shortPublications(pool, short.id);
    assert.equal(publication.state, 'failed');
  });
});

test('черновик в канал не уходит, даже если задачу поставили', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, clip } = await lessonWithClip(pool);
    const short = await shortFromClip(pool, { assetId: clip.id, lesson, title: 'Черновик' });
    const { id: publicationId } = await startPublication(pool, {
      shortId: short.id,
      platform: 'telegram',
      mode: 'auto'
    });
    const adapter = adapterStub();

    await assert.rejects(
      makePublishChannel(config, pool, 'telegram', adapter)({ shortId: short.id, publicationId }),
      /черновик/i
    );
    assert.equal(adapter.videos.length, 0);
  });
});

test('удаление ролика не уносит нарезку урока', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, clip } = await lessonWithClip(pool);
    const short = await shortFromClip(pool, { assetId: clip.id, lesson, title: 'Фрагмент' });

    assert.equal(await deleteShort(pool, short.slug), true);
    const asset = await assetById(pool, clip.id);
    assert.ok(asset, 'нарезка принадлежит уроку, и ролик ей не хозяин');
    assert.equal(asset.lessonId, lesson.id);
  });
});

test('удаление ролика уносит его собственные файлы', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const short = await saveShort(pool, { title: 'Свой ролик' });
    const asset = await registerAsset(pool, config, {
      shortId: short.id,
      kind: 'vertical',
      relativePath: `short-${short.id}/vertical.mp4`,
      bytes: 1024
    });
    await setShortFile(pool, short.id, { assetId: asset.id });

    await deleteShort(pool, short.slug);
    assert.equal(await assetById(pool, asset.id), null);
  });
});

test('раздел показывает выпущенное всем, а черновики — автору', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveShort(pool, { title: 'Черновик' });
    const shown = await saveShort(pool, { title: 'Вышел' });
    await publishShort(pool, shown.slug);

    assert.deepEqual(
      (await listShorts(pool, {})).map((short) => short.title),
      ['Вышел']
    );
    assert.equal((await listShorts(pool, { includeDrafts: true })).length, 2);
  });
});

test('горизонтальный файл при загрузке не принимается', { skip: hasFfmpeg ? false : 'нет ffmpeg' }, async (t) => {
  await withTestDb(async (pool) => {
    const short = await saveShort(pool, { title: 'Ролик' });
    const headers = await admin(pool);
    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));

    // Настоящий файл, а не подделка: размер кадра портал спрашивает у ffprobe.
    const wide = await sample('640x360');
    const tall = await sample('360x640');

    await withServer(app, async (base) => {
      const bad = await fetch(`${base}/api/upload/short/${short.slug}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'video/mp4' },
        body: wide
      });
      assert.equal(bad.status, 415);
      assert.match((await bad.json()).error, /горизонтальный \(640×360\)/);

      const good = await fetch(`${base}/api/upload/short/${short.slug}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'video/mp4' },
        body: tall
      });
      assert.equal(good.status, 200);
      const answer = await good.json();
      assert.deepEqual(answer.frame, { width: 360, height: 640 });
      // Кадр-заставка снимается сама: без неё в списке чёрный прямоугольник.
      assert.match(answer.coverUrl, /^\/media\/asset\/\d+$/);
    });

    assert.ok((await getShortBySlug(pool, short.slug)).assetId, 'файл обязан привязаться');
    await connectChannel(pool);
  });
  t.diagnostic('проверено на настоящем ffmpeg');
});

/** Настоящий mp4 заданного размера — в память, файлом его никто не ждёт. */
async function sample(size) {
  const { mkdtemp, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const dir = await mkdtemp(path.join(tmpdir(), 'short-'));
  const file = path.join(dir, 'sample.mp4');
  await new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=10:duration=2`,
      '-pix_fmt', 'yuv420p', '-y', file
    ]);
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg не собрал файл'))));
  });
  return readFile(file);
}
