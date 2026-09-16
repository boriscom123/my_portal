// Начало записи для канала: один кусок не тяжелее предела площадки, резка по
// главам, размер не угадывается, а меряется.
// Настоящий ffmpeg в первых тестах не нужен: резка подставляется. Последний —
// на настоящем ffmpeg, потому что резка без пережатия ведёт себя по-своему.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cutFirstPart, SIZE_MARGIN } from '../src/lib/video-parts.js';
import { ffmpegArgsForPart, runFfmpeg, probeDuration } from '../src/lib/ffmpeg.js';

const MB = 1024 * 1024;
const min = (m) => m * 60_000;

/** Подставная резка: вес куска — по заданной «плотности» записи. */
function fakeCutter(bytesFor) {
  const cuts = [];
  const discarded = [];
  return {
    cuts,
    discarded,
    cut: async ({ startMs, endMs }) => {
      const piece = { path: `part-${cuts.length + 1}.mp4`, bytes: bytesFor(startMs, endMs) };
      cuts.push({ startMs, endMs, ...piece });
      return piece;
    },
    discard: async (piece) => discarded.push(piece.path)
  };
}

const even = (perMinuteMb) => (start, end) => ((end - start) / 60_000) * perMinuteMb * MB;

const chapters = [
  { atMs: 0, title: 'Введение', number: 1 },
  { atMs: min(10), title: 'Nginx', number: 2 },
  { atMs: min(20), title: 'Бот', number: 3 },
  { atMs: min(30), title: 'Итоги', number: 4 }
];

test('в канал уходит только начало записи — режем один кусок, а не всю запись', async () => {
  // Заказчик 2026-09-16: в канал идёт обложка и первый кусок видео, остальное
  // зритель смотрит на площадках. Нарезать ради этого всю запись значит занять
  // ffmpeg на минуты и выбросить сделанное.
  const cutter = fakeCutter(even(10));
  const part = await cutFirstPart({
    durationMs: min(40),
    totalBytes: 400 * MB,
    chapters,
    limitBytes: 250 * MB,
    ...cutter
  });
  // В 250·0,95 МБ влезают две главы по 100 МБ.
  assert.equal(part.startMs, 0);
  assert.equal(part.endMs, min(20));
  assert.deepEqual(part.chapters.map((chapter) => chapter.number), [1, 2]);
  assert.ok(part.bytes <= 250 * MB * SIZE_MARGIN);
  // Хвост записи не режется вовсе: примерок несколько, а не по куску на главу.
  assert.ok(cutter.cuts.length <= 3, `лишние примерки: ${cutter.cuts.length}`);
  assert.ok(cutter.cuts.every((cut) => cut.startMs === 0), 'кусок берётся от начала записи');
});

test('запись легче предела — в канал уходит сам файл, резать нечего', async () => {
  const cutter = fakeCutter(() => 0);
  const part = await cutFirstPart({
    durationMs: min(40),
    totalBytes: 30 * MB,
    chapters,
    limitBytes: 50 * MB,
    ...cutter
  });
  assert.equal(part.path, null, 'часть — сам файл');
  assert.equal(part.endMs, min(40));
  assert.equal(cutter.cuts.length, 0);
});

test('первая глава тяжелее предела — кусок обрывается внутри неё', async () => {
  // Первые 50 МБ при 10 МБ в минуту — около пяти минут, это меньше главы.
  const cutter = fakeCutter(even(10));
  const part = await cutFirstPart({
    durationMs: min(40),
    totalBytes: 400 * MB,
    chapters,
    limitBytes: 50 * MB,
    ...cutter
  });
  assert.equal(part.startMs, 0);
  assert.ok(part.endMs < min(10), `кусок вышел за первую главу: ${part.endMs}`);
  assert.ok(part.bytes <= 50 * MB * SIZE_MARGIN);
  assert.ok(cutter.cuts.length <= 4, `лишние примерки: ${cutter.cuts.length}`);
});

test('глав нет — кусок отмеряется временем от начала', async () => {
  const cutter = fakeCutter(even(10));
  const part = await cutFirstPart({
    durationMs: min(40),
    totalBytes: 400 * MB,
    chapters: [],
    limitBytes: 50 * MB,
    ...cutter
  });
  assert.equal(part.startMs, 0);
  assert.ok(part.bytes <= 50 * MB * SIZE_MARGIN);
  assert.equal(part.chapters.length, 0);
});

test('аргументы резки: без пережатия, с перемоткой до входа', () => {
  const args = ffmpegArgsForPart({ input: 'in.mp4', output: 'out.mp4', startMs: 90_000, endMs: 150_000 });
  assert.ok(args.indexOf('-ss') < args.indexOf('-i'), 'перемотка до -i — по опорному кадру и быстро');
  assert.equal(args[args.indexOf('-ss') + 1], '90');
  assert.equal(args[args.indexOf('-c') + 1], 'copy');
  assert.equal(args[args.indexOf('-t') + 1], '60');
});

const hasFfmpeg = await new Promise((resolve) => {
  const child = spawn('ffmpeg', ['-version']);
  child.on('error', () => resolve(false));
  child.on('close', (code) => resolve(code === 0));
});

test('на настоящем ffmpeg: части встают на опорные кадры и не легче нуля', async (t) => {
  if (!hasFfmpeg) return t.skip('ffmpeg не установлен');
  const dir = await mkdtemp(path.join(tmpdir(), 'portal-parts-'));
  const input = path.join(dir, 'source.mp4');
  // 20 секунд с опорным кадром каждые 2 секунды — как у смонтированной записи.
  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=20',
    '-f', 'lavfi', '-i', 'sine=duration=20',
    '-shortest', '-pix_fmt', 'yuv420p', '-c:v', 'libx264',
    '-force_key_frames', 'expr:gte(t,n_forced*2)', '-y', input
  ]);
  const output = path.join(dir, 'part.mp4');
  await runFfmpeg(ffmpegArgsForPart({ input, output, startMs: 6000, endMs: 14_000 }));
  const seconds = await probeDuration(output);
  assert.ok(Math.abs(seconds - 8) < 0.5, `часть длиной ${seconds} с вместо восьми`);
  assert.ok((await stat(output)).size > 0);
});
