// Работа с Яндекс Диском по токену. В сеть не ходим: fetch подставляется.
// Проверяем разбор ответов и то, что токен не утекает в текст ошибки — он
// уходит и в журнал, и на экран человеку.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listDiskFiles,
  diskDownloadUrl,
  isVideo,
  saveIntegration,
  loadIntegration
} from '../src/services/disk.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = { tokenEncryptionKey: 'a'.repeat(64) };

test('из списка отбираются только видео', () => {
  assert.equal(isVideo({ name: 'urok.mp4', media_type: 'video' }), true);
  assert.equal(isVideo({ name: 'zametki.txt', media_type: 'text' }), false);
  // Диск не всегда проставляет media_type — тогда судим по расширению.
  assert.equal(isVideo({ name: 'urok.mkv' }), true);
  assert.equal(isVideo({ name: 'urok.MOV' }), true);
});

test('список файлов разбирается', async () => {
  const fetchStub = async (url, options) => {
    assert.match(options.headers.Authorization, /^OAuth /);
    assert.match(String(url), /resources\?path=/);
    return {
      ok: true,
      json: async () => ({
        _embedded: {
          items: [
            {
              name: 'urok.mp4',
              path: 'disk:/video/urok.mp4',
              size: 100,
              media_type: 'video',
              modified: '2026-09-03T10:00:00Z',
              type: 'file'
            },
            { name: 'zametki.txt', path: 'disk:/z.txt', size: 10, media_type: 'text', type: 'file' },
            { name: 'papka', path: 'disk:/video/papka', type: 'dir' }
          ]
        }
      })
    };
  };
  const files = await listDiskFiles('token', 'disk:/video', fetchStub);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'urok.mp4');
  assert.equal(files[0].bytes, 100);
});

test('прямая ссылка на скачивание берётся у Диска', async () => {
  const fetchStub = async (url) => {
    assert.match(String(url), /resources\/download\?path=/);
    return { ok: true, json: async () => ({ href: 'https://downloader/file?t=1' }) };
  };
  assert.equal(
    await diskDownloadUrl('token', 'disk:/video/urok.mp4', fetchStub),
    'https://downloader/file?t=1'
  );
});

test('отказ Диска объясняется, но токен в объяснение не попадает', async () => {
  const fetchStub = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' });
  await assert.rejects(listDiskFiles('sekretnyj-token', 'disk:/', fetchStub), (error) => {
    assert.match(error.message, /401/);
    assert.ok(!error.message.includes('sekretnyj-token'));
    return true;
  });
});

test('токен ложится в базу зашифрованным и читается обратно', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveIntegration(pool, config, { name: 'yandex-disk', token: 'секретный-токен' });

    const { rows } = await pool.query(`SELECT token FROM integrations WHERE name = 'yandex-disk'`);
    // В базе — шифротекст, а не читаемая строка: дамп базы не должен быть
    // доступом к диску заказчика.
    assert.ok(!rows[0].token.includes('секретный'));
    assert.match(rows[0].token, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);

    const loaded = await loadIntegration(pool, config, 'yandex-disk');
    assert.equal(loaded.token, 'секретный-токен');
  });
});

test('неподключённый сервис — это null, а не ошибка', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    assert.equal(await loadIntegration(pool, config, 'yandex-disk'), null);
  });
});

test('повторное подключение заменяет токен, а не двоит', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveIntegration(pool, config, { name: 'yandex-disk', token: 'первый' });
    await saveIntegration(pool, config, { name: 'yandex-disk', token: 'второй' });
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM integrations');
    assert.equal(rows[0].n, 1);
    assert.equal((await loadIntegration(pool, config, 'yandex-disk')).token, 'второй');
  });
});
