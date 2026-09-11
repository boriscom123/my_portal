// Отрезки монтажа. Без них главы нельзя перевести на смонтированную запись:
// монтаж их вычислял и выбрасывал, а по звуковой дорожке пересчитать можно не
// всегда — она живёт в буфере 3,5 дня.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { saveLesson, getLessonById } from '../src/services/lessons.js';
import { registerAsset } from '../src/services/media.js';
import { saveTrimRanges, ensureTrimRanges } from '../src/services/trim-ranges.js';
import { ffmpegArgsForTrim } from '../src/lib/ffmpeg.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

async function makeConfig() {
  return { media: { dir: await mkdtemp(path.join(tmpdir(), 'portal-ranges-')), ttlHours: 168 } };
}

test('сохранённые отрезки читаются у урока и не трогают остальное', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await pool.query(
      `UPDATE lessons SET generated = '{"chapters":[{"atMs":0,"title":"Начало"}]}'::jsonb WHERE id = $1`,
      [lesson.id]
    );
    await saveTrimRanges(pool, lesson.id, [{ startedMs: 0, endedMs: 10_000 }]);
    const saved = await getLessonById(pool, lesson.id);
    assert.deepEqual(saved.trimRanges, [{ startedMs: 0, endedMs: 10_000 }]);
    assert.equal(saved.chapters.length, 1, 'главы рядом с отрезками пропали');
  });
});

test('у урока без монтажа отрезков нет', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    assert.equal((await getLessonById(pool, lesson.id)).trimRanges, null);
  });
});

test('отрезков нет — считаются по звуку один раз и запоминаются', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок', durationSeconds: 60 });
    await mkdir(path.join(config.media.dir, `lesson-${lesson.id}`), { recursive: true });
    await writeFile(path.join(config.media.dir, `lesson-${lesson.id}/audio.m4a`), 'звук');
    await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'audio',
      relativePath: `lesson-${lesson.id}/audio.m4a`,
      bytes: 4
    });
    let calls = 0;
    const detect = async () => (calls++, [{ startMs: 10_000, endMs: 30_000 }]);

    const first = await ensureTrimRanges(config, pool, await getLessonById(pool, lesson.id), { detect });
    assert.equal(first.length, 2, 'пауза должна была разделить запись надвое');
    const again = await ensureTrimRanges(config, pool, await getLessonById(pool, lesson.id), { detect });
    assert.deepEqual(again, first);
    assert.equal(calls, 1, 'второй раз считать незачем — отрезки уже сохранены');
  });
});

test('ни звука, ни записи в буфере — внятный отказ', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок', durationSeconds: 60 });
    await assert.rejects(
      ensureTrimRanges(config, pool, await getLessonById(pool, lesson.id), { detect: async () => [] }),
      /нет в буфере/
    );
  });
});

test('монтаж ставит опорный кадр каждые 2 секунды', () => {
  // Иначе граница части при резке без пережатия уезжает к редкому опорному
  // кадру кодировщика — до 8–10 секунд.
  const args = ffmpegArgsForTrim({ listPath: 'list.txt', output: 'out.mp4' });
  const at = args.indexOf('-force_key_frames');
  assert.ok(at >= 0, 'нет -force_key_frames');
  assert.equal(args[at + 1], 'expr:gte(t,n_forced*2)');
});
