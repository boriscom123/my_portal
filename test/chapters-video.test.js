// Главы на шкале уезжающего файла. Главы считаются по исходной записи, а
// уезжает смонтированная — без пауз: без перевода главы «убегают» вперёд на
// сумму вырезанных до них пауз.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chaptersForVideo } from '../src/lib/chapters.js';
import { buildVideoBody } from '../src/services/platforms/youtube-fields.js';

// Минута записи, из неё вырезана пауза с 10-й по 30-ю секунду.
const trimRanges = [
  { startedMs: 0, endedMs: 10_000 },
  { startedMs: 30_000, endedMs: 60_000 }
];
const lesson = {
  slug: 'urok',
  title: 'Урок',
  description: 'Описание',
  tags: [],
  durationSeconds: 60,
  chapters: [
    { atMs: 0, title: 'Начало' },
    { atMs: 35_000, title: 'Середина' },
    { atMs: 50_000, title: 'Конец' }
  ]
};

test('у смонтированной записи главы переводятся на её шкалу', () => {
  const chapters = chaptersForVideo({ ...lesson, trimRanges }, 'trimmed');
  // 35-я секунда исходной — это 15-я смонтированной: вырезано 20 секунд.
  assert.deepEqual(
    chapters.map((chapter) => chapter.atMs),
    [0, 15_000, 30_000]
  );
  assert.deepEqual(
    chapters.map((chapter) => chapter.title),
    ['Начало', 'Середина', 'Конец']
  );
});

test('у исходника главы остаются как есть', () => {
  assert.deepEqual(
    chaptersForVideo({ ...lesson, trimRanges }, 'source').map((chapter) => chapter.atMs),
    [0, 35_000, 50_000]
  );
});

test('монтаж без отрезков — глав нет: неверные хуже никаких', () => {
  assert.deepEqual(chaptersForVideo({ ...lesson, trimRanges: null }, 'trimmed'), []);
});

test('описание YouTube берёт главы, переданные доводом', () => {
  const body = buildVideoBody({
    lesson,
    publicBaseUrl: 'https://p.example',
    privacy: 'private',
    chapters: chaptersForVideo({ ...lesson, trimRanges }, 'trimmed')
  });
  assert.match(body.snippet.description, /^0:15 Середина$/m);
  assert.doesNotMatch(body.snippet.description, /0:35 Середина/);
});

test('пустой список доводом — глав в описании нет, даже если у урока они есть', () => {
  const body = buildVideoBody({ lesson, publicBaseUrl: 'https://p.example', privacy: 'private', chapters: [] });
  assert.doesNotMatch(body.snippet.description, /Середина/);
});
