// Проверка формата субтитров. Формат чужой и строгий: точка вместо запятой —
// и площадка молча отвергает файл, а автор узнаёт об этом только по
// отсутствию субтитров у вышедшего ролика.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toSrt, toVtt, formatSrtTime, formatVttTime, parseSrt } from '../src/lib/srt.js';

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

// --- Чтение готового файла ------------------------------------------------
//
// Файл приходит из CapCut и других редакторов, и каждый пишет его чуть
// по-своему. Проверяем то, что встречается на деле, а не только образцовый вид.

test('srt читается в реплики с временами', () => {
  const text = '1\n00:00:01,000 --> 00:00:02,500\nпервая\n\n2\n00:00:02,500 --> 00:01:00,000\nвторая\n';
  assert.deepEqual(parseSrt(text), [
    { startedMs: 1000, endedMs: 2500, text: 'первая' },
    { startedMs: 2500, endedMs: 60000, text: 'вторая' }
  ]);
});

test('BOM, переводы строк Windows и лишние пустые строки не мешают', () => {
  const text = '﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nпервая\r\n\r\n\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nвторая\r\n\r\n';
  assert.deepEqual(
    parseSrt(text).map((segment) => segment.text),
    ['первая', 'вторая']
  );
});

test('миллисекунды через точку тоже принимаются', () => {
  const [segment] = parseSrt('1\n01:02:03.450 --> 01:02:04.000\nтекст\n');
  assert.equal(segment.startedMs, 3_723_450);
});

test('многострочная реплика склеивается через пробел, теги убираются', () => {
  const [segment] = parseSrt(
    '1\n00:00:01,000 --> 00:00:02,000\n<i>первая</i> строка\n<font color="#fff">вторая</font>\n'
  );
  assert.equal(segment.text, 'первая строка вторая');
});

test('реплики сортируются по началу', () => {
  const text = '2\n00:00:05,000 --> 00:00:06,000\nпозже\n\n1\n00:00:01,000 --> 00:00:02,000\nраньше\n';
  assert.deepEqual(
    parseSrt(text).map((segment) => segment.text),
    ['раньше', 'позже']
  );
});

test('собственный toSrt читается обратно без потерь', () => {
  assert.deepEqual(parseSrt(toSrt(segments)), segments);
});

test('пустой файл — ошибка с понятным текстом', () => {
  assert.throws(() => parseSrt('﻿\n\n'), /ни одной реплики/);
});

test('конец раньше начала — ошибка с номером блока', () => {
  assert.throws(
    () => parseSrt('1\n00:00:01,000 --> 00:00:02,000\nок\n\n2\n00:00:05,000 --> 00:00:04,000\nплохо\n'),
    /блок 2.*конец раньше начала/
  );
});

test('неразборчивое время — ошибка с номером блока', () => {
  assert.throws(() => parseSrt('1\nкогда-то --> потом\nтекст\n'), /блок 1.*время/);
});

test('блок без текста пропускается, а не становится пустой репликой', () => {
  const text = '1\n00:00:01,000 --> 00:00:02,000\n\n\n2\n00:00:03,000 --> 00:00:04,000\nесть\n';
  assert.deepEqual(
    parseSrt(text).map((segment) => segment.text),
    ['есть']
  );
});
