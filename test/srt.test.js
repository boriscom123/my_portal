// Проверка формата субтитров. Формат чужой и строгий: точка вместо запятой —
// и площадка молча отвергает файл, а автор узнаёт об этом только по
// отсутствию субтитров у вышедшего ролика.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toSrt, toVtt, formatSrtTime, formatVttTime } from '../src/lib/srt.js';

const segments = [
  { startedMs: 0, endedMs: 2500, text: 'первая строка' },
  { startedMs: 2500, endedMs: 5000, text: 'вторая строка' }
];

test('время в srt пишется с запятой, в vtt — с точкой', () => {
  // Это не мелочь: с точкой файл srt не принимается, с запятой — vtt.
  assert.equal(formatSrtTime(3_661_500), '01:01:01,500');
  assert.equal(formatVttTime(3_661_500), '01:01:01.500');
});

test('нулевое время пишется полностью, а не сокращённо', () => {
  assert.equal(formatSrtTime(0), '00:00:00,000');
});

test('srt нумерует блоки с единицы', () => {
  const srt = toSrt(segments);
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:02,500\nпервая строка/);
  assert.match(srt, /\n2\n00:00:02,500 --> 00:00:05,000/);
});

test('vtt начинается с обязательной строки WEBVTT', () => {
  assert.match(toVtt(segments), /^WEBVTT\n/);
});

test('пустой список даёт пустой файл, а не поломку', () => {
  assert.equal(toSrt([]).trim(), '');
  assert.match(toVtt([]), /^WEBVTT/);
});

test('перевод строки внутри реплики не ломает разметку', () => {
  // В расшифровке переносы встречаются; в srt пустая строка разделяет блоки,
  // поэтому внутри реплики её быть не должно.
  const srt = toSrt([{ startedMs: 0, endedMs: 1000, text: 'первая\n\nвторая' }]);
  assert.ok(!srt.includes('\n\n\n'));
  assert.match(srt, /первая\nвторая/);
});
