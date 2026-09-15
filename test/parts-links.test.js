// Посты с частями видео и анонсы. В подписи анонса ссылок на посты с частями нет:
// это пост в том же канале. А кнопка «Смотреть на Telegram» на карточке урока
// ведёт как раз на пост с видео — анонс без видео смотреть нечего; сырое имя
// «telegram_parts» на кнопке было бы поломкой.
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

test('урок выложен на площадку дважды — ссылка одна, на последний', () => {
  // Автор выложил полную запись после смонтированной: на канале два ролика, и
  // звать зрителя надо на тот, что выложен последним.
  const twice = [
    { platform: 'youtube', state: 'published', url: 'https://youtu.be/old', updatedAt: '2026-09-13T10:00:00Z' },
    { platform: 'youtube', state: 'published', url: 'https://youtu.be/new', updatedAt: '2026-09-15T10:00:00Z' },
    // Последняя выкладка ещё не вышла — ссылка остаётся на вышедший ролик.
    { platform: 'rutube', state: 'published', url: 'https://rutube.ru/old', updatedAt: '2026-09-13T10:00:00Z' },
    { platform: 'rutube', state: 'ready', url: 'https://rutube.ru/new', updatedAt: '2026-09-15T10:00:00Z' }
  ];
  const text = buildAnnouncement({
    lesson: { slug: 'urok', title: 'Урок', description: '' },
    publicBaseUrl: 'https://p.example',
    publications: twice
  });
  assert.match(text, /youtu\.be\/new/);
  assert.doesNotMatch(text, /youtu\.be\/old/);
  assert.match(text, /rutube\.ru\/old/);

  const html = platformLinks(twice);
  assert.equal(html.match(/Смотреть на YouTube/g).length, 1);
  assert.match(html, /youtu\.be\/new/);
});

test('кнопки Telegram и MAX ведут на пост с видео урока, а не на анонс', () => {
  // Заказчик 2026-09-15: «Смотреть на Telegram» должно открывать сам урок —
  // пост с видео частями, — а не анонс, где видео нет.
  const html = platformLinks(publications);
  assert.match(html, /href="https:\/\/youtu\.be\/abc"[^>]*>Смотреть на YouTube/);
  assert.match(html, /href="https:\/\/t\.me\/kanal\/6"[^>]*>Смотреть на Telegram/);
  assert.match(html, /href="https:\/\/max\.ru\/kanal"[^>]*>Смотреть на MAX/);
  assert.equal(html.match(/Смотреть на Telegram/g).length, 1);
  assert.doesNotMatch(html, /kanal\/5/, 'анонс без видео стал кнопкой');
  assert.doesNotMatch(html, /_parts/, 'сырое имя площадки на кнопке');

  // Постов с видео ещё нет — кнопок Telegram и MAX нет вовсе.
  const onlyAnnouncements = platformLinks(
    publications.filter((item) => !item.platform.endsWith('_parts'))
  );
  assert.doesNotMatch(onlyAnnouncements, /Telegram|MAX/);
  assert.match(onlyAnnouncements, /Смотреть на YouTube/);
});
