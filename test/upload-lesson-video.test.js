// Шаг «загрузить видео урока в Telegram».
//
// Заказчик 2026-09-16: долгую первую загрузку делает автор кнопкой, видео
// уходит ему в личку, а портал запоминает номер файла — дальше зрители
// получают то же видео мгновенно.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeUploadLessonVideo } from '../src/jobs/upload-lesson-video.js';
import { saveLesson } from '../src/services/lessons.js';
import { registerAsset, assetsOfLesson } from '../src/services/media.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const MB = 1024 * 1024;

async function seed(pool, { withAdmin = true } = {}) {
  const config = {
    publicBaseUrl: 'https://p.example',
    telegram: { botToken: 'bot-token', apiUrl: 'http://bot-api:8081' },
    media: { dir: await mkdtemp(path.join(tmpdir(), 'tg-upload-')), ttlHours: 168 }
  };
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок про портал' });
  await mkdir(path.join(config.media.dir, `lesson-${lesson.id}`), { recursive: true });
  await writeFile(path.join(config.media.dir, `lesson-${lesson.id}/source.mp4`), 'запись');
  await registerAsset(pool, config, {
    lessonId: lesson.id,
    kind: 'source',
    relativePath: `lesson-${lesson.id}/source.mp4`,
    bytes: 250 * MB
  });
  if (withAdmin) {
    const { rows } = await pool.query(
      `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
    );
    await pool.query(
      `INSERT INTO identities (user_id, provider, external_id) VALUES ($1, 'tg_widget', '777')`,
      [rows[0].id]
    );
  }
  return { config, lesson };
}

test('видео уходит автору в личку, номер файла запоминается', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { config, lesson } = await seed(pool);
    const sent = [];
    const sendVideo = async (args) => {
      sent.push(args);
      return { messageId: '5', fileId: 'BAACAgIAAxkBAAI' };
    };

    const result = await makeUploadLessonVideo(config, pool, { sendVideo })({ lessonId: lesson.id });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].channel, '777', 'видео ушло не автору');
    assert.match(sent[0].filePath, /source\.mp4$/);
    assert.match(sent[0].caption, /Урок про портал/);
    assert.equal(result.fileId, 'BAACAgIAAxkBAAI');

    const [asset] = await assetsOfLesson(pool, lesson.id);
    assert.equal(asset.telegramFileId, 'BAACAgIAAxkBAAI', 'номер файла не сохранён');
  });
});

test('автор не привязал Telegram — отказ словами, а не молчанием', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { config, lesson } = await seed(pool, { withAdmin: false });

    await assert.rejects(
      makeUploadLessonVideo(config, pool, { sendVideo: async () => ({}) })({ lessonId: lesson.id }),
      /Telegram/
    );
  });
});

test('записи в буфере нет — грузить нечего', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { config, lesson } = await seed(pool);
    await pool.query(`DELETE FROM assets WHERE lesson_id = $1`, [lesson.id]);

    await assert.rejects(
      makeUploadLessonVideo(config, pool, { sendVideo: async () => ({}) })({ lessonId: lesson.id }),
      /Записи урока нет/
    );
  });
});
