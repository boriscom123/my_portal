// Предел размера части зависит от того, куда портал отправляет.
//
// Заказчик 2026-09-16 получил «Telegram отказал (413): Request Entity Too
// Large»: запись урока на 250 МБ уехала одним куском. Части резались с
// расчётом на свой сервер Bot API (до 2 ГБ), а бот обращался к облачному
// api.telegram.org — тот берёт от бота не больше 50 МБ.
import test from 'node:test';
import assert from 'node:assert/strict';
import { partsLimit, PARTS_LIMITS, TELEGRAM_CLOUD_LIMIT } from '../src/jobs/publish-lesson-parts.js';

test('в облако части режутся по 50 МБ, на свой сервер Bot API — по 2 ГБ', () => {
  // Адреса нет и адрес облака — это одно и то же: бот говорит с облаком.
  assert.equal(partsLimit('telegram_parts', ''), TELEGRAM_CLOUD_LIMIT);
  assert.equal(partsLimit('telegram_parts', 'https://api.telegram.org'), TELEGRAM_CLOUD_LIMIT);

  // Свой сервер снимает предел: ради этого его и поднимают.
  assert.equal(
    partsLimit('telegram_parts', 'http://claudeservice-telegram-bot-api-1:8081'),
    PARTS_LIMITS.telegram_parts
  );

  // У MAX свой предел, и адрес Bot API его не касается.
  assert.equal(partsLimit('max_parts', ''), PARTS_LIMITS.max_parts);
  assert.equal(partsLimit('max_parts', 'http://claudeservice-telegram-bot-api-1:8081'), PARTS_LIMITS.max_parts);

  // Предел облака — тот же, что у одиночного видео: 50 МБ.
  assert.equal(TELEGRAM_CLOUD_LIMIT, 50 * 1024 * 1024);
});
