// Монтаж записи: выбрасывание пауз. Границы кусков и пересчёт времён — то
// место, где ошибка не видна на глаз: субтитры просто начнут опаздывать тем
// сильнее, чем дальше к концу урока.
import test from 'node:test';
import assert from 'node:assert/strict';
import { keepRanges, remapSegments, mapTime, trimmedDurationMs, concatList } from '../src/lib/trim.js';
import { parseSilences } from '../src/lib/ffmpeg.js';
import { readSettings, toAssColor, DEFAULT_SETTINGS } from '../src/lib/settings.js';

// Минута записи: тишина с 10-й по 30-ю секунду и с 40-й по 50-ю.
const silences = [
  { startMs: 10_000, endMs: 30_000 },
  { startMs: 40_000, endMs: 50_000 }
];

test('остаётся всё, что не тишина', () => {
  const ranges = keepRanges(silences, { durationSeconds: 60 });
  assert.equal(ranges.length, 3);
  assert.equal(trimmedDurationMs(ranges), 31_000, 'из минуты остаётся полминуты');
});

test('запас по краям не даёт обрубить слово', () => {
  const [range] = keepRanges([{ startMs: 10_000, endMs: 20_000 }], { durationSeconds: 60 });
  // Срез вплотную к речи приходится на первый и последний звук слова.
  assert.equal(range.startedMs, 0);
  assert.equal(range.endedMs, 10_250);
});

test('куски не вылезают за пределы записи', () => {
  const ranges = keepRanges([{ startMs: 30_000, endMs: null }], { durationSeconds: 60 });
  // Незакрытый промежуток — запись кончилась тишиной.
  assert.equal(ranges.length, 1);
  assert.ok(ranges[0].endedMs <= 60_000);
  assert.ok(ranges[0].startedMs >= 0);
});

test('без длительности резать нечего', () => {
  assert.deepEqual(keepRanges(silences, { durationSeconds: 0 }), []);
});

test('запись без единой паузы остаётся целиком', () => {
  const ranges = keepRanges([], { durationSeconds: 60 });
  assert.deepEqual(ranges, [{ startedMs: 0, endedMs: 60_000 }]);
});

test('времена реплик пересчитываются на новую шкалу', () => {
  const ranges = keepRanges(silences, { durationSeconds: 60 });
  // Реплика начиналась на 55-й секунде, а после выброшенных тридцати секунд
  // тишины должна оказаться на 25-й. По старым временам субтитры опаздывали бы
  // на полминуты.
  const moved = remapSegments([{ startedMs: 55_000, endedMs: 58_000, text: 'финал' }], ranges);
  assert.equal(moved[0].startedMs, mapTime(55_000, ranges));
  assert.ok(moved[0].startedMs < 30_000, 'реплика должна была подъехать ближе к началу');
  assert.equal(moved[0].endedMs - moved[0].startedMs, 3000, 'длительность реплики сохраняется');
});

test('длинная реплика поверх вырезанного становится короче', () => {
  // После отсечения тишины реплика бывает длинной и перекрывает паузу целиком.
  const ranges = keepRanges(silences, { durationSeconds: 60 });
  const [moved] = remapSegments([{ startedMs: 5000, endedMs: 45_000, text: 'через паузы' }], ranges);
  assert.equal(moved.startedMs, 5000);
  assert.ok(moved.endedMs < 45_000, 'реплика обязана ужаться вместе с записью');
});

test('реплика целиком из тишины исчезает, а не съезжает', () => {
  // Показывать её негде: этого места в смонтированной записи больше нет.
  const ranges = keepRanges(silences, { durationSeconds: 60 });
  assert.deepEqual(
    remapSegments([{ startedMs: 12_000, endedMs: 20_000, text: 'молчание' }], ranges),
    []
  );
});

test('вывод silencedetect разбирается в промежутки', () => {
  // Настоящие строки из журнала ffmpeg на уроке заказчика.
  const parsed = parseSilences([
    '[Parsed_silencedetect_0 @ 0x1] silence_start: 21.709729',
    '[Parsed_silencedetect_0 @ 0x1] silence_end: 24.738687 | silence_duration: 3.028958',
    'size=N/A time=00:04:06.87 bitrate=N/A',
    '[Parsed_silencedetect_0 @ 0x1] silence_start: 39.366083'
  ]);
  assert.deepEqual(parsed, [
    { startMs: 21_710, endMs: 24_739 },
    // Промежуток без конца — запись кончилась тишиной; выбрасывать его нельзя.
    { startMs: 39_366, endMs: null }
  ]);
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
