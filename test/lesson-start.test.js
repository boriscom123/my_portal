// Начало урока для канала: вырезать, измерить и оставить в буфере.
//
// Заказчик 2026-09-16: анонс уходит альбомом — обложка и начало записи одним
// постом. Кусок должен пережить отправку: у MAX правка поста заново
// прикладывает вложения, и без файла видео слетело бы с поста при первой же
// правке подписи. Резка и замер подставляются доводом — тест без ffmpeg.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cutLessonStart } from '../src/services/lesson-start.js';
import { saveLesson, getLessonById } from '../src/services/lessons.js';
import { registerAsset } from '../src/services/media.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const MB = 1024 * 1024;

const deps = {
  cutter: async ({ output, startMs, endMs }) => {
    await writeFile(output, 'кусок');
    return { path: output, bytes: ((endMs - startMs) / 60_000) * 10 * MB };
  },
  probe: async () => 3600,
  frameSize: async () => ({ width: 1920, height: 1080 })
};

async function seed(pool, { bytes = 600 * MB } = {}) {
  const config = {
    publicBaseUrl: 'https://p.example',
    media: { dir: await mkdtemp(path.join(tmpdir(), 'lesson-start-')), ttlHours: 168 }
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
  return { config, lesson: await getLessonById(pool, lesson.id) };
}

test('начало урока вырезается, меряется и остаётся в буфере', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { config, lesson } = await seed(pool);

    const start = await cutLessonStart(
      config,
      pool,
      { lesson, limitBytes: 50 * MB, platform: 'telegram' },
      deps
    );

    assert.equal(start.width, 1920);
    assert.equal(start.height, 1080);
    assert.ok(start.duration > 0, 'длительность не измерена');
    assert.equal(start.whole, false, '600 МБ в предел 50 МБ целиком не влезают');
    assert.match(start.path, /lesson-\d+\/start-telegram\.mp4$/, 'кусок кладётся рядом с записью');

    // Файл записан в учёт своим видом: по нему пост можно поправить, приложив
    // видео заново, и он не попадёт в кандидаты на вертикальный ролик.
    const { rows } = await pool.query(
      `SELECT kind, path FROM assets WHERE lesson_id = $1 AND kind = 'part'`,
      [lesson.id]
    );
    assert.equal(rows.length, 1, 'кусок не записан в буфер');
    assert.match(rows[0].path, /start-telegram\.mp4$/);
  });
});

test('запись влезает целиком — уходит сама, резать нечего', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { config, lesson } = await seed(pool, { bytes: 30 * MB });
    let cuts = 0;

    const start = await cutLessonStart(
      config,
      pool,
      { lesson, limitBytes: 50 * MB, platform: 'telegram' },
      { ...deps, cutter: async (args) => (cuts += 1, deps.cutter(args)) }
    );

    assert.equal(cuts, 0, 'резать было незачем');
    assert.equal(start.whole, true);
    assert.match(start.path, /source\.mp4$/, 'уходит сама запись');
  });
});

test('записи в буфере нет — говорим об этом словами', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { config, lesson } = await seed(pool);
    await pool.query(`DELETE FROM assets WHERE lesson_id = $1`, [lesson.id]);

    await assert.rejects(
      cutLessonStart(config, pool, { lesson, limitBytes: 50 * MB, platform: 'telegram' }, deps),
      /Записи урока нет в буфере/
    );
  });
});
