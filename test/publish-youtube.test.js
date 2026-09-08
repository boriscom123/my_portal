// Шаг выкладки целиком. Сеть и ffmpeg подменяются: проверяется порядок работы и
// то, как шаг ведёт состояния.
//
// Отдельно проверяется мягкость необязательного: ролик уже на канале, и ронять
// выкладку из-за обложки значило бы показать автору «упало» там, где всё
// главное удалось.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makePublishYoutube } from '../src/jobs/publish-youtube.js';
import { saveLesson } from '../src/services/lessons.js';
import { registerAsset } from '../src/services/media.js';
import { startPublication, publicationsFor } from '../src/services/publications.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  media: { dir: '/tmp', ttlHours: 168 },
  publicBaseUrl: 'https://portal.example',
  youtube: { mode: 'semi' }
};

/** Заглушки площадки: считают вызовы и отдают заранее известные ответы. */
function platformStub(overrides = {}) {
  const calls = [];
  return {
    calls,
    accessToken: async () => 'access-1',
    startUploadSession: async () => (calls.push('session'), 'https://upload.example/1'),
    uploadVideoFile: async () => (calls.push('upload'), { videoId: 'video-1' }),
    insertCaptions: async () => calls.push('captions'),
    setThumbnail: async () => calls.push('thumbnail'),
    shrinkThumbnail: async (filePath) => (calls.push('shrink'), filePath),
    ...overrides
  };
}

/** Урок с записью, субтитрами и выбранной обложкой. */
async function seed(pool, { cover = true } = {}) {
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
  const video = await registerAsset(pool, config, {
    lessonId: lesson.id,
    kind: 'source',
    relativePath: 'lesson-1/urok.mp4',
    bytes: 1024
  });
  await registerAsset(pool, config, {
    lessonId: lesson.id,
    kind: 'subtitles',
    relativePath: 'lesson-1/subtitles.srt',
    bytes: 10
  });
  if (cover) {
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
    platform: 'youtube',
    assetId: video.id,
    mode: 'semi'
  });
  return { lesson, publicationId: id };
}

test('удачная выкладка доводит публикацию до «лежит, но не публичен»', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, publicationId } = await seed(pool);
    const platform = platformStub();

    await makePublishYoutube(config, pool, platform)({ lessonId: lesson.id, publicationId });

    const [publication] = await publicationsFor(pool, lesson.id);
    assert.equal(publication.state, 'ready');
    assert.equal(publication.externalId, 'video-1');
    assert.match(publication.url, /video-1/);
    assert.deepEqual(platform.calls, ['session', 'upload', 'captions', 'thumbnail']);
  });
});

test('отказ обложки не роняет выкладку', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, publicationId } = await seed(pool);
    const platform = platformStub({
      setThumbnail: async () => {
        throw new Error('канал не подтверждён');
      }
    });

    await makePublishYoutube(config, pool, platform)({ lessonId: lesson.id, publicationId });

    const [publication] = await publicationsFor(pool, lesson.id);
    assert.equal(publication.state, 'ready', 'ролик уже на канале — это не провал');
    assert.match(publication.error, /обложк/i, 'но сказать об этом надо');
  });
});

test('отказ загрузки записывается причиной, а не молчанием', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, publicationId } = await seed(pool);
    const platform = platformStub({
      uploadVideoFile: async () => {
        throw new Error('Суточная норма загрузок YouTube исчерпана.');
      }
    });

    await assert.rejects(
      makePublishYoutube(config, pool, platform)({ lessonId: lesson.id, publicationId }),
      /норма/
    );
    const [publication] = await publicationsFor(pool, lesson.id);
    assert.equal(publication.state, 'failed');
    assert.match(publication.error, /норма/);
  });
});

test('без подключённого канала шаг говорит это словами', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, publicationId } = await seed(pool);
    const platform = platformStub({ accessToken: async () => null });

    await assert.rejects(
      makePublishYoutube(config, pool, platform)({ lessonId: lesson.id, publicationId }),
      /не подключ/i
    );
  });
});

test('без записи в буфере шаг не выдумывает файл', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'pustoy', title: 'Пустой' });
    const { id } = await startPublication(pool, {
      lessonId: lesson.id,
      platform: 'youtube',
      assetId: null,
      mode: 'semi'
    });

    await assert.rejects(
      makePublishYoutube(config, pool, platformStub())({ lessonId: lesson.id, publicationId: id }),
      /записи нет/i
    );
  });
});

test('в режиме auto ролик уезжает публичным и публикацией', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, publicationId } = await seed(pool);
    let sentPrivacy = null;
    const platform = platformStub({
      startUploadSession: async ({ body }) => {
        sentPrivacy = body.status.privacyStatus;
        return 'https://upload.example/1';
      }
    });

    // Режим auto ставится после аудита Google — и меняет ровно это.
    const autoConfig = { ...config, youtube: { mode: 'auto' } };
    await makePublishYoutube(autoConfig, pool, platform)({ lessonId: lesson.id, publicationId });

    assert.equal(sentPrivacy, 'public');
    const [publication] = await publicationsFor(pool, lesson.id);
    assert.equal(publication.state, 'published');
  });
});

test('тяжёлая обложка сперва пережимается', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    const video = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'source',
      relativePath: 'lesson-1/urok.mp4',
      bytes: 1024
    });
    const cover = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'cover',
      relativePath: 'lesson-1/cover.jpg',
      // Ровно та обложка, что была у заказчика: впритык к пределу площадки.
      bytes: 2_040_881
    });
    await pool.query('UPDATE lessons SET cover_url = $2 WHERE id = $1', [
      lesson.id,
      `/media/asset/${cover.id}`
    ]);
    const { id } = await startPublication(pool, {
      lessonId: lesson.id,
      platform: 'youtube',
      assetId: video.id,
      mode: 'semi'
    });

    const platform = platformStub();
    await makePublishYoutube(config, pool, platform)({ lessonId: lesson.id, publicationId: id });
    assert.ok(platform.calls.includes('shrink'), 'обложка тяжелее порога должна пережиматься');
  });
});
