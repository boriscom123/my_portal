// Монтаж записи: выбрасывание пауз. Границы кусков и пересчёт времён — то
// место, где ошибка не видна на глаз: субтитры просто начнут опаздывать тем
// сильнее, чем дальше к концу урока.
import test from 'node:test';
import assert from 'node:assert/strict';
import { keepRanges, remapSegments, trimmedDurationMs, concatList } from '../src/lib/trim.js';
import { readSettings, toAssColor, DEFAULT_SETTINGS } from '../src/lib/settings.js';

const segments = [
  { startedMs: 1000, endedMs: 3000, text: 'первая' },
  { startedMs: 3500, endedMs: 5000, text: 'сразу за ней' },
  { startedMs: 60_000, endedMs: 62_000, text: 'после долгой паузы' }
];

test('соседние реплики сливаются, долгая пауза вырезается', () => {
  const ranges = keepRanges(segments, { minPauseSeconds: 2, durationSeconds: 120 });
  assert.equal(ranges.length, 2);
  // Между первой и второй репликой полсекунды — это дыхание, а не пауза:
  // вырезать его значит сделать урок неслушаемым.
  assert.deepEqual(ranges[0], { startedMs: 750, endedMs: 5250 });
  assert.equal(trimmedDurationMs(ranges), 7000, 'из двух минут остаётся семь секунд');
});

test('запас по краям не даёт обрубить слово', () => {
  const [range] = keepRanges([{ startedMs: 10_000, endedMs: 12_000 }], { durationSeconds: 60 });
  assert.ok(range.startedMs < 10_000, 'срез пришёлся бы на первый звук слова');
  assert.ok(range.endedMs > 12_000);
});

test('куски не вылезают за пределы записи', () => {
  const [range] = keepRanges([{ startedMs: 59_900, endedMs: 60_500 }], { durationSeconds: 60 });
  assert.ok(range.endedMs <= 60_000);
  assert.ok(range.startedMs >= 0);
});

test('без речи резать нечего', () => {
  assert.deepEqual(keepRanges([], { durationSeconds: 60 }), []);
});

test('времена реплик пересчитываются на новую шкалу', () => {
  const ranges = keepRanges(segments, { minPauseSeconds: 2, durationSeconds: 120 });
  const moved = remapSegments(segments, ranges);
  assert.equal(moved.length, 3);
  // Реплика была на шестидесятой секунде, а после выброшенных пятидесяти пяти
  // секунд тишины должна оказаться на пятой. По старым временам субтитры
  // опаздывали бы почти на минуту.
  assert.equal(moved[2].startedMs, 4750);
  assert.equal(moved[2].text, 'после долгой паузы');
  // Порядок и длительности реплик сохраняются.
  assert.ok(moved[0].startedMs < moved[1].startedMs);
  assert.equal(moved[0].endedMs - moved[0].startedMs, 2000);
});

test('реплика из вырезанного куска исчезает, а не съезжает', () => {
  // Показывать её негде: этого места в смонтированной записи больше нет.
  const ranges = [{ startedMs: 0, endedMs: 5000 }];
  const moved = remapSegments([{ startedMs: 30_000, endedMs: 31_000, text: 'вырезано' }], ranges);
  assert.deepEqual(moved, []);
});

test('список кусков составляется в формате склейки', () => {
  const list = concatList('/app/media/lesson-1/source.mp4', [{ startedMs: 750, endedMs: 5250 }]);
  assert.match(list, /file '\/app\/media\/lesson-1\/source\.mp4'/);
  assert.match(list, /inpoint 0\.750/);
  assert.match(list, /outpoint 5\.250/);
});

test('кавычка в пути не рвёт список', () => {
  // Имя файла приходит от человека: апостроф в нём оборвал бы строку списка,
  // и ffmpeg взял бы не тот файл.
  const list = concatList("/media/урок 'первый'.mp4", [{ startedMs: 0, endedMs: 1000 }]);
  assert.match(list, /file '\/media\/урок '\\''первый'\\''\.mp4'/);
});

test('настройки от человека проверяются, а не подставляются как есть', () => {
  // Значения попадают в аргументы ffmpeg: непроверенные они и сломают сборку,
  // и дадут не тот вид подписей.
  const checked = readSettings({
    subtitleOutline: '99',
    subtitleColor: 'red; rm -rf /',
    cutPauses: 'on',
    minPauseSeconds: 'сколько-нибудь'
  });
  assert.equal(checked.subtitleOutline, 4, 'толщина ограничена сверху');
  assert.equal(checked.subtitleColor, DEFAULT_SETTINGS.subtitleColor, 'негодный цвет — умолчание');
  assert.equal(checked.cutPauses, true, 'галочка из формы приходит строкой on');
  assert.equal(checked.minPauseSeconds, DEFAULT_SETTINGS.minPauseSeconds);
});

test('пустые настройки дают умолчания целиком', () => {
  assert.deepEqual(readSettings(), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings(null), DEFAULT_SETTINGS);
});

test('цвет переводится в порядок, который понимает libass', () => {
  // Там свой порядок — синий первым. Перепутанный даёт не ошибку, а красные
  // подписи вместо синих.
  assert.equal(toAssColor('#ffcc00'), '&H00CCFF');
  assert.equal(toAssColor('#ffffff'), '&HFFFFFF');
  assert.equal(toAssColor('не цвет'), '&HFFFFFF');
});
