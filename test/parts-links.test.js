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

test('на карточке урока постов с частями нет', () => {
  const html = platformLinks(publications);
  assert.match(html, /Смотреть на YouTube/);
  assert.match(html, /Смотреть на Telegram/);
  assert.equal(html.match(/Смотреть на Telegram/g).length, 1);
  assert.doesNotMatch(html, /_parts|kanal\/6/);
});
