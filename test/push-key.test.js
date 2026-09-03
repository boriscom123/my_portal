// Проверка ключа подписки.
//
// Браузер принимает applicationServerKey только массивом байт, а сервер отдаёт
// строку base64url. Ошибка в переводе роняет подписку у человека на телефоне и
// на сервере никак не видна — поэтому проверяем здесь.
import test from 'node:test';
import assert from 'node:assert/strict';
import { keyToBytes } from '../public/push-key.js';

test('ключ VAPID разворачивается в 65 байт несжатой точки', () => {
  // Настоящий по форме ключ: 87 знаков base64url без дополнения.
  const key =
    'BKd0FOtDZ6E8Z9zvS7DkLzWlR3n6xk0PujC7SsxHqZ3xJk9m5UbXk4hQz1nB0cLZ8fWv2tGqYkR7pM6sTn1oQ4E';
  const bytes = keyToBytes(key);
  assert.equal(bytes.length, 65);
  // Первый байт 4 — признак несжатой точки P-256. Иначе браузер отвергнет ключ.
  assert.equal(bytes[0], 4);
});

test('дополнение base64 восстанавливается', () => {
  // Строки длиной 86, 87 и 88 знаков требуют разного дополнения; ошибка в этом
  // месте даёт исключение прямо в браузере.
  for (const length of [86, 87, 88]) {
    const key = 'B'.repeat(length);
    assert.doesNotThrow(() => keyToBytes(key), `не разобралась строка из ${length} знаков`);
  }
});
