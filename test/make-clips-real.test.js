// Нарезка на настоящем ffmpeg. Проверять её заглушкой значило бы не проверять
// ничего: весь смысл шага в том, что чужая программа отработала, файл появился
// и подписи в него попали. Пропавший шрифт, например, заглушкой не ловится —
// ffmpeg при нём завершается успешно и отдаёт ролик без единой подписи.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { makeMakeClips } from '../src/jobs/make-clips.js';
import { saveLesson } from '../src/services/lessons.js';
import { registerAsset } from '../src/services/media.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

/** Есть ли ffmpeg. В образе он есть, на чужой машине может не быть. */
const hasFfmpeg = await new Promise((resolve) => {
  const child = spawn('ffmpeg', ['-version']);
  child.on('error', () => resolve(false));
  child.on('close', (code) => resolve(code === 0));
});
const skipWithoutFfmpeg = { skip: hasFfmpeg ? false : 'ffmpeg не установлен' };

/** Горизонтальный ролик на полминуты: настоящий файл, а не подделка. */
function makeSample(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=10:duration=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30',
      '-shortest', '-pix_fmt', 'yuv420p', '-y', file
    ]);
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('не собрался ролик'))));
  });
}

test('нарезка появляется в буфере, вертикальная и с подписями', skipWithoutDb, async (t) => {
  if (!hasFfmpeg) return t.skip(skipWithoutFfmpeg.skip);

  await withTestDb(async (pool) => {
    const config = { media: { dir: await mkdtemp(path.join(tmpdir(), 'portal-clip-')), ttlHours: 168 } };
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок', durationSeconds: 30 });
    await mkdir(path.join(config.media.dir, 'urok'), { recursive: true });
    const source = path.join(config.media.dir, 'urok/source.mp4');
    await makeSample(source);
    const asset = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'source',
      relativePath: 'urok/source.mp4',
      bytes: (await stat(source)).size
    });
    await pool.query('UPDATE lessons SET source_asset_id = $1 WHERE id = $2', [asset.id, lesson.id]);

    // Речь по всей длине: иначе выбирать фрагменты не из чего.
    for (let i = 0; i < 10; i += 1) {
      await pool.query(
        `INSERT INTO transcript_segments (lesson_id, started_ms, ended_ms, text)
         VALUES ($1, $2, $3, $4)`,
        [lesson.id, i * 3000, i * 3000 + 2500, `реплика номер ${i} про контейнеры и образы`]
      );
    }

    const added = [];
    const queue = { add: async (name) => added.push(name) };
    const result = await makeMakeClips(config, pool, queue)({ lessonId: lesson.id });

    assert.ok(result.clips > 0, 'ни одной нарезки не вышло');
    const { rows } = await pool.query(
      `SELECT path, bytes FROM assets WHERE lesson_id = $1 AND kind = 'clip' ORDER BY path`,
      [lesson.id]
    );
    assert.equal(rows.length, result.clips);
    assert.ok(Number(rows[0].bytes) > 0, 'ролик пустой');

    // Размер кадра — то, ради чего нарезка и делается: горизонтальный ролик
    // площадки коротких видео показывают с полями.
    const size = await new Promise((resolve, reject) => {
      const child = spawn('ffprobe', [
        '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height', '-of', 'csv=p=0',
        path.join(config.media.dir, rows[0].path)
      ]);
      let out = '';
      child.stdout.on('data', (chunk) => (out += chunk));
      child.on('error', reject);
      child.on('close', () => resolve(out.trim()));
    });
    assert.equal(size, '1080,1920');

    // Временный файл субтитров живёт только на время счёта.
    await assert.rejects(stat(path.join(config.media.dir, 'urok/clip-1.srt')));
    assert.equal(added[0], 'makeCover', 'обложка ставит урок на проверку и идёт последней');
  });
});
