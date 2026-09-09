// Главы для описания ролика. Чистые функции: ни сети, ни базы.
//
// Правила площадки жёсткие и молчаливые: YouTube показывает главы, только если
// первая начинается ровно с 00:00, их не меньше трёх и каждая не короче десяти
// секунд. Не сходится — не показывается НИ ОДНОЙ, без всякого предупреждения.
// Поэтому проверяем сами и, если не сходится, блок не добавляем: ролик без глав
// честнее ролика с проигнорированными строками.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTimecode,
  validChapters,
  chaptersBlock,
  buildTimeline,
  parseChaptersText
} from '../src/lib/chapters.js';

test('время пишется так, как его читает площадка', () => {
  assert.equal(formatTimecode(0), '0:00');
  assert.equal(formatTimecode(65_000), '1:05');
  assert.equal(formatTimecode(3_930_000), '1:05:30');
  // Часы появляются только когда они есть: «0:05:30» площадка понимает, но
  // человек читает хуже.
  assert.equal(formatTimecode(330_000), '5:30');
});

const good = [
  { atMs: 0, title: 'Что делаем' },
  { atMs: 120_000, title: 'Ставим окружение' },
  { atMs: 600_000, title: 'Первый запуск' }
];

test('годные главы проходят как есть', () => {
  assert.equal(validChapters(good, 1_200_000).length, 3);
});

test('без главы с нуля площадка не покажет ничего — и мы тоже', () => {
  const late = [{ atMs: 30_000, title: 'Начало' }, ...good.slice(1)];
  assert.deepEqual(validChapters(late, 1_200_000), []);
});

test('меньше трёх глав — не главы', () => {
  assert.deepEqual(validChapters(good.slice(0, 2), 1_200_000), []);
});

test('слишком близкие главы отбрасываются целиком', () => {
  // Десять секунд — предел площадки. Пять секунд между главами означают, что
  // модель приняла паузу за смену темы.
  const tight = [
    { atMs: 0, title: 'Раз' },
    { atMs: 5_000, title: 'Два' },
    { atMs: 600_000, title: 'Три' }
  ];
  assert.deepEqual(validChapters(tight, 1_200_000), []);
});

test('главы за пределами записи отбрасываются', () => {
  const beyond = [...good, { atMs: 9_000_000, title: 'Ниоткуда' }];
  const result = validChapters(beyond, 1_200_000);
  assert.equal(result.length, 3, 'лишняя глава убрана, остальные годны');
});

test('порядок восстанавливается, а не ломает главы', () => {
  const shuffled = [good[2], good[0], good[1]];
  assert.deepEqual(
    validChapters(shuffled, 1_200_000).map((chapter) => chapter.atMs),
    [0, 120_000, 600_000]
  );
});

test('пустое название главы делает список негодным', () => {
  const empty = [{ atMs: 0, title: '  ' }, ...good.slice(1)];
  assert.deepEqual(validChapters(empty, 1_200_000), []);
});

test('блок глав читается человеком и площадкой', () => {
  const block = chaptersBlock(good);
  assert.equal(block.split('\n')[0], '0:00 Что делаем');
  assert.match(block, /2:00 Ставим окружение/);
  assert.match(block, /10:00 Первый запуск/);
});

test('негодные главы блока не дают вовсе', () => {
  assert.equal(chaptersBlock(validChapters(good.slice(0, 2), 1_200_000)), '');
});

test('лента времён берёт по реплике на полминуты', () => {
  // Слать все реплики нельзя: у часового урока их под тысячу, и запрос
  // раздувается до бессмысленного.
  const segments = Array.from({ length: 60 }, (_, index) => ({
    startedMs: index * 10_000,
    text: `реплика ${index}`
  }));
  const timeline = buildTimeline(segments).split('\n');

  assert.equal(timeline.length, 20, 'десять минут по полминуты — двадцать строк');
  assert.equal(timeline[0], '0:00 реплика 0');
  assert.equal(timeline[1], '0:30 реплика 3');
});

test('длинная запись не раздувает запрос без предела', () => {
  const segments = Array.from({ length: 5000 }, (_, index) => ({
    startedMs: index * 30_000,
    text: 'речь'
  }));
  assert.ok(buildTimeline(segments).split('\n').length <= 200);
});

test('главы разбираются из текста, каким его правит автор', () => {
  const parsed = parseChaptersText(`
0:00 Что делаем
2:00 Ставим окружение
1:05:30 Итоги
  `);
  assert.deepEqual(parsed, [
    { atMs: 0, title: 'Что делаем' },
    { atMs: 120_000, title: 'Ставим окружение' },
    { atMs: 3_930_000, title: 'Итоги' }
  ]);
});

test('строка без времени в главы не превращается', () => {
  // Автор дописал заметку себе — это не глава, и молча делать её главой нельзя.
  const parsed = parseChaptersText('0:00 Начало\nпосмотреть ещё раз\n5:00 Дальше');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].title, 'Дальше');
});

test('время без названия главой не считается', () => {
  assert.deepEqual(parseChaptersText('0:00'), []);
});
