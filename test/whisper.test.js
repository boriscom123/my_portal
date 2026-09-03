// Расшифровка речи: аргументы, разбор вывода и отсев заготовок из титров.
// Сам whisper.cpp здесь не запускается — это минуты счёта; проверяется то,
// что вокруг него, и оно же ломалось на живом файле.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  whisperArgs,
  parseWhisperJson,
  isHallucination,
  normalizeText,
  jsonPathFor,
  ensureModel
} from '../src/lib/whisper.js';

test('аргументы называют модель, файл, язык и число потоков', () => {
  const args = whisperArgs({ model: '/m/small.bin', input: '/tmp/a.wav', threads: 2 });
  assert.deepEqual(args.slice(0, 8), [
    '-m', '/m/small.bin',
    '-f', '/tmp/a.wav',
    '-l', 'ru',
    '-t', '2'
  ]);
  // Без JSON нет времён, а без времён нет ни субтитров, ни поиска по уроку.
  assert.ok(args.includes('--output-json'));
});

test('вывод разбирается в сегменты с временами в миллисекундах', () => {
  const raw = JSON.stringify({
    transcription: [
      { offsets: { from: 0, to: 2500 }, text: ' Здравствуйте, разбираем docker.' },
      { offsets: { from: 2500, to: 5000 }, text: ' Сначала поднимем базу.' }
    ]
  });
  const parsed = parseWhisperJson(raw);
  assert.equal(parsed.segments.length, 2);
  assert.deepEqual(parsed.segments[0], {
    startedMs: 0,
    endedMs: 2500,
    text: 'Здравствуйте, разбираем docker.'
  });
  // Цельный текст — склейка сегментов: отдельного поля у whisper.cpp нет.
  assert.equal(parsed.text, 'Здравствуйте, разбираем docker. Сначала поднимем базу.');
});

test('заготовка из титров на тишине не попадает в расшифровку', () => {
  // Настоящий вывод с первого прогона на беззвучном файле. Модель обучена на
  // видео с субтитрами и на участке без речи уверенно выдаёт строку из титров.
  // Попади такое в субтитры урока — автор получил бы чужую подпись на видео.
  const raw = JSON.stringify({
    transcription: [{ offsets: { from: 0, to: 2000 }, text: ' Субтитры субтитров Н.Новикова' }]
  });
  const parsed = parseWhisperJson(raw);
  assert.deepEqual(parsed.segments, []);
  assert.equal(parsed.text, '');
  assert.equal(parsed.dropped, 1, 'отброшенное считаем: по нему видно, много ли тишины');
});

test('похожие заготовки узнаются, а настоящая речь — нет', () => {
  assert.ok(isHallucination('Продолжение следует...'));
  assert.ok(isHallucination('  Субтитры сделал DimaTorzok'));
  assert.ok(isHallucination(''), 'пустой сегмент тоже мусор');
  assert.ok(!isHallucination('Субтитры мы сделаем сами, дальше по конвейеру'));
  assert.ok(!isHallucination('Здравствуйте, сегодня разбираем docker compose.'));
});

test('приведение строки убирает регистр и знаки', () => {
  assert.equal(normalizeText('  Редактор  субтитров А.Синецкая!! '), 'редактор субтитров а синецкая');
});

test('битый вывод не роняет шаг', () => {
  // Оборванный счёт оставляет обрезанный файл. Уронить конвейер он не должен —
  // об этом скажет пустая расшифровка на экране проверки.
  assert.deepEqual(parseWhisperJson('{ не json'), { text: '', segments: [], dropped: 0 });
  assert.deepEqual(parseWhisperJson('{}'), { text: '', segments: [], dropped: 0 });
});

test('имя файла вывода строится от имени входного', () => {
  assert.equal(jsonPathFor('/app/media/lesson-1/audio.ogg.wav'), '/app/media/lesson-1/audio.ogg.wav.json');
});

test('готовая модель повторно не качается', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'portal-model-'));
  const model = path.join(dir, 'model.bin');
  await writeFile(model, 'уже здесь');
  const result = await ensureModel({
    model,
    modelUrl: 'https://example.invalid/model.bin',
    fetchImpl: async () => assert.fail('за скачанной моделью ходить в сеть незачем')
  });
  assert.equal(result.downloaded, false);
});

test('модель скачивается во временный файл и переименовывается', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'portal-model-'));
  const model = path.join(dir, 'nested/model.bin');
  const result = await ensureModel({
    model,
    modelUrl: 'https://example.invalid/model.bin',
    fetchImpl: async () => new Response('данные модели')
  });
  assert.equal(result.downloaded, true);
  const { size } = await stat(model);
  assert.equal(size, Buffer.byteLength('данные модели'));
  // Оборванная закачка не должна остаться под правильным именем: следующий
  // запуск принял бы половину файла за модель и падал бы на ней вечно.
  await assert.rejects(stat(`${model}.part`));
});

test('отказ раздачи объясняется, а не молчит', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'portal-model-'));
  await assert.rejects(
    ensureModel({
      model: path.join(dir, 'model.bin'),
      modelUrl: 'https://example.invalid/model.bin',
      fetchImpl: async () => ({ ok: false, status: 404 })
    }),
    /404/
  );
});
