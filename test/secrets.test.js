// Шифрование чужих токенов. Токен Диска — это доступ ко всему диску
// заказчика: открытым текстом в базе он превращает любой дамп в утечку.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret } from '../src/lib/secrets.js';

const key = 'a'.repeat(64); // 32 байта в hex

test('зашифрованное расшифровывается обратно', () => {
  const box = encryptSecret('секретный токен', key);
  assert.equal(decryptSecret(box, key), 'секретный токен');
});

test('в шифротексте нет исходного текста', () => {
  assert.ok(!encryptSecret('секретный токен', key).includes('секрет'));
});

test('два шифрования одного текста дают разное', () => {
  // Одинаковый шифротекст выдавал бы, что два подключения используют один
  // токен, — и позволял бы сравнивать секреты, не расшифровывая их.
  assert.notEqual(encryptSecret('odin', key), encryptSecret('odin', key));
});

test('чужой ключ не расшифровывает', () => {
  const box = encryptSecret('секрет', key);
  assert.throws(() => decryptSecret(box, 'b'.repeat(64)));
});

test('подмена шифротекста замечается', () => {
  // Без проверки подлинности можно было бы подставить в базу свой токен.
  const box = encryptSecret('секрет', key);
  assert.throws(() => decryptSecret(box.slice(0, -4) + 'ffff', key));
});

test('ключ неверной длины отвергается сразу', () => {
  // Короткий ключ — это молчаливое ослабление шифрования; лучше падение при
  // старте, чем данные, зашифрованные всерьёз только на вид.
  assert.throws(() => encryptSecret('секрет', 'aa'), /32 байта/);
});
