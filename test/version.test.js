// Проверка того, что каркас проекта собран: ESM-импорт работает, тест-раннер
// видит файлы, версия читается из package.json, а не вписана в код.
// Вызывается из `npm test` и из CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { version } from '../src/version.js';

test('версия проекта совпадает с package.json', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(version, pkg.version);
});
