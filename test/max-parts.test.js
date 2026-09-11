// Отправка частей в MAX. Документация молчит, примет ли MAX несколько видео в
// одном сообщении: пробуем, а при отказе шлём постами подряд — и повтор после
// сбоя продолжает с непришедшей части.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { postPartsToMax, postVideoToMax } from '../src/services/platforms/max-channel.js';

async function parts(count) {
  const dir = await mkdtemp(path.join(tmpdir(), 'max-parts-'));
  const list = [];
  for (let i = 0; i < count; i += 1) {
    const file = path.join(dir, `part-${i + 1}.mp4`);
    await writeFile(file, `видео ${i + 1}`);
    list.push({ path: file, caption: `Часть ${i + 1} из ${count}` });
  }
  return list;
}

/** Подставной MAX: загрузки отвечают токенами, сообщения — по правилу. */
function fakeMax({ acceptMulti = true, multiStatus = 400, failAt = null } = {}) {
  const messages = [];
  const uploaded = [];
  let uploads = 0;
  let sentCount = 0;
  return {
    messages,
    uploaded,
    fetchImpl: async (url, options = {}) => {
      if (String(url).includes('/uploads?type=video')) {
        uploads += 1;
        return {
          ok: true,
          json: async () => ({ url: `https://upload.example/${uploads}`, token: `v${uploads}` })
        };
      }
      const body = JSON.parse(options.body);
      if (body.attachments.length > 1 && !acceptMulti) {
        return { ok: false, status: multiStatus, text: async () => 'too many attachments' };
      }
      sentCount += 1;
      if (failAt === sentCount) return { ok: false, status: 502, text: async () => 'bad gateway' };
      messages.push(body);
      return { ok: true, json: async () => ({ message: { body: { mid: `mid.${sentCount}` } } }) };
    },
    uploadFetch: async (url, options) => {
      uploaded.push(await options.body.get('data').text());
      return { ok: true, json: async () => ({}) };
    }
  };
}

test('MAX принял все части одним сообщением', async () => {
  const max = fakeMax();
  const result = await postPartsToMax({
    token: 't',
    channel: '-1',
    parts: await parts(3),
    text: 'Главы…',
    ...max
  });
  assert.equal(max.messages.length, 1);
  assert.deepEqual(
    max.messages[0].attachments,
    [
      { type: 'video', payload: { token: 'v1' } },
      { type: 'video', payload: { token: 'v2' } },
      { type: 'video', payload: { token: 'v3' } }
    ]
  );
  assert.equal(max.messages[0].text, 'Главы…');
  assert.deepEqual(max.uploaded, ['видео 1', 'видео 2', 'видео 3']);
  assert.deepEqual(result, { messageId: 'mid.1', url: null, multiVideo: true });
});

test('не принял несколько видео — постами подряд, первый с текстом', async () => {
  const max = fakeMax({ acceptMulti: false });
  const saved = [];
  const result = await postPartsToMax({
    token: 't',
    channel: '-1',
    parts: await parts(3),
    text: 'Главы…',
    onProgress: async (progress) => saved.push([...progress.sent]),
    ...max
  });
  assert.equal(max.messages.length, 3);
  assert.equal(max.messages[0].text, 'Главы…');
  assert.equal(max.messages[1].text, 'Часть 2 из 3');
  assert.ok(max.messages.every((message) => message.attachments.length === 1));
  assert.equal(result.multiVideo, false);
  assert.equal(result.messageId, 'mid.1');
  assert.deepEqual(saved.at(-1), ['mid.1', 'mid.2', 'mid.3']);
});

test('способ уже известен — сразу постами подряд, без пробы', async () => {
  const max = fakeMax({ acceptMulti: false });
  await postPartsToMax({
    token: 't',
    channel: '-1',
    parts: await parts(2),
    text: 'Главы…',
    multiVideo: false,
    ...max
  });
  // Две загрузки, а не четыре: пробного сообщения со всеми частями не было.
  assert.equal(max.uploaded.length, 2);
  assert.equal(max.messages.length, 2);
});

test('повтор после сбоя продолжает с непришедшей части', async () => {
  const max = fakeMax({ acceptMulti: false });
  const result = await postPartsToMax({
    token: 't',
    channel: '-1',
    parts: await parts(3),
    text: 'Главы…',
    multiVideo: false,
    progress: { sent: ['mid.old1', 'mid.old2'] },
    ...max
  });
  // Две части уже в канале — уходит только третья.
  assert.equal(max.messages.length, 1);
  assert.equal(max.messages[0].text, 'Часть 3 из 3');
  assert.equal(result.messageId, 'mid.old1');
});

test('сбой посередине — ушедшие части записаны, ошибка наружу', async () => {
  const max = fakeMax({ acceptMulti: false, failAt: 2 });
  const saved = [];
  await assert.rejects(
    postPartsToMax({
      token: 't',
      channel: '-1',
      parts: await parts(3),
      text: 'Главы…',
      onProgress: async (progress) => saved.push([...progress.sent]),
      ...max
    }),
    /MAX отказал \(502\)/
  );
  assert.deepEqual(saved.at(-1), ['mid.1']);
});

test('сбой самой площадки на пробе — это отказ, а не повод слать подряд', async () => {
  const max = fakeMax({ acceptMulti: false, multiStatus: 503 });
  await assert.rejects(
    postPartsToMax({ token: 't', channel: '-1', parts: await parts(2), text: 'Главы…', ...max }),
    /MAX отказал \(503\)/
  );
  assert.equal(max.messages.length, 0);
});

test('вертикальный ролик уходит как прежде', async () => {
  const max = fakeMax();
  const [part] = await parts(1);
  const result = await postVideoToMax({
    token: 't',
    channel: '-1',
    filePath: part.path,
    caption: 'Ролик',
    ...max
  });
  assert.deepEqual(max.messages[0].attachments, [{ type: 'video', payload: { token: 'v1' } }]);
  assert.deepEqual(result, { messageId: 'mid.1', url: null });
});
