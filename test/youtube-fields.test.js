// Что именно уезжает на площадку. Чистые функции, ни сети, ни базы.
//
// Главная проверка здесь — пара «видео и его субтитры». Монтаж сдвигает
// времена, и шаг вырезания пауз кладёт рядом СВОИ субтитры. Взять к монтажу
// субтитры исходника значит получить подписи, которые к концу урока опаздывают
// на суммарную длину вырезанных пауз — на минуты. Заметно это только на самом
// ролике, ближе к концу, и уже после выкладки.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickVideoAsset,
  pickSubtitlesAsset,
  buildVideoBody
} from '../src/services/platforms/youtube-fields.js';

const assets = [
  { id: 1, kind: 'source', path: 'lesson-15/L2-2.mp4' },
  { id: 2, kind: 'subtitles', path: 'lesson-15/subtitles.srt' },
  { id: 3, kind: 'subtitles', path: 'lesson-15/subtitles.vtt' },
  { id: 4, kind: 'trimmed', path: 'lesson-15/trimmed.mp4' },
  { id: 5, kind: 'subtitles', path: 'lesson-15/trimmed.srt' },
  { id: 6, kind: 'subtitles', path: 'lesson-15/trimmed.vtt' }
];

test('монтаж предпочитается исходнику', () => {
  assert.equal(pickVideoAsset(assets).id, 4);
});

test('без монтажа уезжает исходник', () => {
  const onlySource = assets.filter((asset) => asset.kind !== 'trimmed');
  assert.equal(pickVideoAsset(onlySource).id, 1);
});

test('видео нет вовсе — не выдумываем', () => {
  assert.equal(pickVideoAsset([{ id: 2, kind: 'subtitles', path: 'a.srt' }]), null);
});

test('субтитры берутся в пару именно к тому файлу, который уезжает', () => {
  const video = pickVideoAsset(assets);
  assert.equal(pickSubtitlesAsset(assets, video, {}).id, 5, 'к монтажу — trimmed.srt');

  const source = assets.find((asset) => asset.kind === 'source');
  assert.equal(pickSubtitlesAsset(assets, source, {}).id, 2, 'к исходнику — subtitles.srt');
});

test('vtt на площадку не уезжает — там нужен srt', () => {
  const video = assets.find((asset) => asset.kind === 'trimmed');
  assert.notEqual(pickSubtitlesAsset(assets, video, {}).id, 6);
});

test('субтитров к этому файлу нет — молчим, а не берём чужие', () => {
  // Монтаж другого урока: субтитры лежат рядом с ним, а не в нашей папке.
  const video = { id: 9, kind: 'trimmed', path: 'lesson-16/trimmed.mp4' };
  assert.equal(pickSubtitlesAsset(assets, video, {}), null);
});

test('подписи уже на записи — отдельный трек не грузим', () => {
  const video = pickVideoAsset(assets);
  // Иначе на экране две строки подписей друг под другом: одна вшитая, одна от
  // площадки. Та же галка уже гасит вшивание подписей в вертикальные ролики.
  assert.equal(pickSubtitlesAsset(assets, video, { burnedSubtitles: true }), null);
});

test('заголовок обрезается по словам, а не по знакам', () => {
  const long = 'Планирование '.repeat(20).trim();
  const body = buildVideoBody({
    lesson: { title: long, description: 'Описание', tags: [], slug: 'urok' },
    publicBaseUrl: 'https://portal.example',
    privacy: 'private'
  });
  assert.ok(body.snippet.title.length <= 100);
  assert.doesNotMatch(body.snippet.title, /Планиров$/, 'слово не должно рваться посередине');
});

test('короткий заголовок остаётся как есть', () => {
  const body = buildVideoBody({
    lesson: { title: 'Урок про портал', description: '', tags: [], slug: 'urok' },
    publicBaseUrl: 'https://portal.example',
    privacy: 'private'
  });
  assert.equal(body.snippet.title, 'Урок про портал');
});

test('в описании есть ссылка на страницу урока', () => {
  const body = buildVideoBody({
    lesson: { title: 'Урок', description: 'Про портал', tags: ['vps'], slug: 'urok-15' },
    publicBaseUrl: 'https://portal.example',
    privacy: 'private'
  });
  assert.match(body.snippet.description, /Про портал/);
  assert.match(body.snippet.description, /https:\/\/portal\.example\/lesson\/urok-15/);
});

test('обязательные поля площадки на месте', () => {
  const body = buildVideoBody({
    lesson: { title: 'Урок', description: '', tags: [], slug: 'urok' },
    publicBaseUrl: 'https://portal.example',
    privacy: 'private'
  });
  // Без этих трёх YouTube не принимает загрузку вовсе.
  assert.equal(body.snippet.categoryId, '27');
  assert.equal(body.snippet.defaultLanguage, 'ru');
  assert.equal(body.status.selfDeclaredMadeForKids, false);
  assert.equal(body.status.privacyStatus, 'private');
});

test('теги не длиннее пятисот знаков суммарно', () => {
  const tags = Array.from({ length: 100 }, (_, index) => `тег-номер-${index}`);
  const body = buildVideoBody({
    lesson: { title: 'Урок', description: '', tags, slug: 'urok' },
    publicBaseUrl: 'https://portal.example',
    privacy: 'private'
  });
  const total = body.snippet.tags.join('').length;
  assert.ok(total <= 500, `суммарная длина тегов ${total}`);
  assert.ok(body.snippet.tags.length > 0, 'хоть сколько-то тегов должно остаться');
});

test('главы уходят в описание отдельным блоком', () => {
  const body = buildVideoBody({
    lesson: {
      title: 'Урок',
      description: 'Про портал',
      tags: [],
      slug: 'urok',
      durationSeconds: 3600,
      chapters: [
        { atMs: 0, title: 'Что делаем' },
        { atMs: 120_000, title: 'Ставим окружение' },
        { atMs: 600_000, title: 'Первый запуск' }
      ]
    },
    publicBaseUrl: 'https://portal.example',
    privacy: 'private'
  });

  assert.match(body.snippet.description, /Про портал/);
  assert.match(body.snippet.description, /^0:00 Что делаем$/m);
  assert.match(body.snippet.description, /^10:00 Первый запуск$/m);
  // Ссылка на урок остаётся последней: её ищут внизу описания.
  assert.match(body.snippet.description, /Урок на портале: https:\/\/portal\.example\/lesson\/urok$/);
});

test('негодные главы в описание не попадают вовсе', () => {
  // YouTube в таком случае молча не показывает НИ ОДНОЙ главы, и строки в
  // описании остались бы мусором, который автор увидит на вышедшем ролике.
  const body = buildVideoBody({
    lesson: {
      title: 'Урок',
      description: 'Про портал',
      tags: [],
      slug: 'urok',
      durationSeconds: 3600,
      chapters: [
        { atMs: 30_000, title: 'Не с нуля' },
        { atMs: 120_000, title: 'Вторая' },
        { atMs: 600_000, title: 'Третья' }
      ]
    },
    publicBaseUrl: 'https://portal.example',
    privacy: 'private'
  });

  assert.doesNotMatch(body.snippet.description, /Не с нуля/);
  assert.match(body.snippet.description, /Про портал/, 'описание при этом цело');
});

test('урок без глав описывается как прежде', () => {
  const body = buildVideoBody({
    lesson: { title: 'Урок', description: 'Про портал', tags: [], slug: 'urok' },
    publicBaseUrl: 'https://portal.example',
    privacy: 'private'
  });
  assert.match(body.snippet.description, /Про портал\n\nУрок на портале/);
});
