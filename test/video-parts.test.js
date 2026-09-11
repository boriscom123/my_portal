// Нарезка записи на части. Цель — как можно меньше частей, каждая не тяжелее
// предела площадки; резка по главам, размер не угадывается, а меряется.
// Настоящий ffmpeg в первых тестах не нужен: резка подставляется. Последний —
// на настоящем ffmpeg, потому что резка без пережатия ведёт себя по-своему.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { splitIntoParts, SIZE_MARGIN } from '../src/lib/video-parts.js';
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

test('запись целиком влезает — не режем вовсе', async () => {
  const cutter = fakeCutter(() => 0);
  const parts = await splitIntoParts({
    durationMs: min(40),
    totalBytes: 600 * MB,
    chapters,
    limitBytes: 2000 * MB,
    ...cutter
  });
  assert.equal(parts.length, 1);
  assert.equal(parts[0].path, null, 'часть — сам файл, резать незачем');
  assert.equal(parts[0].chapters.length, 4);
  assert.equal(cutter.cuts.length, 0);
});

test('главы набиваются в часть до предела — частей как можно меньше', async () => {
  // Ровно 10 МБ в минуту: 40 минут — 400 МБ, предел 250 МБ.
  const cutter = fakeCutter(even(10));
  const parts = await splitIntoParts({
    durationMs: min(40),
    totalBytes: 400 * MB,
    chapters,
    limitBytes: 250 * MB,
    ...cutter
  });
  // В 250·0,95 МБ влезают две главы по 100 МБ, три — уже нет.
  assert.equal(parts.length, 2);
  assert.deepEqual(
    parts.map((part) => part.chapters.map((chapter) => chapter.number)),
    [
      [1, 2],
      [3, 4]
    ]
  );
  assert.ok(parts.every((part) => part.bytes <= 250 * MB * SIZE_MARGIN));
  // Части встык: ни одна секунда не потеряна и не повторена.
  assert.equal(parts[0].endMs, parts[1].startMs);
  assert.equal(parts.at(-1).endMs, min(40));
});

test('часть не влезла по весу — убираем последнюю главу и режем снова', async () => {
  // Средняя плотность врёт: вторая глава тяжелее остальных впятеро.
  const heavy = (start, end) => {
    let bytes = 0;
    for (let t = start; t < end; t += 60_000) bytes += (t >= min(10) && t < min(20) ? 30 : 6) * MB;
    return bytes;
  };
  const cutter = fakeCutter(heavy);
  const parts = await splitIntoParts({
    durationMs: min(40),
    totalBytes: heavy(0, min(40)),
    chapters,
    limitBytes: 250 * MB,
    ...cutter
  });
  assert.ok(parts.every((part) => part.bytes <= 250 * MB * SIZE_MARGIN), 'часть тяжелее предела');
  assert.ok(cutter.discarded.length > 0, 'перевес должен был отбросить пробную часть');
  // Отброшенные куски не выдаются как части.
  const kept = new Set(parts.map((part) => part.path));
  assert.ok(cutter.discarded.every((item) => !kept.has(item)));
});

test('часть легче предела с запасом — пробуем добавить главу', async () => {
  // Первая глава по оценке «не влезает» вместе со второй, но на деле лёгкая:
  // средняя плотность завышена тяжёлым хвостом.
  const bytesFor = (start, end) => {
    let bytes = 0;
    for (let t = start; t < end; t += 60_000) bytes += (t >= min(30) ? 40 : 5) * MB;
    return bytes;
  };
  const cutter = fakeCutter(bytesFor);
  const parts = await splitIntoParts({
    durationMs: min(40),
    totalBytes: bytesFor(0, min(40)),
    chapters,
    limitBytes: 250 * MB,
    ...cutter
  });
  // Первые три главы — 150 МБ, влезают вместе; четвёртая — 400 МБ, режется.
  assert.deepEqual(parts[0].chapters.map((chapter) => chapter.number), [1, 2, 3]);
  assert.ok(parts.every((part) => part.bytes <= 250 * MB * SIZE_MARGIN));
});

test('одна глава тяжелее предела — делится на наименьшее число кусков', async () => {
  const cutter = fakeCutter(even(10));
  const parts = await splitIntoParts({
    durationMs: min(60),
    totalBytes: 600 * MB,
    chapters: [
      { atMs: 0, title: 'Всё сразу', number: 1 },
      { atMs: min(50), title: 'Итоги', number: 2 },
      { atMs: min(55), title: 'Вопросы', number: 3 }
    ],
    limitBytes: 250 * MB,
    ...cutter
  });
  const pieces = parts.filter((part) => part.piece);
  // 500 МБ главы в куски до 237,5 МБ — три куска.
  assert.equal(pieces.length, 3);
  assert.deepEqual(
    pieces.map((part) => part.piece),
    [
      { n: 1, of: 3 },
      { n: 2, of: 3 },
      { n: 3, of: 3 }
    ]
  );
  // Хвост из двух коротких глав — одной частью.
  assert.deepEqual(parts.at(-1).chapters.map((chapter) => chapter.number), [2, 3]);
});

test('глав нет — делим запись на наименьшее число частей', async () => {
  const cutter = fakeCutter(even(10));
  const parts = await splitIntoParts({
    durationMs: min(40),
    totalBytes: 400 * MB,
    chapters: [],
    limitBytes: 250 * MB,
    ...cutter
  });
  assert.equal(parts.length, 2);
  assert.ok(parts.every((part) => part.chapters.length === 0 && part.piece === null));
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
