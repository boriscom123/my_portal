// Запросы к YouTube. В сеть не ходим: fetch подставляется.
//
// Проверяем то, чего не увидишь глазами на готовом ролике: что загрузка
// открывает возобновляемую сессию и шлёт тело потоком, а не целиком в памяти (у
// воркера потолок 1.4 ГБ, и файл на 700 МБ его убьёт), и что чужие ошибки
// переводятся человеку — исчерпанная квота это не поломка.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  startUploadSession,
  uploadVideoFile,
  insertCaptions,
  setThumbnail,
  readVideoPrivacy,
  describeYoutubeFailure
} from '../src/services/platforms/youtube.js';

test('сессия загрузки открывается с размером файла и правами', async () => {
  const fetchStub = async (url, options) => {
    assert.match(String(url), /uploadType=resumable/);
    assert.equal(options.headers['X-Upload-Content-Length'], '700');
    assert.equal(options.headers.Authorization, 'Bearer access-1');
    return { ok: true, headers: new Headers({ location: 'https://upload.example/session-1' }) };
  };

  const sessionUrl = await startUploadSession({
    token: 'access-1',
    body: { snippet: {}, status: {} },
    fileBytes: 700,
    fetchImpl: fetchStub
  });
  assert.equal(sessionUrl, 'https://upload.example/session-1');
});

test('сессия без адреса — отказ, а не молчание', async () => {
  const fetchStub = async () => ({ ok: true, headers: new Headers({}) });
  await assert.rejects(
    startUploadSession({ token: 'a', body: {}, fileBytes: 1, fetchImpl: fetchStub }),
    /адрес сессии/
  );
});

test('файл уходит потоком, а не строкой в памяти', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'youtube-'));
  const file = path.join(dir, 'urok.mp4');
  await writeFile(file, 'x'.repeat(1024));

  const fetchStub = async (url, options) => {
    assert.equal(String(url), 'https://upload.example/session-1');
    assert.equal(options.method, 'PUT');
    // Строка или буфер здесь означали бы весь файл в памяти.
    assert.ok(
      typeof options.body === 'object' && typeof options.body.pipe === 'function',
      'тело обязано быть потоком'
    );
    assert.equal(options.duplex, 'half', 'без duplex Node не отправляет поток');
    return { ok: true, json: async () => ({ id: 'video-1' }) };
  };

  const result = await uploadVideoFile({
    sessionUrl: 'https://upload.example/session-1',
    filePath: file,
    fileBytes: 1024,
    fetchImpl: fetchStub
  });
  assert.equal(result.videoId, 'video-1');
});

test('субтитры уходят отдельным запросом', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'youtube-'));
  const file = path.join(dir, 'subtitles.srt');
  await writeFile(file, '1\n00:00:01,000 --> 00:00:02,000\nречь\n');

  let asked = null;
  const fetchStub = async (url, options) => {
    asked = { url: String(url), options };
    return { ok: true, json: async () => ({ id: 'caption-1' }) };
  };

  await insertCaptions({
    token: 'access-1',
    videoId: 'video-1',
    filePath: file,
    fetchImpl: fetchStub
  });
  assert.match(asked.url, /captions/);
  assert.match(asked.url, /part=snippet/);
  assert.equal(asked.options.headers.Authorization, 'Bearer access-1');
});

test('обложка уходит картинкой, а не формой', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'youtube-'));
  const file = path.join(dir, 'cover.jpg');
  await writeFile(file, 'jpeg-bytes');

  const fetchStub = async (url, options) => {
    assert.match(String(url), /thumbnails\/set\?videoId=video-1/);
    assert.equal(options.headers['Content-Type'], 'image/jpeg');
    return { ok: true, json: async () => ({}) };
  };
  await setThumbnail({ token: 'access-1', videoId: 'video-1', filePath: file, fetchImpl: fetchStub });
});

test('приватность ролика читается', async () => {
  const fetchStub = async (url) => {
    assert.match(String(url), /videos\?part=status&id=video-1/);
    return { ok: true, json: async () => ({ items: [{ status: { privacyStatus: 'public' } }] }) };
  };
  assert.equal(
    await readVideoPrivacy({ token: 'access-1', videoId: 'video-1', fetchImpl: fetchStub }),
    'public'
  );
});

test('удалённый ролик не выдаёт себя за приватный', async () => {
  const fetchStub = async () => ({ ok: true, json: async () => ({ items: [] }) });
  assert.equal(
    await readVideoPrivacy({ token: 'access-1', videoId: 'gone', fetchImpl: fetchStub }),
    null
  );
});

test('исчерпанная квота называется квотой, а не поломкой', () => {
  const text = describeYoutubeFailure(403, {
    error: { errors: [{ reason: 'quotaExceeded' }], message: 'The request cannot be completed…' }
  });
  assert.match(text, /норма|квота/i);
  assert.doesNotMatch(text, /The request cannot be completed/);
});

test('незнакомый отказ показывается как есть, а не проглатывается', () => {
  const text = describeYoutubeFailure(400, { error: { message: 'Invalid video metadata' } });
  assert.match(text, /Invalid video metadata/);
  assert.match(text, /400/);
});

test('отказ площадки долетает до вызывающего текстом', async () => {
  const fetchStub = async () => ({
    ok: false,
    status: 403,
    json: async () => ({ error: { errors: [{ reason: 'quotaExceeded' }] } })
  });
  await assert.rejects(
    startUploadSession({ token: 'a', body: {}, fileBytes: 1, fetchImpl: fetchStub }),
    /норма/
  );
});
