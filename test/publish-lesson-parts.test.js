// Шаг «урок частями». Площадка, резка и замер подменяются: проверяется порядок
// работы — анонс уже ушёл, запись на месте, части собраны и отправлены, ход
// записан, временные файлы убраны.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makePublishLessonParts } from '../src/jobs/publish-lesson-parts.js';
import { saveLesson } from '../src/services/lessons.js';
import { registerAsset } from '../src/services/media.js';
import { savePlatformApp } from '../src/services/platform-apps.js';
import {
  startPublication,
  markPublicationState,
  publicationById
} from '../src/services/publications.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const MB = 1024 * 1024;

async function setup(
  pool,
  {
    platform = 'max_parts',
    announced = true,
    bytes = 600 * MB,
    // Свой сервер Bot API: с ним части Telegram режутся по 2 ГБ. Облачный берёт
    // от бота 50 МБ — про него свой тест, а здесь запись нарочно крупная.
    apiUrl = 'http://claudeservice-telegram-bot-api-1:8081'
  } = {}
) {
  const config = {
    publicBaseUrl: 'https://p.example',
    telegram: { apiUrl },
    media: { dir: await mkdtemp(path.join(tmpdir(), 'parts-job-')), ttlHours: 168 }
  };
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок про портал' });
  await mkdir(path.join(config.media.dir, `lesson-${lesson.id}`), { recursive: true });
  await writeFile(path.join(config.media.dir, `lesson-${lesson.id}/source.mp4`), 'запись');
  await registerAsset(pool, config, {
    lessonId: lesson.id,
    kind: 'source',
    relativePath: `lesson-${lesson.id}/source.mp4`,
    bytes
  });
  const base = platform === 'telegram_parts' ? 'telegram' : 'max';
  const announcement = await startPublication(pool, {
    lessonId: lesson.id,
    platform: base,
    mode: 'auto'
  });
  if (announced) {
    await markPublicationState(pool, announcement.id, { state: 'published', externalId: 'mid.a' });
  }
  const { id: publicationId } = await startPublication(pool, {
    lessonId: lesson.id,
    platform,
    mode: 'auto'
  });
  return { config, lesson, publicationId };
}

function adapterStub(result = { messageId: 'mid.1', url: null, multiVideo: true }) {
  const calls = [];
  return {
    calls,
    app: async () => ({ configured: true, token: 't', channel: '-1', link: 'https://max.ru/kanal' }),
    postParts: async (args) => (calls.push(args), result)
  };
}

/** Подставная резка: пишет файл и отвечает весом по 10 МБ в минуту. */
const fakeCutter = async ({ output, startMs, endMs }) => {
  await writeFile(output, 'часть');
  return { path: output, bytes: ((endMs - startMs) / 60_000) * 10 * MB };
};

test('урок уходит в MAX частями не тяжелее предела, временные файлы убраны', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { config, lesson, publicationId } = await setup(pool);
    const adapter = adapterStub();
    const result = await makePublishLessonParts(config, pool, 'max_parts', adapter, {
      cutter: fakeCutter,
      probe: async () => 3600
    })({ lessonId: lesson.id, publicationId });

    // 600 МБ при пределе 250·0,95 — три части.
    assert.equal(result.parts, 3);
    const sent = adapter.calls[0];
    assert.equal(sent.parts.length, 3);
    assert.match(sent.text, /^Урок про портал/);
    assert.match(sent.text, /https:\/\/p\.example\/lesson\/urok$/);
    assert.equal(sent.parts[1].caption, 'Часть 2 из 3');
    assert.equal(sent.multiVideo, true, 'способ ещё не известен — пробуем одним сообщением');

    const publication = await publicationById(pool, publicationId);
    assert.equal(publication.state, 'published');
    assert.equal(publication.externalId, 'mid.1');
    assert.equal(publication.url, 'https://max.ru/kanal', 'у поста MAX адреса нет — ведём на канал');
    const left = await readdir(path.join(config.media.dir, `lesson-${lesson.id}`));
    assert.ok(!left.includes('parts'), 'временные части остались на диске');
  });
});

test('частями уезжает запись, записанная в публикацию', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { config, lesson } = await setup(pool);
    // Рядом с исходником — смонтированная запись; автор выбрал исходник.
    await writeFile(path.join(config.media.dir, `lesson-${lesson.id}/trimmed.mp4`), 'монтаж');
    await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'trimmed',
      relativePath: `lesson-${lesson.id}/trimmed.mp4`,
      bytes: 100 * MB
    });
    const { rows } = await pool.query(
      `SELECT id FROM assets WHERE lesson_id = $1 AND kind = 'source'`,
      [lesson.id]
    );
    const chosen = await startPublication(pool, {
      lessonId: lesson.id,
      platform: 'max_parts',
      assetId: Number(rows[0].id),
      mode: 'auto'
    });

    const inputs = [];
    await makePublishLessonParts(config, pool, 'max_parts', adapterStub(), {
      cutter: async (args) => (inputs.push(args.input), fakeCutter(args)),
      probe: async () => 3600
    })({ lessonId: lesson.id, publicationId: chosen.id });

    assert.ok(inputs.length, 'резка не вызывалась');
    assert.ok(inputs.every((input) => input.endsWith('/source.mp4')), inputs.join(', '));
  });
});

test('в облачный Telegram запись режется по его пределу, а не по мерке своего сервера', skipWithoutDb, async () => {
  // Заказчик 2026-09-16: «Telegram отказал (413): Request Entity Too Large».
  // Запись на 250 МБ уехала одним куском — части резались по 2 ГБ, как у
  // своего сервера Bot API, а бот говорил с облаком, где предел 50 МБ.
  await withTestDb(async (pool) => {
    const { config, lesson, publicationId } = await setup(pool, {
      platform: 'telegram_parts',
      apiUrl: 'https://api.telegram.org',
      bytes: 250 * MB
    });
    const adapter = adapterStub({ messageId: '11', url: 'https://t.me/kanal/11' });

    const result = await makePublishLessonParts(config, pool, 'telegram_parts', adapter, {
      cutter: fakeCutter,
      probe: async () => 3600
    })({ lessonId: lesson.id, publicationId });

    assert.ok(result.parts > 1, `запись должна была разойтись на части, а вышло ${result.parts}`);
    const sent = adapter.calls[0];
    assert.equal(sent.parts.length, result.parts);
    // Ушли нарезанные куски, а не исходный файл целиком.
    for (const part of sent.parts) {
      assert.doesNotMatch(part.path, /source\.mp4$/);
    }
  });
});

test('запись влезает целиком — уходит сам файл, подпись с главами у него', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { config, lesson, publicationId } = await setup(pool, { platform: 'telegram_parts' });
    const adapter = adapterStub({ messageId: '10', url: 'https://t.me/kanal/10' });
    let cuts = 0;
    await makePublishLessonParts(config, pool, 'telegram_parts', adapter, {
      cutter: async (args) => (cuts++, fakeCutter(args)),
      probe: async () => 3600
    })({ lessonId: lesson.id, publicationId });

    assert.equal(cuts, 0, 'резать было незачем');
    const [only] = adapter.calls[0].parts;
    assert.equal(only.path, path.join(config.media.dir, `lesson-${lesson.id}/source.mp4`));
    assert.match(only.caption, /^Урок про портал/, 'у единственной части — подпись поста');
    const publication = await publicationById(pool, publicationId);
    assert.equal(publication.url, 'https://t.me/kanal/10');
  });
});

test('без анонса части не уходят, и сказано почему', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { config, lesson, publicationId } = await setup(pool, { announced: false });
    const adapter = adapterStub();
    await assert.rejects(
      makePublishLessonParts(config, pool, 'max_parts', adapter, {
        cutter: fakeCutter,
        probe: async () => 3600
      })({ lessonId: lesson.id, publicationId }),
      /Сначала отправьте анонс/
    );
    assert.equal(adapter.calls.length, 0);
    const publication = await publicationById(pool, publicationId);
    assert.equal(publication.state, 'failed');
    assert.match(publication.error, /Сначала отправьте анонс/);
  });
});

test('записи нет в буфере — внятный отказ', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { config, lesson, publicationId } = await setup(pool);
    await pool.query(`DELETE FROM assets WHERE lesson_id = $1`, [lesson.id]);
    await assert.rejects(
      makePublishLessonParts(config, pool, 'max_parts', adapterStub(), {
        cutter: fakeCutter,
        probe: async () => 3600
      })({ lessonId: lesson.id, publicationId }),
      /Записи урока нет в буфере/
    );
  });
});

test('MAX не принял несколько видео — запоминается у канала', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { config, lesson, publicationId } = await setup(pool);
    await savePlatformApp(
      pool,
      { tokenEncryptionKey: 'a'.repeat(64) },
      { name: 'max', clientId: '', clientSecret: '', mode: 'semi', settings: { channel: '-1' } }
    );
    await makePublishLessonParts(
      config,
      pool,
      'max_parts',
      adapterStub({ messageId: 'mid.1', url: null, multiVideo: false }),
      { cutter: fakeCutter, probe: async () => 3600 }
    )({ lessonId: lesson.id, publicationId });
    const { rows } = await pool.query(
      `SELECT settings->>'multiVideo' AS multi, settings->>'channel' AS channel
         FROM platform_apps WHERE name = 'max'`
    );
    assert.equal(rows[0].multi, 'false');
    assert.equal(rows[0].channel, '-1', 'остальные настройки канала целы');
  });
});

test('повтор получает ход прошлой отправки', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { config, lesson, publicationId } = await setup(pool);
    await pool.query(`UPDATE publications SET details = '{"sent":["mid.1"]}'::jsonb WHERE id = $1`, [
      publicationId
    ]);
    const adapter = adapterStub();
    await makePublishLessonParts(config, pool, 'max_parts', adapter, {
      cutter: fakeCutter,
      probe: async () => 3600
    })({ lessonId: lesson.id, publicationId });
    assert.deepEqual(adapter.calls[0].progress, { sent: ['mid.1'] });
  });
});
