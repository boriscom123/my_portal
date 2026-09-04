// Поиск по словам внутри урока — то, ради чего расшифровка хранится отрезками,
// а не сплошным текстом. Проверяется, что находка знает свою секунду, что
// русская морфология работает и что черновики через поиск не утекают.
import test from 'node:test';
import assert from 'node:assert/strict';
import { searchSegments } from '../src/services/search.js';
import { timeLabel } from '../src/views/search.js';
import { saveLesson } from '../src/services/lessons.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

async function seed(pool) {
  const lesson = await saveLesson(pool, {
    slug: 'docker-1',
    title: 'Docker',
    status: 'published',
    publishedAt: new Date()
  });
  await pool.query(
    `INSERT INTO transcript_segments (lesson_id, started_ms, ended_ms, text) VALUES
     ($1, 0, 5000, 'сегодня разберём контейнеры и образы'),
     ($1, 65000, 70000, 'теперь про миграции базы данных')`,
    [lesson.id]
  );
  return lesson;
}

test('слово находится с точностью до секунды', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    const found = await searchSegments(pool, 'миграции', 10);
    assert.equal(found.length, 1);
    assert.equal(found[0].lessonSlug, 'docker-1');
    // 65-я секунда — туда и должна вести находка.
    assert.equal(found[0].startedMs, 65000);
  });
});

test('русская морфология учитывается', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    // В тексте «контейнеры», ищем «контейнер» — без русского словаря не нашлось бы.
    const found = await searchSegments(pool, 'контейнер', 10);
    assert.equal(found.length, 1);
  });
});

test('найденное слово подсвечено', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    const [found] = await searchSegments(pool, 'миграции', 10);
    // Подсветку собирает postgres из нашего же текста: она вставляется в
    // страницу как разметка, поэтому важно, что она вообще приходит.
    assert.match(found.excerpt, /<mark>/);
  });
});

test('черновики в поиск не попадают', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'chernovik', title: 'Черновик' });
    await pool.query(
      `INSERT INTO transcript_segments (lesson_id, started_ms, ended_ms, text)
       VALUES ($1, 0, 1000, 'секретное слово')`,
      [lesson.id]
    );
    // Иначе невышедший урок утёк бы через поиск любому, кто угадает слово.
    assert.deepEqual(await searchSegments(pool, 'секретное', 10), []);
  });
});

test('пустой запрос ничего не ищет', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    assert.deepEqual(await searchSegments(pool, '   ', 10), []);
    assert.deepEqual(await searchSegments(pool, null, 10), []);
  });
});

test('запрос со знаками не роняет поиск', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    // plainto_tsquery съедает операторы сам, но проверить это дешевле, чем
    // однажды получить пятисотую от строки поиска.
    assert.deepEqual(await searchSegments(pool, "' & | ! ()", 10), []);
  });
});

test('время находки показывается человеку', () => {
  assert.equal(timeLabel(65000), '1:05');
  assert.equal(timeLabel(3930000), '1:05:30');
  assert.equal(timeLabel(0), '0:00');
});
