// Кадр на обложку. Момент выбираем мы, сам кадр вырезает ffmpeg — проверяем
// и то и другое: выбор чистой функцией, вырезание на настоящем ролике.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { coverTimeSeconds, makeMakeCover } from '../src/jobs/make-cover.js';
import { ffmpegArgsForCover } from '../src/lib/ffmpeg.js';
import { saveLesson } from '../src/services/lessons.js';
import { registerAsset } from '../src/services/media.js';
import { withTestDb } from './helpers/db.js';

const hasFfmpeg = await new Promise((resolve) => {
  const child = spawn('ffmpeg', ['-version']);
  child.on('error', () => resolve(false));
  child.on('close', (code) => resolve(code === 0));
});
const skipWithoutFfmpeg = { skip: hasFfmpeg ? false : 'ffmpeg не установлен' };

test('кадр берётся не с самого начала', () => {
  // Первые секунды урока — заставка и «здравствуйте», кадр оттуда пустой.
  assert.ok(coverTimeSeconds(3600) > 10);
  assert.ok(coverTimeSeconds(3600) < 3600);
});

test('на коротком ролике кадр всё равно находится', () => {
  const at = coverTimeSeconds(8);
  assert.ok(at >= 0 && at < 8);
  // И на записи без известной длительности не падаем.
  assert.equal(coverTimeSeconds(null), 0);
});

test('обложка сохраняется одним кадром нужной ширины', () => {
  const args = ffmpegArgsForCover({ input: '/m/in.mp4', atSeconds: 42, output: '/m/cover.jpg' });
  assert.ok(args.includes('-frames:v'));
  assert.match(args[args.indexOf('-vf') + 1], /scale=1280:-2/);
  // Перемотка ДО -i: иначе ffmpeg читает часовой файл с начала ради кадра
  // из середины.
  assert.ok(args.indexOf('-ss') < args.indexOf('-i'));
});

test('кадр вырезается из настоящего ролика и попадает в карточку',
  skipWithoutFfmpeg, async () => {
  const config = { media: { dir: await mkdtemp(path.join(tmpdir(), 'portal-cover-')), ttlHours: 168 } };
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await mkdir(path.join(config.media.dir, `lesson-${lesson.id}`), { recursive: true });
    const relative = `lesson-${lesson.id}/source.mp4`;

    await new Promise((resolve, reject) => {
      const child = spawn('ffmpeg', [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc=s=640x360:d=6',
        '-y', path.join(config.media.dir, relative)
      ]);
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ролик не собрался'))));
    });

    const source = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'source',
      relativePath: relative,
      bytes: 1000
    });
    await pool.query('UPDATE lessons SET source_asset_id = $1, duration_seconds = 6 WHERE id = $2', [
      source.id,
      lesson.id
    ]);

    const result = await makeMakeCover(config, pool)({ lessonId: lesson.id });
    await access(path.join(config.media.dir, relative.replace('source.mp4', 'cover.jpg')));
    assert.ok(result.bytes > 0);

    const { rows } = await pool.query(
      'SELECT cover_url, pipeline_state FROM lessons WHERE id = $1',
      [lesson.id]
    );
    assert.match(rows[0].cover_url, /^\/media\/asset\/\d+$/);
    // Конвейер дошёл до конца: дальше слово за автором.
    assert.equal(rows[0].pipeline_state, 'review');
  });
});
