// Особое доверие к сертификату MAX. Проверяется не сеть, а рамка: этот корень
// не должен расползтись по остальным запросам портала.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { maxFetch } from '../src/lib/max-fetch.js';

const CERT = 'certs/russian-trusted-root-ca.pem';

test('корень доверия лежит рядом и это сертификат', async () => {
  const pem = await readFile(new URL(`../${CERT}`, import.meta.url), 'utf8');
  assert.match(pem, /^-----BEGIN CERTIFICATE-----/);
  assert.match(pem, /-----END CERTIFICATE-----/);
});

test('сертификат не только лежит на диске, но и учтён в репозитории', () => {
  // Проверка отдельная от предыдущей, и вот почему. Правило «*.pem» в
  // .gitignore унесло сертификат из репозитория, а на диске у автора он
  // остался: тесты и сборка шли зелёными, а на сборщике GitHub падал КАЖДЫЙ
  // файл, который поднимает приложение, — маршруты добираются до кода
  // площадок. Файл на диске о таком молчит; сказать может только git.
  let tracked = '';
  try {
    tracked = execFileSync('git', ['ls-files', '--error-unmatch', CERT], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch (error) {
    // Нет самого git — проверить нечем: так бывает в образе проекта и в
    // распакованном архиве, и выдумывать там отказ не за что. А вот отказ
    // самого git — это ответ «файла в репозитории нет», и молчать о нём нельзя.
    if (error.code === 'ENOENT') return;
    assert.fail(`${CERT} не учтён в репозитории — проверьте .gitignore`);
  }
  assert.match(tracked.trim(), /russian-trusted-root-ca\.pem$/);
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
