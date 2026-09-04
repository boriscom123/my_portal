// Вертикальные нарезки. Сам ffmpeg не проверяем — он чужой и рабочий;
// проверяем то, что решаем мы: откуда резать, как подрезать субтитры под
// фрагмент и как получить вертикаль из горизонтального кадра.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickClipRanges, shiftSegments } from '../src/jobs/make-clips.js';
import { ffmpegArgsForClip, findComplaint } from '../src/lib/ffmpeg.js';

/** Урок с речью: реплика каждые пять секунд на протяжении получаса. */
function speech(count = 360, everyMs = 5000) {
  return Array.from({ length: count }, (_, i) => ({
    startedMs: i * everyMs,
    endedMs: i * everyMs + 4000,
    text: `реплика номер ${i} с достаточным числом знаков для веса`
  }));
}

test('фрагменты берутся из разных частей урока и не длиннее минуты', () => {
  const ranges = pickClipRanges(speech(), 1800);
  assert.equal(ranges.length, 3);
  for (const range of ranges) {
    const seconds = (range.endedMs - range.startedMs) / 1000;
    // Вертикальные ролики живут секундами: минута — потолок площадок.
    assert.ok(seconds > 0 && seconds <= 60, `фрагмент длиной ${seconds} с`);
  }
  // Из разных третей: три одинаковых ролика с начала урока автору не нужны.
  assert.ok(ranges[1].startedMs > ranges[0].startedMs);
  assert.ok(ranges[2].startedMs > ranges[1].startedMs);
});

test('фрагмент не вылезает за конец урока', () => {
  const segments = [{ startedMs: 1_790_000, endedMs: 1_795_000, text: 'финал урока' }];
  const [range] = pickClipRanges(segments, 1800);
  assert.ok(range.endedMs <= 1_800_000, 'конец фрагмента за пределами записи');
  assert.ok(range.startedMs >= 0);
});

test('без речи нарезать нечего — это не ошибка', () => {
  // Урок мог целиком показывать экран под музыку. Падать здесь незачем:
  // конвейер должен дойти до обложки.
  assert.deepEqual(pickClipRanges([], 1800), []);
  assert.deepEqual(pickClipRanges(speech(), 0), []);
});

test('два фрагмента не берутся из одного места', () => {
  // Вся речь в первой минуте: трети всё равно есть, но ролик должен выйти
  // один, а не три одинаковых.
  const ranges = pickClipRanges(speech(12, 5000), 1800);
  assert.equal(ranges.length, 1);
});

test('субтитры фрагмента сдвинуты к нулю и подрезаны', () => {
  const segments = [
    { startedMs: 0, endedMs: 3000, text: 'до фрагмента' },
    { startedMs: 60_000, endedMs: 63_000, text: 'внутри' },
    { startedMs: 100_000, endedMs: 103_000, text: 'после фрагмента' }
  ];
  const shifted = shiftSegments(segments, 60_000, 105_000);
  // Перемотка до -i обнуляет времена: без сдвига подписи на десятой минуте
  // урока опережали бы речь на десять минут.
  assert.equal(shifted.length, 2);
  assert.deepEqual(shifted[0], { startedMs: 0, endedMs: 3000, text: 'внутри' });
});

test('реплика на границе фрагмента обрезается по его концу', () => {
  const segments = [{ startedMs: 10_000, endedMs: 90_000, text: 'длинная' }];
  const [shifted] = shiftSegments(segments, 0, 45_000);
  assert.equal(shifted.endedMs, 45_000, 'подпись не должна висеть после конца ролика');
});

test('кадр обрезается в вертикаль и в него вшиваются субтитры', () => {
  const args = ffmpegArgsForClip({
    input: '/media/source.mp4',
    subtitles: '/media/clip-1.srt',
    startSeconds: 60,
    durationSeconds: 45,
    output: '/media/clip-1.mp4'
  });
  const filter = args[args.indexOf('-vf') + 1];
  // Кадр берётся по центру, а не сжимается: сжатый горизонтальный даёт поля
  // сверху и снизу, и ролик выглядит перезалитым с другого сервиса.
  assert.match(filter, /crop=ih\*9\/16:ih/);
  assert.match(filter, /scale=1080:1920/);
  // Площадки коротких роликов отдельный файл субтитров не принимают.
  assert.match(filter, /subtitles=/);
  // Перемотка ДО -i: иначе ffmpeg читает часовой файл с начала на каждом
  // фрагменте, и пять нарезок занимают машину на час.
  assert.ok(args.indexOf('-ss') < args.indexOf('-i'));
});

test('знаки в пути к субтитрам не рвут фильтр', () => {
  // Запятые и двоеточия ffmpeg считает разделителями фильтра: урок с таким
  // именем файла уронил бы нарезку.
  const args = ffmpegArgsForClip({
    input: '/media/a.mp4',
    subtitles: "/media/lesson: 1, часть 'вторая'.srt",
    startSeconds: 0,
    durationSeconds: 45,
    output: '/media/c.mp4'
  });
  const filter = args[args.indexOf('-vf') + 1];
  assert.match(filter, /lesson\\: 1\\, часть \\'вторая\\'/);
});

test('фильтр называет шрифт по имени', () => {
  const args = ffmpegArgsForClip({
    input: '/media/a.mp4',
    subtitles: '/media/c.srt',
    startSeconds: 0,
    durationSeconds: 45,
    output: '/media/c.mp4'
  });
  // Без имени libass просит Arial, которого в образе нет, и подписи молча не
  // рисуются: ролик выходит пустым, а ffmpeg — успешным.
  assert.match(args[args.indexOf('-vf') + 1], /FontName=DejaVu Sans/);
});

test('пропавший шрифт считается отказом, а не мелочью', () => {
  const failOn = /fontconfig|failed to find any fallback|Glyph 0x/i;
  const output = [
    '[Parsed_subtitles_2 @ 0x1] Failed to load fontconfig fonts!',
    '[Parsed_subtitles_2 @ 0x1] fontselect: failed to find any fallback with glyph 0x0'
  ];
  // Настоящий вывод из образа без шрифтов: ffmpeg вышел с кодом 0 и отдал
  // ролик без единой подписи. Ради подписей нарезка и делается.
  assert.match(findComplaint(output, failOn), /Failed to load fontconfig/);
  assert.equal(findComplaint(['frame= 45 fps=12'], failOn), null);
  assert.equal(findComplaint(output, null), null, 'без назначенной жалобы не придираемся');
});

test('подпись мелкая и внизу кадра, а не в середине', () => {
  const args = ffmpegArgsForClip({
    input: '/media/a.mp4',
    subtitles: '/media/c.srt',
    startSeconds: 0,
    durationSeconds: 45,
    output: '/media/c.mp4'
  });
  const style = args[args.indexOf('-vf') + 1];
  // libass считает размер и отступ от условной высоты кадра в 288 точек, а не
  // от настоящих 1920: всё умножается примерно на семь. С Fontsize=18 буквы
  // заняли шестую часть экрана, а MarginV=90 поднял подпись в середину кадра —
  // проверено глазами на настоящем ролике.
  assert.match(style, /Fontsize=10\b/);
  assert.match(style, /MarginV=40\b/);
  // Обводка тоже умножается на семь: полтора давали десять точек черноты
  // вокруг каждой буквы, и на готовом ролике это выглядело жирно.
  assert.match(style, /Outline=0\.8\b/);
});
