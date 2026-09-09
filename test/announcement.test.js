// Подпись к посту в канале. Чистые функции: ни сети, ни базы.
//
// Пост живёт дольше отправки — по мере выхода ролика на площадках в него
// добавляются ссылки. Поэтому подпись собирается в одном месте и одинаково: и
// когда её отправляют впервые, и когда переписывают.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnnouncement, TELEGRAM_CAPTION_LIMIT } from '../src/services/platforms/announcement.js';

const lesson = {
  slug: 'urok-15',
  title: 'Планирование веб-портала',
  description: 'Урок о том, как из идеи вырастает техническое задание.'
};

test('в подписи есть заголовок, описание и ссылка на урок', () => {
  const text = buildAnnouncement({
    lesson,
    publicBaseUrl: 'https://portal.example',
    publications: []
  });
  assert.match(text, /Планирование веб-портала/);
  assert.match(text, /из идеи вырастает/);
  assert.match(text, /https:\/\/portal\.example\/lesson\/urok-15/);
});

test('ссылки площадок появляются только у вышедших роликов', () => {
  const text = buildAnnouncement({
    lesson,
    publicBaseUrl: 'https://portal.example',
    publications: [
      { platform: 'youtube', state: 'published', url: 'https://youtu.be/vyshel' },
      { platform: 'rutube', state: 'ready', url: 'https://rutube.ru/video/priva' }
    ]
  });
  // Приватный ролик подписчику не открывается — звать его туда нечестно.
  assert.match(text, /youtu\.be\/vyshel/);
  assert.doesNotMatch(text, /priva/);
  assert.match(text, /YouTube/);
});

test('пост без вышедших роликов ссылок площадок не обещает', () => {
  const text = buildAnnouncement({
    lesson,
    publicBaseUrl: 'https://portal.example',
    publications: [{ platform: 'youtube', state: 'ready', url: 'https://youtu.be/x' }]
  });
  assert.doesNotMatch(text, /youtu\.be/);
});

test('длинное описание подрезается по границе предложения', () => {
  const long = {
    ...lesson,
    description: `${'Первое предложение про портал. '.repeat(40)}Последнее.`
  };
  const text = buildAnnouncement({
    lesson: long,
    publicBaseUrl: 'https://portal.example',
    publications: []
  });
  assert.ok(text.length <= TELEGRAM_CAPTION_LIMIT, `подпись ${text.length} знаков`);
  // Рвать посреди слова нельзя: это выглядит как поломка, а не как сокращение.
  assert.doesNotMatch(text, /предлож\n/);
  // Ссылка на урок обязана уцелеть — ради неё пост и существует.
  assert.match(text, /https:\/\/portal\.example\/lesson\/urok-15/);
});

test('сам канал в ссылки площадок не попадает', () => {
  // Иначе пост в телеграме ссылался бы сам на себя.
  const text = buildAnnouncement({
    lesson,
    publicBaseUrl: 'https://portal.example',
    publications: [
      { platform: 'telegram', state: 'published', url: 'https://t.me/kanal/12' },
      { platform: 'youtube', state: 'published', url: 'https://youtu.be/vyshel' }
    ],
    skipPlatform: 'telegram'
  });
  assert.doesNotMatch(text, /t\.me/);
  assert.match(text, /youtu\.be/);
});
