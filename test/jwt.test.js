// Проверка токена сессии: свой — читается, чужой и просроченный — нет.
import test from 'node:test';
import assert from 'node:assert/strict';
import { signSession, verifySession, signShortLived, verifyShortLived } from '../src/lib/jwt.js';

const secret = 'x'.repeat(32);

test('свой токен читается обратно', () => {
  const token = signSession({ userId: 5, role: 'admin' }, secret);
  assert.deepEqual(verifySession(token, secret), { userId: 5, role: 'admin' });
});

test('токен, подписанный другим ключом, не принимается', () => {
  const token = signSession({ userId: 5, role: 'admin' }, 'y'.repeat(32));
  assert.equal(verifySession(token, secret), null);
});

test('мусор вместо токена не роняет проверку', () => {
  assert.equal(verifySession('не-токен', secret), null);
  assert.equal(verifySession('', secret), null);
});

test('короткоживущий токен читается и протухает', async () => {
  assert.deepEqual(verifyShortLived(signShortLived({ nonce: 'abc' }, secret, 60), secret), {
    nonce: 'abc'
  });
  const expired = signShortLived({ nonce: 'abc' }, secret, 0);
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(verifyShortLived(expired, secret), null);
});
