// Проверка обёртки над ffmpeg. Сам ffmpeg не проверяем — он чужой и рабочий;
// проверяем то, что вокруг: аргументы, разбор длительности и понятную ошибку
// вместо голого кода возврата.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ffmpegArgsForAudio, parseDuration, describeFailure } from '../src/lib/ffmpeg.js';

test('звук извлекается в опус 16 кГц моно', () => {
  const args = ffmpegArgsForAudio('/media/in.mp4', '/media/out.ogg');
  // 16 кГц моно — то, что просят сервисы распознавания. Больше не нужно:
  // лишние килогерцы увеличивают файл и время загрузки, но не точность.
  assert.ok(args.includes('-ar'));
  assert.ok(args.includes('16000'));
  assert.ok(args.includes('-ac'));
  assert.ok(args.includes('1'));
  // Видео выбрасываем: сервису распознавания оно не нужно, а весит всё.
  assert.ok(args.includes('-vn'));
  assert.equal(args.at(-1), '/media/out.ogg');
});

test('длительность разбирается из вывода ffprobe', () => {
  assert.equal(parseDuration('3599.984000\n'), 3599.984);
  assert.equal(parseDuration('N/A'), null);
  assert.equal(parseDuration(''), null);
});

test('ошибка ffmpeg объясняется последними строками вывода', () => {
  const text = describeFailure(1, ['первая строка', 'Invalid data found when processing input']);
  assert.match(text, /Invalid data/);
  // Код возврата сам по себе ничего не объясняет человеку в кабинете.
  assert.match(text, /1/);
});

test('пустой вывод не превращается в пустую ошибку', () => {
  assert.match(describeFailure(137, []), /137/);
});

test('убитый по памяти процесс объясняет нехватку памяти, а не пустой код', () => {
  // Ядро убивает процесс сигналом, и код возврата приходит пустым. «Код null»
  // автору в кабинете не говорит ничего, а причина у такого убийства на этой
  // машине всегда одна — память кончилась.
  const text = describeFailure(null, ['[00:00.000 --> 00:02.000]  речь'], 'whisper');
  assert.match(text, /памяти/);
  assert.match(text, /whisper/);
  assert.doesNotMatch(text, /null/);
});

test('имя программы в объяснении — та, что упала', () => {
  // Расшифровку считает whisper, и назвать её отказ отказом ffmpeg значит
  // отправить автора чинить не то.
  assert.match(describeFailure(1, [], 'whisper'), /whisper/);
  assert.match(describeFailure(1, []), /ffmpeg/);
});
