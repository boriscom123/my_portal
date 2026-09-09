// Запросы к каналам Telegram и MAX. В сеть не ходим: fetch подставляется.
//
// Обе площадки умеют главное — отправить пост картинкой и потом ПОПРАВИТЬ его,
// когда появятся ссылки на вышедшие ролики. Правка, а не второй пост:
// подписчики не должны получать второе уведомление об одном уроке.
import test from 'node:test';
import assert from 'node:assert/strict';
import { postToTelegram, editTelegramPost } from '../src/services/platforms/telegram-channel.js';
import { postToMax, editMaxPost, findMaxChat } from '../src/services/platforms/max-channel.js';

test('в Telegram уходит картинка ссылкой и подпись', async () => {
  let sent = null;
  const fetchStub = async (url, options) => {
    sent = { url: String(url), body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 42 } }) };
  };

  const result = await postToTelegram({
    token: 'bot-token',
    channel: '@kanal',
    photoUrl: 'https://portal.example/media/asset/9',
    caption: 'Заголовок\n\nhttps://portal.example/lesson/urok',
    fetchImpl: fetchStub
  });

  assert.match(sent.url, /bot-token\/sendPhoto/);
  assert.equal(sent.body.chat_id, '@kanal');
  // Картинка ссылкой, а не файлом: файл в 700 МБ туда всё равно не влезет, а
  // обложку площадка заберёт сама.
  assert.equal(sent.body.photo, 'https://portal.example/media/asset/9');
  assert.equal(result.messageId, '42');
  assert.equal(result.url, 'https://t.me/kanal/42');
});

test('отказ Telegram объясняется его же словами', async () => {
  const fetchStub = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ ok: false, description: 'chat not found' })
  });
  await assert.rejects(
    postToTelegram({ token: 't', channel: '@net', photoUrl: 'u', caption: 'c', fetchImpl: fetchStub }),
    /chat not found/
  );
});

test('правка поста в Telegram идёт по номеру сообщения', async () => {
  let sent = null;
  const fetchStub = async (url, options) => {
    sent = { url: String(url), body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ ok: true, result: {} }) };
  };

  await editTelegramPost({
    token: 'bot-token',
    channel: '@kanal',
    messageId: '42',
    caption: 'Заголовок\n\nYouTube: https://youtu.be/x',
    fetchImpl: fetchStub
  });

  assert.match(sent.url, /editMessageCaption/);
  assert.equal(sent.body.message_id, 42);
  assert.match(sent.body.caption, /youtu\.be/);
});

test('в MAX уходит тот же пост, а токен — заголовком', async () => {
  let sent = null;
  const fetchStub = async (url, options) => {
    sent = { url: String(url), options, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ message: { body: { mid: 'mid-7' } } }) };
  };

  const result = await postToMax({
    token: 'max-token',
    channel: '-1001',
    photoUrl: 'https://portal.example/media/asset/9',
    caption: 'Заголовок',
    fetchImpl: fetchStub
  });

  assert.match(sent.url, /platform-api2\.max\.ru\/messages/);
  assert.match(sent.url, /chat_id=-1001/);
  // Токен MAX передаётся заголовком, а не в адресе: адреса попадают в журналы.
  assert.equal(sent.options.headers.Authorization, 'max-token');
  assert.equal(sent.body.attachments[0].type, 'image');
  assert.equal(result.messageId, 'mid-7');
});

test('правка поста в MAX идёт тем же путём, но методом PUT', async () => {
  let sent = null;
  const fetchStub = async (url, options) => {
    sent = { url: String(url), method: options.method };
    return { ok: true, json: async () => ({}) };
  };

  await editMaxPost({
    token: 'max-token',
    messageId: 'mid-7',
    caption: 'Заголовок с ссылками',
    photoUrl: 'https://portal.example/media/asset/9',
    fetchImpl: fetchStub
  });

  assert.equal(sent.method, 'PUT');
  assert.match(sent.url, /message_id=mid-7/);
});

test('отказ MAX не выдаёт токен наружу', async () => {
  const fetchStub = async () => ({
    ok: false,
    status: 401,
    text: async () => 'invalid token max-token'
  });
  await assert.rejects(
    postToMax({ token: 'max-token', channel: '-1', photoUrl: 'u', caption: 'c', fetchImpl: fetchStub }),
    (error) => {
      assert.doesNotMatch(error.message, /max-token/);
      return true;
    }
  );
});

test('номер поста MAX ищется в нескольких местах ответа', async () => {
  // Устройство ответа взято из документации, а не из живого обмена. Пустой
  // номер означал бы пост, который в канале есть, а портал его не знает и
  // потом не поправит.
  for (const body of [
    { message: { body: { mid: 'mid-1' } } },
    { body: { mid: 'mid-1' } },
    { mid: 'mid-1' }
  ]) {
    const result = await postToMax({
      token: 't',
      channel: '-1',
      photoUrl: 'u',
      caption: 'c',
      fetchImpl: async () => ({ ok: true, json: async () => body })
    });
    assert.equal(result.messageId, 'mid-1');
  }
});

test('ответ без номера поста — не молчаливая удача', async () => {
  await assert.rejects(
    postToMax({
      token: 't',
      channel: '-1',
      photoUrl: 'u',
      caption: 'c',
      fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true }) })
    }),
    /не сказал его номер/
  );
});

test('номер канала MAX находится по ссылке и по названию', async () => {
  // Под рукой у человека ссылка вида https://max.ru/id…_biz2 — её он и вставит.
  // Площадка сама отдаёт её в списке чатов бота, так что сопоставить их — наша
  // работа, а не его.
  const chats = {
    chats: [
      { chat_id: -78307129940137, title: 'Solo AI Journey', link: 'https://max.ru/id253_biz2' },
      { chat_id: -11, title: 'Другой', link: 'https://max.ru/drugoy' }
    ]
  };
  const fetchStub = async () => ({ ok: true, json: async () => chats });

  assert.equal(
    await findMaxChat({ token: 't', needle: 'https://max.ru/id253_biz2', fetchImpl: fetchStub }),
    '-78307129940137'
  );
  assert.equal(
    await findMaxChat({ token: 't', needle: 'Solo AI Journey', fetchImpl: fetchStub }),
    '-78307129940137'
  );
  assert.equal(
    await findMaxChat({ token: 't', needle: 'https://max.ru/chuzhoy', fetchImpl: fetchStub }),
    null
  );
});
