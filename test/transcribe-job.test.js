// Шаг расшифровки. Распознаватель подставляется заглушкой: проверяется не
// качество распознавания, а то, что результат целиком лёг в базу, повтор не
// наплодил вторых сегментов и запись без речи не роняет конвейер.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeTranscribe } from '../src/jobs/transcribe.js';
import { saveLesson } from '../src/services/lessons.js';
import { registerAsset } from '../src/services/media.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const speech = {
  transcribe: async () => ({
    text: 'первый кусок второй кусок',
    segments: [
      { startedMs: 0, endedMs: 2500, text: 'первый кусок' },
      { startedMs: 2500, endedMs: 5000, text: 'второй кусок' }
    ],
    dropped: 0
  })
};

/** Урок со звуком в буфере: файл кладём настоящий, шаг проверяет его наличие. */
async function seed(pool) {
  const config = { media: { dir: await mkdtemp(path.join(tmpdir(), 'portal-tr-')), ttlHours: 168 } };
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
  await mkdir(path.join(config.media.dir, 'urok'), { recursive: true });
  await writeFile(path.join(config.media.dir, 'urok/audio.ogg'), 'звук');
  const audio = await registerAsset(pool, config, {
    lessonId: lesson.id,
    kind: 'audio',
    relativePath: 'urok/audio.ogg',
    bytes: 4
  });
  return { config, lessonId: lesson.id, audioAssetId: audio.id };
}

function makeQueue() {
  const added = [];
  return { added, add: async (name, data) => added.push({ name, data }) };
}

test('расшифровка ложится в базу целиком', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { config, lessonId, audioAssetId } = await seed(pool);
    const queue = makeQueue();
    await makeTranscribe(config, pool, queue, speech)({ lessonId, audioAssetId });

    const { rows: text } = await pool.query('SELECT text, provider FROM transcripts WHERE lesson_id = $1', [
      lessonId
    ]);
    assert.match(text[0].text, /первый кусок/);
    assert.equal(text[0].provider, 'whisper.cpp');

    const { rows: segments } = await pool.query(
      'SELECT started_ms, text FROM transcript_segments WHERE lesson_id = $1 ORDER BY started_ms',
      [lessonId]
    );
    assert.equal(segments.length, 2);
    assert.equal(segments[1].started_ms, 2500);
    // Следующий шаг ставится сразу: порядок конвейера живёт в самих шагах.
    assert.equal(queue.added[0].name, 'subtitles');
  });
});

test('повтор шага заменяет расшифровку, а не удваивает', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { config, lessonId, audioAssetId } = await seed(pool);
    const job = makeTranscribe(config, pool, makeQueue(), speech);
    await job({ lessonId, audioAssetId });
    await job({ lessonId, audioAssetId });
    // Два текста на урок сделали бы поиск бессмысленным, а субтитры — вдвое
    // длиннее записи.
    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM transcript_segments WHERE lesson_id = $1)::int AS segments,
              (SELECT count(*) FROM transcripts WHERE lesson_id = $1)::int AS texts`,
      [lessonId]
    );
    assert.deepEqual(rows[0], { segments: 2, texts: 1 });
  });
});

test('запись без речи не роняет конвейер, а идёт сразу за обложкой', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { config, lessonId, audioAssetId } = await seed(pool);
    const queue = makeQueue();
    const silent = {
      transcribe: async () => ({ text: '', segments: [], dropped: 3 })
    };
    const result = await makeTranscribe(config, pool, queue, silent)({ lessonId, audioAssetId });

    // Урок может целиком показывать экран под музыку. Субтитры делать не из
    // чего, но останавливать обработку на полпути незачем.
    assert.equal(queue.added[0].name, 'makeCover');
    assert.equal(result.dropped, 3);
  });
});

test('без настроенного распознавания шаг говорит об этом внятно', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { config, lessonId, audioAssetId } = await seed(pool);
    await assert.rejects(
      makeTranscribe(config, pool, makeQueue(), null)({ lessonId, audioAssetId }),
      /не настроено/i
    );
  });
});

test('пропавший из буфера звук объясняется человеку', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { config, lessonId } = await seed(pool);
    const ghost = await registerAsset(pool, config, {
      lessonId,
      kind: 'audio',
      relativePath: 'urok/net.ogg',
      bytes: 1
    });
    await assert.rejects(
      makeTranscribe(config, pool, makeQueue(), speech)({ lessonId, audioAssetId: ghost.id }),
      /удалён по сроку/
    );
  });
});
