// Шаг конвейера: забрать исходник с Диска. В сеть не ходим — fetch
// подставляется. Проверяем, что файл лёг в буфер, попал в учёт и запустил
// следующий шаг.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { makeFetchSource } from '../src/jobs/fetch-source.js';
import { saveLesson } from '../src/services/lessons.js';
import { saveIntegration } from '../src/services/disk.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

async function makeConfig() {
  return {
    tokenEncryptionKey: 'a'.repeat(64),
    media: { dir: await mkdtemp(path.join(tmpdir(), 'portal-fetch-')), ttlHours: 168 }
  };
}

/** Ответ Диска: сначала ссылка, потом сам файл потоком. */
function diskStub(content) {
  return async (url) => {
    if (String(url).includes('resources/download')) {
      return { ok: true, json: async () => ({ href: 'https://downloader/file' }) };
    }
    return { ok: true, body: Readable.toWeb(Readable.from([content])) };
  };
}

test('файл ложится в буфер и запускает обработку', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await saveIntegration(pool, config, { name: 'yandex-disk', token: 'token' });
    const added = [];
    const queue = { add: async (name, data) => added.push({ name, data }) };

    const result = await makeFetchSource(config, pool, queue, diskStub('содержимое файла'))({
      lessonId: lesson.id,
      diskPath: 'disk:/video/urok.mp4'
    });

    const { rows } = await pool.query(
      'SELECT path, kind, bytes FROM assets WHERE lesson_id = $1',
      [lesson.id]
    );
    assert.equal(rows[0].kind, 'source');
    assert.equal(
      await readFile(path.join(config.media.dir, rows[0].path), 'utf8'),
      'содержимое файла'
    );
    assert.equal(result.bytes, Buffer.byteLength('содержимое файла'));
    // Следующий шаг ставится сам: порядок конвейера живёт в шагах.
    assert.equal(added[0].name, 'extractAudio');

    const { rows: lessonRows } = await pool.query(
      'SELECT pipeline_state, source_asset_id FROM lessons WHERE id = $1',
      [lesson.id]
    );
    assert.equal(lessonRows[0].pipeline_state, 'processing');
    assert.ok(lessonRows[0].source_asset_id);
  });
});

test('без подключённого Диска шаг говорит об этом внятно', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await assert.rejects(
      makeFetchSource(config, pool, { add: async () => {} }, diskStub('х'))({
        lessonId: lesson.id,
        diskPath: 'disk:/urok.mp4'
      }),
      /не подключён/i
    );
  });
});

test('чужое имя файла не уводит запись за пределы буфера', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await saveIntegration(pool, config, { name: 'yandex-disk', token: 'token' });

    await makeFetchSource(config, pool, { add: async () => {} }, diskStub('x'))({
      lessonId: lesson.id,
      diskPath: 'disk:/../../etc/passwd'
    });

    const { rows } = await pool.query('SELECT path FROM assets WHERE lesson_id = $1', [lesson.id]);
    // Имя приходит с чужого сервиса: полагаться на его добропорядочность нельзя.
    assert.ok(!rows[0].path.includes('..'));
    assert.match(rows[0].path, /^lesson-\d+\//);
  });
});

test('отказ скачивания объясняется', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await saveIntegration(pool, config, { name: 'yandex-disk', token: 'token' });
    const failing = async (url) => {
      if (String(url).includes('resources/download')) {
        return { ok: true, json: async () => ({ href: 'https://downloader/file' }) };
      }
      return { ok: false, status: 503, text: async () => 'занято' };
    };
    await assert.rejects(
      makeFetchSource(config, pool, { add: async () => {} }, failing)({
        lessonId: lesson.id,
        diskPath: 'disk:/urok.mp4'
      }),
      /503/
    );
  });
});
