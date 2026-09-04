// Шаг субтитров: берёт сегменты из базы и кладёт два файла в буфер.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeSubtitles } from '../src/jobs/subtitles.js';
import { saveLesson } from '../src/services/lessons.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

async function makeConfig() {
  return { media: { dir: await mkdtemp(path.join(tmpdir(), 'portal-subs-')), ttlHours: 168 } };
}

test('оба файла ложатся в буфер и попадают в учёт', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await pool.query(
      `INSERT INTO transcript_segments (lesson_id, started_ms, ended_ms, text) VALUES
       ($1, 0, 2500, 'первая реплика'), ($1, 2500, 5000, 'вторая реплика')`,
      [lesson.id]
    );

    const added = [];
    await makeSubtitles(config, pool, { add: async (n, d) => added.push({ n, d }) })({
      lessonId: lesson.id
    });

    const srt = await readFile(path.join(config.media.dir, `lesson-${lesson.id}/subtitles.srt`), 'utf8');
    assert.match(srt, /первая реплика/);
    assert.match(srt, /00:00:02,500 --> 00:00:05,000/);

    const vtt = await readFile(path.join(config.media.dir, `lesson-${lesson.id}/subtitles.vtt`), 'utf8');
    assert.match(vtt, /^WEBVTT/);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM assets WHERE kind = 'subtitles'`
    );
    assert.equal(rows[0].n, 2);
    // Следующий шаг — нарезки: им нужны и субтитры, и реплики с временами.
    // Обложка идёт последней, потому что она ставит урок на проверку.
    assert.equal(added[0].n, 'makeClips');
  });
});

test('повтор шага не плодит записей в учёте', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await pool.query(
      `INSERT INTO transcript_segments (lesson_id, started_ms, ended_ms, text)
       VALUES ($1, 0, 1000, 'реплика')`,
      [lesson.id]
    );
    const job = makeSubtitles(config, pool, { add: async () => {} });
    await job({ lessonId: lesson.id });
    await job({ lessonId: lesson.id });
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM assets WHERE kind = 'subtitles'`
    );
    assert.equal(rows[0].n, 2);
  });
});

test('без расшифровки шаг объясняет, чего не хватает', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await assert.rejects(
      makeSubtitles(config, pool, { add: async () => {} })({ lessonId: lesson.id }),
      /нет расшифровки/i
    );
  });
});
