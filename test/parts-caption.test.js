// Подписи к частям: у каждой — её глава, у первой — заголовок, главы с
// номерами частей и ссылка. Предел Telegram — 1024 знака, ссылка остаётся всегда.
import test from 'node:test';
import assert from 'node:assert/strict';
import { partTitle, buildPartsCaption, MAX_TEXT_LIMIT } from '../src/services/platforms/announcement.js';

const chapter = (number, title, atMs = 0) => ({ number, title, atMs });
const lesson = { slug: 'urok', title: 'Урок про портал' };

test('названия частей — по главам', () => {
  assert.equal(partTitle({ chapters: [], piece: null }, 1, 4), 'Часть 1 из 4');
  assert.equal(
    partTitle({ chapters: [chapter(2, 'Настройка nginx')], piece: null }, 2, 3),
    'Часть 2 из 3 · Настройка nginx'
  );
  assert.equal(
    partTitle({ chapters: [chapter(3, 'А'), chapter(4, 'Б')], piece: null }, 2, 3),
    'Часть 2 из 3 · Главы 3–4'
  );
  assert.equal(
    partTitle({ chapters: [chapter(2, 'Длинная')], piece: { n: 1, of: 2 } }, 2, 4),
    'Глава 2 · 1 из 2 · Длинная'
  );
});

test('подпись — заголовок, главы с номерами частей и ссылка', () => {
  const parts = [
    { chapters: [chapter(1, 'Введение', 0), chapter(2, 'Nginx', 600_000)], piece: null },
    { chapters: [chapter(3, 'Бот', 1_200_000)], piece: null }
  ];
  const caption = buildPartsCaption({ lesson, parts, publicBaseUrl: 'https://p.example', limit: 1024 });
  assert.match(caption, /^Урок про портал/);
  assert.match(caption, /^0:00 Введение — часть 1$/m);
  assert.match(caption, /^20:00 Бот — часть 2$/m);
  assert.match(caption, /https:\/\/p\.example\/lesson\/urok$/);
});

test('глава, разрезанная на куски, в списке один раз — с первой частью', () => {
  const long = chapter(1, 'Всё сразу', 0);
  const parts = [
    { chapters: [long], piece: { n: 1, of: 2 } },
    { chapters: [long], piece: { n: 2, of: 2 } },
    { chapters: [chapter(2, 'Итоги', 3_000_000)], piece: null }
  ];
  const caption = buildPartsCaption({ lesson, parts, publicBaseUrl: 'https://p.example', limit: 1024 });
  assert.equal(caption.match(/Всё сразу/g).length, 1);
  assert.match(caption, /Всё сразу — часть 1/);
  assert.match(caption, /Итоги — часть 3/);
});

test('без глав — заголовок и ссылка', () => {
  const caption = buildPartsCaption({
    lesson,
    parts: [{ chapters: [], piece: null }, { chapters: [], piece: null }],
    publicBaseUrl: 'https://p.example',
    limit: 1024
  });
  assert.equal(caption, 'Урок про портал\n\nhttps://p.example/lesson/urok');
});

test('подпись влезает в предел Telegram, а ссылка остаётся', () => {
  const many = Array.from({ length: 40 }, (_, i) =>
    chapter(i + 1, `Очень длинное название главы номер ${i + 1}`, i * 60_000)
  );
  const caption = buildPartsCaption({
    lesson,
    parts: [{ chapters: many, piece: null }],
    publicBaseUrl: 'https://p.example',
    limit: 1024
  });
  assert.ok(caption.length <= 1024, `длина ${caption.length}`);
  assert.match(caption, /https:\/\/p\.example\/lesson\/urok$/);
  assert.match(caption, /^0:00 /m, 'хотя бы первые главы должны остаться');
});

test('у MAX предел свой, больше', () => {
  assert.equal(MAX_TEXT_LIMIT, 4000);
});
