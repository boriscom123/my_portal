// Монтаж на настоящем ffmpeg. Склейка кусков — чужая работа, но проверить, что
// она вообще случилась и запись стала короче, можно только запустив её.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { makeTrimPauses } from '../src/jobs/trim-pauses.js';
import { saveLesson } from '../src/services/lessons.js';
import { registerAsset } from '../src/services/media.js';
import { probeDuration } from '../src/lib/ffmpeg.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const hasFfmpeg = await new Promise((resolve) => {
  const child = spawn('ffmpeg', ['-version']);
  child.on('error', () => resolve(false));
  child.on('close', (code) => resolve(code === 0));
});

/** Ролик на минуту: настоящий файл, а не подделка. */
function makeSample(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10:duration=60',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=60',
      '-shortest', '-pix_fmt', 'yuv420p', '-y', file
    ]);
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('не собрался ролик'))));
  });
}

async function seed(pool, settings) {
  const config = { media: { dir: await mkdtemp(path.join(tmpdir(), 'portal-trim-')), ttlHours: 168 } };
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок', durationSeconds: 60 });
  await mkdir(path.join(config.media.dir, 'urok'), { recursive: true });
  const source = path.join(config.media.dir, 'urok/source.mp4');
  await makeSample(source);
  const asset = await registerAsset(pool, config, {
    lessonId: lesson.id,
    kind: 'source',
    relativePath: 'urok/source.mp4',
    bytes: (await stat(source)).size
  });
  await pool.query('UPDATE lessons SET source_asset_id = $1, settings = $2::jsonb WHERE id = $3', [
    asset.id,
    JSON.stringify(settings),
    lesson.id
  ]);
  // Речь в первые десять секунд и в последние пять: между ними — пауза,
  // которую и должен вырезать монтаж.
  for (const [from, to] of [
    [0, 4000],
    [4500, 9000],
    [50_000, 55_000]
  ]) {
    await pool.query(
      `INSERT INTO transcript_segments (lesson_id, started_ms, ended_ms, text)
       VALUES ($1, $2, $3, 'реплика про контейнеры')`,
      [lesson.id, from, to]
    );
  }
  return { config, lessonId: lesson.id };
}

test('запись становится короче, а субтитры к ней — свои', skipWithoutDb, async (t) => {
  if (!hasFfmpeg) return t.skip('ffmpeg не установлен');

  await withTestDb(async (pool) => {
    const { config, lessonId } = await seed(pool, { cutPauses: true, minPauseSeconds: 2 });
    const added = [];
    const queue = { add: async (name) => added.push(name) };
    const result = await makeTrimPauses(config, pool, queue)({ lessonId });

    assert.equal(result.ranges, 2, 'должно остаться два куска речи');
    assert.ok(result.becameSeconds < 25, `минута ужалась до ${result.becameSeconds} с`);

    // Производные файлы конвейер кладёт в каталог урока по его номеру — там
    // же, где субтитры и обложка; исходник при этом может лежать под своим
    // именем, каким его назвал загрузивший.
    const dir = `lesson-${lessonId}`;
    const seconds = await probeDuration(path.join(config.media.dir, `${dir}/trimmed.mp4`));
    assert.ok(seconds > 5 && seconds < 25, `в файле ${seconds} с вместо шестидесяти`);

    const { rows } = await pool.query(
      `SELECT kind, path FROM assets WHERE lesson_id = $1 ORDER BY path`,
      [lessonId]
    );
    const paths = rows.map((row) => row.path);
    assert.ok(paths.includes(`${dir}/trimmed.mp4`));
    // Субтитры к смонтированной записи отдельные: по старым временам они
    // опаздывали бы тем сильнее, чем дальше к концу урока.
    assert.ok(paths.includes(`${dir}/trimmed.srt`));
    assert.ok(paths.includes(`${dir}/trimmed.vtt`));
    // Список кусков — рабочий файл, в буфере ему делать нечего.
    assert.ok(!paths.some((item) => item.endsWith('trim-list.txt')));
    assert.equal(added[0], 'makeClips');
  });
});

test('выключенный монтаж просто пропускается', skipWithoutDb, async (t) => {
  if (!hasFfmpeg) return t.skip('ffmpeg не установлен');

  await withTestDb(async (pool) => {
    const { config, lessonId } = await seed(pool, { cutPauses: false });
    const added = [];
    const result = await makeTrimPauses(config, pool, { add: async (n) => added.push(n) })({
      lessonId
    });
    // Пересжатие часовой записи занимает полчаса машины: без спроса нельзя.
    assert.match(result.skipped, /выключено/);
    assert.equal(added[0], 'makeClips', 'конвейер должен идти дальше');
    const { rows } = await pool.query(
      `SELECT count(*)::int n FROM assets WHERE lesson_id = $1 AND kind = 'trimmed'`,
      [lessonId]
    );
    assert.equal(rows[0].n, 0);
  });
});
