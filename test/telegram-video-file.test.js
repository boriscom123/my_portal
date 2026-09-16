// Загрузка видео в Telegram и мгновенная пересылка по номеру файла.
//
// Первая загрузка долгая, зато площадка возвращает file_id и хранит файл у
// себя: следующему человеку то же видео уходит одним запросом.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { postVideoToTelegram, sendStoredVideo } from '../src/services/platforms/telegram-channel.js';

async function videoFile() {
  const dir = await mkdtemp(path.join(tmpdir(), 'tg-video-'));
  const file = path.join(dir, 'lesson.mp4');
  await writeFile(file, 'запись урока');
  return file;
}

test('после загрузки площадка возвращает номер файла — его и запоминаем', async () => {
  const file = await videoFile();
  const result = await postVideoToTelegram({
    token: 't',
    channel: '777',
    filePath: file,
    caption: 'Урок',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        result: { message_id: 5, video: { file_id: 'BAACAgIAAxkBAAI', duration: 1029 } }
      })
    })
  });

  assert.equal(result.messageId, '5');
  assert.equal(result.fileId, 'BAACAgIAAxkBAAI', 'номер файла не прочитан');
});

test('повторная отправка идёт по номеру файла: без файла и без ожидания', async () => {
  let seen = null;
  const result = await sendStoredVideo({
    token: 't',
    chatId: '42',
    fileId: 'BAACAgIAAxkBAAI',
    caption: 'Урок целиком',
    fetchImpl: async (url, options) => {
      seen = { url: String(url), body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ ok: true, result: { message_id: 9 } }) };
    }
  });

  assert.match(seen.url, /sendVideo$/);
  assert.equal(seen.body.chat_id, '42');
  // Видео — строкой-номером, а не файлом: ради этого всё и затевалось.
  assert.equal(seen.body.video, 'BAACAgIAAxkBAAI');
  assert.equal(seen.body.caption, 'Урок целиком');
  assert.equal(seen.body.supports_streaming, true);
  assert.equal(result.messageId, '9');
});

test('площадка отказала — говорим её словами', async () => {
  await assert.rejects(
    sendStoredVideo({
      token: 't',
      chatId: '42',
      fileId: 'F',
      caption: 'c',
      fetchImpl: async () => ({
        ok: false,
        status: 400,
        json: async () => ({ description: 'chat not found' })
      })
    }),
    /chat not found/
  );
});
