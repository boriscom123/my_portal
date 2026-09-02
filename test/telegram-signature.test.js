// Проверка подписи виджета Telegram. Вход по этому пути — не OAuth: клиент
// присылает данные о себе сам, и единственное, что отличает настоящего
// пользователя от подделки, — правильный HMAC. Ошибка здесь равна дыре во
// всей авторизации, поэтому проверяются и подделка, и протухшая давность.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyTelegramWidget } from '../src/lib/telegram-signature.js';

const botToken = '123456:ABC-DEF';

/** Собирает подписанный набор полей так же, как это делает Telegram. */
function signed(fields) {
  const checkString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');
  const secret = crypto.createHash('sha256').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
  return { ...fields, hash };
}

const nowSeconds = 1_800_000_000;
const fresh = { id: '7', first_name: 'Пётр', auth_date: String(nowSeconds - 10) };

test('настоящая подпись принимается', () => {
  assert.equal(verifyTelegramWidget(signed(fresh), botToken, { nowSeconds }), true);
});

test('подменённое поле ломает подпись', () => {
  const data = signed(fresh);
  data.id = '8';
  assert.equal(verifyTelegramWidget(data, botToken, { nowSeconds }), false);
});

test('подпись чужим токеном не принимается', () => {
  assert.equal(verifyTelegramWidget(signed(fresh), 'другой:токен', { nowSeconds }), false);
});

test('старые данные не принимаются', () => {
  const old = signed({ ...fresh, auth_date: String(nowSeconds - 90_000) });
  assert.equal(verifyTelegramWidget(old, botToken, { nowSeconds }), false);
});

test('без hash не принимается', () => {
  assert.equal(verifyTelegramWidget({ ...fresh }, botToken, { nowSeconds }), false);
});

test('без настроенного бота не принимается ничего', () => {
  assert.equal(verifyTelegramWidget(signed(fresh), '', { nowSeconds }), false);
});
