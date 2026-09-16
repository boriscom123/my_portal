// Подпись к посту с началом урока: сколько минут уехало в канал, где лежит
// запись целиком и где о ней подробности. Предел Telegram — 1024 знака, и
// ссылки остаются всегда: ради них пост и читают.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFirstPartCaption, MAX_TEXT_LIMIT } from '../src/services/platforms/announcement.js';

const lesson = { slug: 'urok', title: 'Урок про портал' };

test('подпись: полное видео — на площадке, подробности — на сайте и в каналах', () => {
  // Заказчик 2026-09-16: в канал уходит начало урока, полная запись — на
  // YouTube, а сайт и соседний канал идут строкой «подробности».
  const caption = buildFirstPartCaption({
    lesson,
    part: { startMs: 0, endMs: 5 * 60_000 },
    durationMs: 40 * 60_000,
    publicBaseUrl: 'https://p.example',
    publications: [
      { platform: 'youtube', state: 'published', url: 'https://youtu.be/x' },
      { platform: 'max', state: 'published', url: 'https://max.ru/kanal' },
      // Приватный ролик подписчику не откроется — звать туда нечестно.
      { platform: 'rutube', state: 'ready', url: 'https://rutube.ru/y' }
    ],
    skipPlatform: 'telegram',
    limit: 1024
  });
  assert.match(caption, /^Урок про портал\n\n/);
  assert.match(caption, /Первые 5 минут урока\. Полное видео — на YouTube:\nhttps:\/\/youtu\.be\/x/);
  assert.match(
    caption,
    /Подробности — на сайте и в каналах:\nhttps:\/\/p\.example\/lesson\/urok\nhttps:\/\/max\.ru\/kanal$/
  );
  assert.doesNotMatch(caption, /rutube/i, 'приватный ролик в подпись не идёт');
});

test('полной записи ещё нигде нет — строки про полное видео не появляется', () => {
  const caption = buildFirstPartCaption({
    lesson,
    part: { startMs: 0, endMs: 5 * 60_000 },
    durationMs: 40 * 60_000,
    publicBaseUrl: 'https://p.example',
    publications: [{ platform: 'max', state: 'published', url: 'https://max.ru/kanal' }],
    skipPlatform: 'telegram',
    limit: 1024
  });
  assert.doesNotMatch(caption, /Полное видео/, 'ссылки на полную запись нет — и обещать нечего');
  assert.match(caption, /^Урок про портал\n\nПервые 5 минут урока\.\n\nПодробности/);
});

test('запись влезла целиком — ни «первых минут», ни ссылки на полное видео', () => {
  const caption = buildFirstPartCaption({
    lesson,
    part: { startMs: 0, endMs: 12 * 60_000 },
    durationMs: 12 * 60_000,
    publicBaseUrl: 'https://p.example',
    publications: [{ platform: 'youtube', state: 'published', url: 'https://youtu.be/x' }],
    skipPlatform: 'telegram',
    limit: 1024
  });
  assert.doesNotMatch(caption, /перв\S* \d+ минут/i);
  assert.doesNotMatch(caption, /Полное видео/, 'весь урок и так в посте');
  assert.match(caption, /Подробности — на сайте:\nhttps:\/\/p\.example\/lesson\/urok$/);
});

test('длинный заголовок укорачивается, а ссылки остаются', () => {
  const caption = buildFirstPartCaption({
    lesson: { slug: 'urok', title: 'Очень длинный заголовок урока. '.repeat(60) },
    part: { startMs: 0, endMs: 5 * 60_000 },
    durationMs: 40 * 60_000,
    publicBaseUrl: 'https://p.example',
    publications: [{ platform: 'youtube', state: 'published', url: 'https://youtu.be/x' }],
    skipPlatform: 'telegram',
    limit: 1024
  });
  assert.ok(caption.length <= 1024, `длина ${caption.length}`);
  assert.match(caption, /https:\/\/youtu\.be\/x/);
  assert.match(caption, /https:\/\/p\.example\/lesson\/urok$/);
});

test('у MAX предел свой, больше', () => {
  assert.equal(MAX_TEXT_LIMIT, 4000);
});
