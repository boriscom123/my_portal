// Шаги выкладки в каналы. Площадка подменяется: проверяется порядок работы и
// то, как шаг ведёт состояния.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makePublishChannel, makeRefreshChannels } from '../src/jobs/publish-channel.js';
import { saveLesson } from '../src/services/lessons.js';
import { startPublication, publicationsFor } from '../src/services/publications.js';
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
    await pool.query("UPDATE lessons SET cover_url = '/media/asset/9' WHERE id = $1", [lesson.id]);
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
    assert.equal(sent.photoUrl, 'https://portal.example/media/asset/9');
    assert.match(sent.caption, /Урок про портал/);
    assert.match(sent.caption, /portal\.example\/lesson\/urok/);
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
