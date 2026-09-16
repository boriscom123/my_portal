// Подпись к посту с началом урока: сколько минут уехало в канал, ссылка на
// урок и площадки, где смотреть целиком. Предел Telegram — 1024 знака, и
// ссылка остаётся всегда: ради неё пост и читают.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFirstPartCaption, MAX_TEXT_LIMIT } from '../src/services/platforms/announcement.js';

const lesson = { slug: 'urok', title: 'Урок про портал' };

test('подпись к началу урока: сколько минут в посте и где смотреть целиком', () => {
  // Заказчик 2026-09-16: в канал уходит обложка и первый кусок видео, а
  // остальное зритель смотрит на площадках — подпись обязана это сказать.
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
  assert.match(caption, /^Урок про портал/);
  assert.match(caption, /перв\S* 5 минут/i);
  assert.match(caption, /https:\/\/p\.example\/lesson\/urok/);
  assert.match(caption, /YouTube: https:\/\/youtu\.be\/x/);
  assert.match(caption, /MAX: https:\/\/max\.ru\/kanal/);
  assert.doesNotMatch(caption, /rutube/i, 'приватный ролик в подпись не идёт');
});

test('запись влезла целиком — подпись не обещает «первые минуты»', () => {
  const caption = buildFirstPartCaption({
    lesson,
    part: { startMs: 0, endMs: 12 * 60_000 },
    durationMs: 12 * 60_000,
    publicBaseUrl: 'https://p.example',
    publications: [],
    skipPlatform: 'telegram',
    limit: 1024
  });
  assert.doesNotMatch(caption, /перв\S* \d+ минут/i);
  assert.match(caption, /https:\/\/p\.example\/lesson\/urok$/);
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
  assert.match(caption, /YouTube: https:\/\/youtu\.be\/x$/);
  assert.match(caption, /https:\/\/p\.example\/lesson\/urok/);
});

test('у MAX предел свой, больше', () => {
  assert.equal(MAX_TEXT_LIMIT, 4000);
});
