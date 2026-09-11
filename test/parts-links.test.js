// Посты с частями видео — не площадки, на которых «вышел урок». Ссылка на пост
// в этом канале уже есть — это анонс, — и вторая «Смотреть на Telegram» рядом
// с ней выглядела бы ошибкой, а сырое имя «telegram_parts» — поломкой.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnnouncement } from '../src/services/platforms/announcement.js';
import { platformLinks } from '../src/views/platform-links.js';

const publications = [
  { platform: 'youtube', state: 'published', url: 'https://youtu.be/abc' },
  { platform: 'telegram', state: 'published', url: 'https://t.me/kanal/5' },
  { platform: 'telegram_parts', state: 'published', url: 'https://t.me/kanal/6' },
  { platform: 'max_parts', state: 'published', url: 'https://max.ru/kanal' }
];

test('анонс не ссылается на посты с частями', () => {
  const text = buildAnnouncement({
    lesson: { slug: 'urok', title: 'Урок', description: '' },
    publicBaseUrl: 'https://p.example',
    publications,
    skipPlatform: 'max'
  });
  assert.match(text, /YouTube: https:\/\/youtu\.be\/abc/);
  assert.match(text, /Telegram: https:\/\/t\.me\/kanal\/5/);
  assert.doesNotMatch(text, /_parts|kanal\/6|max\.ru/);
});

test('на карточке урока постов с частями нет', () => {
  const html = platformLinks(publications);
  assert.match(html, /Смотреть на YouTube/);
  assert.match(html, /Смотреть на Telegram/);
  assert.equal(html.match(/Смотреть на Telegram/g).length, 1);
  assert.doesNotMatch(html, /_parts|kanal\/6/);
});
