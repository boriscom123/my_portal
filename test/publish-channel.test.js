// Шаги выкладки в каналы. Площадка подменяется: проверяется порядок работы и
// то, как шаг ведёт состояния.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { makePublishChannel, makeRefreshChannels } from '../src/jobs/publish-channel.js';
import { saveLesson } from '../src/services/lessons.js';
import { startPublication, publicationsFor } from '../src/services/publications.js';
import { registerAsset } from '../src/services/media.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = { publicBaseUrl: 'https://portal.example', media: { dir: '/tmp', ttlHours: 168 } };

function adapterStub(overrides = {}) {
  const calls = [];
  return {
    calls,
    app: async () => ({ configured: true, token: 't', channel: '@kanal' }),
    post: async (args) => (calls.push({ post: args }), { messageId: '42', url: 'https://t.me/kanal/42' }),
    edit: async (args) => calls.push({ edit: args }),
    ...overrides
  };
}

async function seed(pool, { cover = true, platform = 'telegram' } = {}) {
  const lesson = await saveLesson(pool, {
    slug: 'urok',
    title: 'Урок про портал',
    description: 'Короткое описание'
  });
  if (cover) {
    // Обложка нужна не только ссылкой в карточке, но и файлом: MAX кладёт её на
    // свой узел, а не забирает по ссылке.
    const asset = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'cover',
      relativePath: 'lesson-1/cover.jpg',
      bytes: 100
    });
    await pool.query('UPDATE lessons SET cover_url = $2 WHERE id = $1', [
      lesson.id,
      `/media/asset/${asset.id}`
    ]);
  }
  const { id } = await startPublication(pool, {
    lessonId: lesson.id,
    platform,
    assetId: null,
    mode: 'auto'
  });
  return { lesson, publicationId: id };
}

test('анонс уходит в канал и запоминается', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, publicationId } = await seed(pool);
    const adapter = adapterStub();

    await makePublishChannel(config, pool, 'telegram', adapter)({
      lessonId: lesson.id,
      publicationId
    });

    const [publication] = await publicationsFor(pool, lesson.id);
    assert.equal(publication.state, 'published', 'пост в канале виден сразу');
    assert.equal(publication.externalId, '42');
    assert.equal(publication.url, 'https://t.me/kanal/42');

    const sent = adapter.calls[0].post;
    assert.match(sent.photoUrl, /^https:\/\/portal\.example\/media\/asset\/\d+$/);
    assert.match(sent.filePath, /lesson-1\/cover\.jpg$/, 'MAX нужен сам файл, а не ссылка');
    assert.match(sent.caption, /Урок про портал/);
    assert.match(sent.caption, /portal\.example\/lesson\/urok/);
  });
});

test('вышедший анонс просит поправить посты, отправленные раньше', skipWithoutDb, async () => {
  // Заказчик 2026-09-16: урок ушёл в YouTube, потом в Telegram, потом в MAX —
  // и в посте Telegram не было ссылки на MAX. Пост собирается из того, что
  // вышло к его отправке, а следом вышедшее дописывается правкой. Раньше о
  // правке просила только проверка ролика YouTube, и выкладка в соседний канал
  // оставляла прежние посты со старыми ссылками.
  await withTestDb(async (pool) => {
    const { lesson, publicationId } = await seed(pool, { platform: 'max' });
    const added = [];
    const queue = { add: async (name, data) => added.push({ name, data }) };

    await makePublishChannel(config, pool, 'max', adapterStub(), queue)({
      lessonId: lesson.id,
      publicationId
    });

    assert.deepEqual(added, [{ name: 'refreshChannels', data: { lessonId: lesson.id } }]);
  });
});

const MB = 1024 * 1024;

/** Запись урока в буфере: из неё режется начало для поста. */
async function withRecording(pool, lessonId, bytes = 600 * MB) {
  await mkdir(path.join(config.media.dir, `lesson-${lessonId}`), { recursive: true });
  await writeFile(path.join(config.media.dir, `lesson-${lessonId}/source.mp4`), 'запись');
  await registerAsset(pool, config, {
    lessonId,
    kind: 'source',
    relativePath: `lesson-${lessonId}/source.mp4`,
    bytes
  });
}

/** Подставные резка и замеры: тест обходится без ffmpeg. */
const cutDeps = {
  cutter: async ({ output, startMs, endMs }) => {
    await writeFile(output, 'начало урока');
    return { path: output, bytes: ((endMs - startMs) / 60_000) * 10 * MB };
  },
  probe: async () => 3600,
  frameSize: async () => ({ width: 1920, height: 1080 })
};

test('анонс уходит альбомом: обложка и начало урока одним постом', skipWithoutDb, async () => {
  // Заказчик 2026-09-16: видео должно быть в самом анонсе, одной кнопкой.
  await withTestDb(async (pool) => {
    const { lesson, publicationId } = await seed(pool);
    await withRecording(pool, lesson.id);
    const adapter = adapterStub();

    await makePublishChannel(config, pool, 'telegram', adapter, null, cutDeps)({
      lessonId: lesson.id,
      publicationId
    });

    const sent = adapter.calls[0].post;
    assert.match(sent.video.path, /start-telegram\.mp4$/, 'к анонсу не приложено начало урока');
    assert.equal(sent.video.width, 1920, 'без размеров площадка рисует квадрат');
    assert.equal(sent.video.height, 1080);
    assert.ok(sent.video.duration > 0);
    assert.match(sent.caption, /Начало урока/);
    assert.match(sent.photoUrl, /\/media\/asset\/\d+$/, 'обложка осталась первой в альбоме');
  });
});

test('записи ещё нет — анонс уходит как раньше, одной обложкой', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, publicationId } = await seed(pool);
    const adapter = adapterStub();

    await makePublishChannel(config, pool, 'telegram', adapter, null, cutDeps)({
      lessonId: lesson.id,
      publicationId
    });

    const sent = adapter.calls[0].post;
    assert.equal(sent.video, undefined, 'видео взяться неоткуда');
    assert.doesNotMatch(sent.caption, /Начало урока/, 'обещать начало урока нечем');
  });
});

test('правка поста MAX возвращает видео на место, а без файла не трогает пост', skipWithoutDb, async () => {
  // У MAX правка заново прикладывает вложения: без файла видео слетит с поста.
  await withTestDb(async (pool) => {
    const { lesson, publicationId } = await seed(pool, { platform: 'max' });
    await withRecording(pool, lesson.id);
    const adapter = adapterStub();
    await makePublishChannel(config, pool, 'max', adapter, null, cutDeps)({
      lessonId: lesson.id,
      publicationId
    });

    await makeRefreshChannels(config, pool, { max: adapter })({ lessonId: lesson.id });
    const edit = adapter.calls.at(-1).edit;
    assert.match(edit.videoPath, /start-max\.mp4$/, 'видео не приложено заново');

    // Кусок вышел по сроку — правим не пост, а ничего: подпись не стоит того,
    // чтобы снять с поста видео.
    await rm(path.join(config.media.dir, `lesson-${lesson.id}/start-max.mp4`), { force: true });
    const before = adapter.calls.length;
    await makeRefreshChannels(config, pool, { max: adapter })({ lessonId: lesson.id });
    assert.equal(adapter.calls.length, before, 'пост правился без видео');
  });
});

test('без обложки анонс не отправляется, и сказано почему', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, publicationId } = await seed(pool, { cover: false });

    await assert.rejects(
      makePublishChannel(config, pool, 'telegram', adapterStub())({
        lessonId: lesson.id,
        publicationId
      }),
      /обложки/i
    );
  });
});

test('отказ площадки записывается причиной', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, publicationId } = await seed(pool);
    const adapter = adapterStub({
      post: async () => {
        throw new Error('Telegram отказал (400): chat not found');
      }
    });

    await assert.rejects(
      makePublishChannel(config, pool, 'telegram', adapter)({ lessonId: lesson.id, publicationId }),
      /chat not found/
    );
    const [publication] = await publicationsFor(pool, lesson.id);
    assert.equal(publication.state, 'failed');
    assert.match(publication.error, /chat not found/);
  });
});

test('вышедший ролик дописывается в пост правкой, а не вторым постом', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, publicationId } = await seed(pool);
    const adapter = adapterStub();
    await makePublishChannel(config, pool, 'telegram', adapter)({
      lessonId: lesson.id,
      publicationId
    });

    // Ролик вышел на YouTube — в базе появилась вторая публикация.
    const youtube = await startPublication(pool, {
      lessonId: lesson.id,
      platform: 'youtube',
      assetId: null,
      mode: 'semi'
    });
    await pool.query(
      `UPDATE publications SET state = 'published', url = 'https://youtu.be/x' WHERE id = $1`,
      [youtube.id]
    );

    const result = await makeRefreshChannels(config, pool, { telegram: adapter })({
      lessonId: lesson.id
    });

    assert.equal(result.updated, 1);
    const edit = adapter.calls.at(-1).edit;
    assert.equal(edit.messageId, '42');
    assert.match(edit.caption, /youtu\.be\/x/);
    // Второго поста быть не должно: подписчики не получают второе уведомление.
    assert.equal(adapter.calls.filter((call) => call.post).length, 1);
  });
});

test('неудачная правка не ломает пост и не мешает соседям', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, publicationId } = await seed(pool);
    const adapter = adapterStub();
    await makePublishChannel(config, pool, 'telegram', adapter)({
      lessonId: lesson.id,
      publicationId
    });

    const failing = adapterStub({
      edit: async () => {
        throw new Error('слишком часто');
      }
    });
    await makeRefreshChannels(config, pool, { telegram: failing })({ lessonId: lesson.id });

    const [publication] = await publicationsFor(pool, lesson.id);
    assert.equal(publication.state, 'published', 'пост в канале стоит и урок не ломает');
    assert.match(publication.error, /подпись не обновилась/);
  });
});
