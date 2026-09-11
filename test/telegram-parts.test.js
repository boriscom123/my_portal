// Отправка частей в Telegram: одна часть — обычный пост с видео, от двух —
// альбом одним запросом. Файлы идут с диска, не читаясь в память целиком.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { postPartsToTelegram } from '../src/services/platforms/telegram-channel.js';

async function files(count) {
  const dir = await mkdtemp(path.join(tmpdir(), 'tg-parts-'));
  const list = [];
  for (let i = 0; i < count; i += 1) {
    const file = path.join(dir, `part-${i + 1}.mp4`);
    await writeFile(file, `видео ${i + 1}`);
    list.push({ path: file, caption: `Часть ${i + 1}` });
  }
  const cover = path.join(dir, 'cover.jpg');
  await writeFile(cover, 'обложка');
  return { parts: list, cover };
}

test('одна часть — обычный пост с видео и обложкой', async () => {
  const { parts, cover } = await files(1);
  let seen = null;
  const result = await postPartsToTelegram({
    apiUrl: 'http://bot-api:8081',
    token: 't',
    channel: '@kanal',
    parts,
    coverPath: cover,
    fetchImpl: async (url, options) => {
      seen = { url, form: options.body };
      return { ok: true, json: async () => ({ ok: true, result: { message_id: 7 } }) };
    }
  });
  assert.equal(seen.url, 'http://bot-api:8081/bott/sendVideo');
  assert.equal(seen.form.get('chat_id'), '@kanal');
  assert.equal(seen.form.get('caption'), 'Часть 1');
  assert.equal(seen.form.get('supports_streaming'), 'true');
  assert.equal(await seen.form.get('video').text(), 'видео 1');
  assert.ok(seen.form.get('cover'), 'обложка не приложена');
  assert.deepEqual(result, { messageId: '7', url: 'https://t.me/kanal/7' });
});

test('несколько частей — альбом одним запросом, подпись у каждой', async () => {
  const { parts, cover } = await files(3);
  let seen = null;
  const result = await postPartsToTelegram({
    token: 't',
    channel: '@kanal',
    parts,
    coverPath: cover,
    fetchImpl: async (url, options) => {
      seen = { url, form: options.body };
      return {
        ok: true,
        json: async () => ({
          ok: true,
          result: [{ message_id: 10 }, { message_id: 11 }, { message_id: 12 }]
        })
      };
    }
  });
  assert.equal(seen.url, 'https://api.telegram.org/bott/sendMediaGroup');
  const media = JSON.parse(seen.form.get('media'));
  assert.equal(media.length, 3);
  assert.deepEqual(
    media.map((item) => item.caption),
    ['Часть 1', 'Часть 2', 'Часть 3']
  );
  assert.ok(media.every((item) => item.type === 'video' && item.supports_streaming));
  assert.deepEqual(
    media.map((item) => item.media),
    ['attach://part0', 'attach://part1', 'attach://part2']
  );
  // Обложка — только у первой: превью альбома в ленте.
  assert.equal(media[0].cover, 'attach://cover');
  assert.equal(media[1].cover, undefined);
  assert.equal(await seen.form.get('part2').text(), 'видео 3');
  assert.deepEqual(result, { messageId: '10', url: 'https://t.me/kanal/10' });
});

test('без обложки — просто без неё', async () => {
  const { parts } = await files(2);
  let form = null;
  await postPartsToTelegram({
    token: 't',
    channel: '-100123',
    parts,
    fetchImpl: async (url, options) => {
      form = options.body;
      return { ok: true, json: async () => ({ ok: true, result: [{ message_id: 1 }, { message_id: 2 }] }) };
    }
  });
  assert.equal(form.get('cover'), null);
  assert.ok(JSON.parse(form.get('media')).every((item) => !('cover' in item)));
});

test('отказ площадки — её словами', async () => {
  const { parts } = await files(2);
  await assert.rejects(
    postPartsToTelegram({
      token: 't',
      channel: '@kanal',
      parts,
      fetchImpl: async () => ({
        ok: false,
        status: 413,
        json: async () => ({ description: 'Request Entity Too Large' })
      })
    }),
    /Telegram отказал \(413\): Request Entity Too Large/
  );
});

test('больше десяти частей в альбом не уходит — и запрос не шлётся', async () => {
  const { parts } = await files(11);
  let called = false;
  await assert.rejects(
    postPartsToTelegram({
      token: 't',
      channel: '@kanal',
      parts,
      fetchImpl: async () => ((called = true), { ok: true })
    }),
    /не больше 10/
  );
  assert.equal(called, false);
});
