// Особое доверие к сертификату MAX. Проверяется не сеть, а рамка: этот корень
// не должен расползтись по остальным запросам портала.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { maxFetch } from '../src/lib/max-fetch.js';

test('корень доверия лежит в репозитории и это сертификат', async () => {
  const pem = await readFile(new URL('../certs/russian-trusted-root-ca.pem', import.meta.url), 'utf8');
  assert.match(pem, /^-----BEGIN CERTIFICATE-----/);
  assert.match(pem, /-----END CERTIFICATE-----/);
});

test('чужому адресу особое доверие не достаётся', () => {
  // Иначе корень Минцифры незаметно распространился бы на запросы к Google и
  // Яндексу — тем самым, куда портал ходит с чужими токенами.
  assert.throws(
    () => maxFetch('https://accounts.google.com/o/oauth2/v2/auth'),
    /только для platform-api2\.max\.ru/
  );
  assert.throws(() => maxFetch('https://max.ru.example.com/messages'), /только для/);
});

test('адрес самой площадки принимается', () => {
  // Тут запрос уйдёт в сеть, поэтому проверяем только то, что рамка пропустила:
  // обещание возвращено, а не выброшено исключение.
  const promise = maxFetch('https://platform-api2.max.ru/me', { headers: { Authorization: 'x' } });
  assert.ok(promise instanceof Promise);
  promise.catch(() => {});
});
