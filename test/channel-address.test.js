// Приведение адреса канала к тому виду, который понимает площадка.
//
// Человек копирует ссылку на канал — она у него под рукой, — а Telegram по
// ссылке канал не ищет и отвечает «chat not found». Заказчик так и сделал в
// первый же раз. Чинить надо портал: принимать то, что копируется.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChannel } from '../src/services/platforms/announcement.js';

test('ссылка на канал превращается в имя', () => {
  assert.equal(normalizeChannel('telegram', 'https://t.me/solo_ai_journey'), '@solo_ai_journey');
  assert.equal(normalizeChannel('telegram', 'http://t.me/solo_ai_journey/'), '@solo_ai_journey');
  assert.equal(normalizeChannel('telegram', 't.me/solo_ai_journey'), '@solo_ai_journey');
});

test('имя и собака остаются как есть', () => {
  assert.equal(normalizeChannel('telegram', '@solo_ai_journey'), '@solo_ai_journey');
  assert.equal(normalizeChannel('telegram', 'solo_ai_journey'), '@solo_ai_journey');
  assert.equal(normalizeChannel('telegram', '  @solo_ai_journey  '), '@solo_ai_journey');
});

test('числовой идентификатор закрытого канала не трогаем', () => {
  // У закрытого канала имени нет вовсе, и собака перед номером его сломает.
  assert.equal(normalizeChannel('telegram', '-1001234567890'), '-1001234567890');
});

test('ссылка-приглашение адресом не притворяется', () => {
  // t.me/+abc — это приглашение, а не адрес: постить по нему нельзя, и молча
  // превращать его в @+abc значит отложить непонятную ошибку на потом.
  assert.equal(normalizeChannel('telegram', 'https://t.me/+AbCdEf'), null);
  assert.equal(normalizeChannel('telegram', 'https://t.me/joinchat/AbCdEf'), null);
});

test('у MAX адрес остаётся тем, что дала площадка', () => {
  assert.equal(normalizeChannel('max', ' -1001 '), '-1001');
  assert.equal(normalizeChannel('max', 'kanal'), 'kanal');
});
