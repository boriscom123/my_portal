// Шаг извлечения звука. Работаем с настоящим ffmpeg — он есть в образе, и
// проверять обёртку заглушкой значило бы не проверять ничего: весь смысл шага
// в том, что чужая программа отработала и файл появился.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { makeExtractAudio } from '../src/jobs/extract-audio.js';
import { saveLesson } from '../src/services/lessons.js';
import { registerAsset } from '../src/services/media.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

/** Есть ли ffmpeg. В образе api и worker он есть, на чужой машине может не быть. */
const hasFfmpeg = await new Promise((resolve) => {
  const child = spawn('ffmpeg', ['-version']);
  child.on('error', () => resolve(false));
  child.on('close', (code) => resolve(code === 0));
});

const skipWithoutFfmpeg = {
  skip: hasFfmpeg ? false : 'ffmpeg не установлен'
};

async function makeConfig() {
  return { media: { dir: await mkdtemp(path.join(tmpdir(), 'portal-audio-')), ttlHours: 168 } };
}

/** Пятисекундный ролик с тоном: настоящий файл, а не подделка. */
function makeSample(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=5',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5',
      '-shortest', '-y', file
    ]);
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('не собрался ролик'))));
  });
}

test('звук извлекается, длительность записывается, ставится расшифровка',
  { ...skipWithoutFfmpeg }, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await mkdir(path.join(config.media.dir, 'lesson-1'), { recursive: true });
    const relative = 'lesson-1/source.mp4';
    await makeSample(path.join(config.media.dir, relative));

    const source = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'source',
      relativePath: relative,
      bytes: 1000
    });
    await pool.query('UPDATE lessons SET source_asset_id = $1 WHERE id = $2', [
      source.id,
      lesson.id
    ]);

    const added = [];
    const result = await makeExtractAudio(config, pool, {
      add: async (name, data) => added.push({ name, data })
    })({ lessonId: lesson.id });

    // Файл появился на диске и записан в учёт.
    await access(path.join(config.media.dir, 'lesson-1/audio.ogg'));
    assert.ok(result.bytes > 0);
    // Длительность узнаём здесь, пока исходник ещё в буфере.
    assert.ok(Math.abs(result.duration - 5) < 1, `длительность вышла ${result.duration}`);
    assert.equal(added[0].name, 'transcribe');

    const { rows } = await pool.query('SELECT duration_seconds FROM lessons WHERE id = $1', [
      lesson.id
    ]);
    assert.equal(rows[0].duration_seconds, 5);
  });
});

test('без исходника шаг говорит об этом внятно', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await assert.rejects(
      makeExtractAudio(config, pool, { add: async () => {} })({ lessonId: lesson.id }),
      /нет исходника/i
    );
  });
});

test('исчезнувший с диска файл объясняется человеческими словами', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    // Запись в учёте есть, файла на диске нет — так бывает после уборки буфера
    // по сроку. Вывод ffmpeg «No such file» верен, но в кабинете бесполезен.
    const source = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'source',
      relativePath: 'lesson-1/propal.mp4',
      bytes: 100
    });
    await pool.query('UPDATE lessons SET source_asset_id = $1 WHERE id = $2', [
      source.id,
      lesson.id
    ]);
    await assert.rejects(
      makeExtractAudio(config, pool, { add: async () => {} })({ lessonId: lesson.id }),
      /удалён по сроку|загрузите исходник заново/i
    );
  });
});
