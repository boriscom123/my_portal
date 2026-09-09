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

test('в MAX картинка кладётся двумя шагами и прикладывается токеном', async () => {
  // Ссылку MAX принимает на словах, а на деле отвечает «Failed to upload image»:
  // он её честно скачивает и всё равно отказывает. Поэтому файл грузится на их
  // узел, а в пост идёт полученный токен.
  const calls = [];
  const fetchStub = async (url, options) => {
    calls.push(String(url));
    if (String(url).includes('/uploads')) {
      return { ok: true, json: async () => ({ url: 'https://iu.oneme.ru/uploadImage?a=1' }) };
    }
    const body = JSON.parse(options.body);
    assert.equal(options.headers.Authorization, 'max-token');
    assert.equal(body.attachments[0].type, 'image');
    // Токен из загрузки, а не ссылка.
    assert.equal(body.attachments[0].payload.token, 'photo-token');
    assert.match(String(url), /chat_id=-1001/);
    return { ok: true, json: async () => ({ message: { body: { mid: 'mid-7' } } }) };
  };

  const uploadFetch = async (url, options) => {
    assert.equal(String(url), 'https://iu.oneme.ru/uploadImage?a=1');
    assert.equal(options.method, 'POST');
    return { ok: true, json: async () => ({ photos: { id1: { token: 'photo-token' } } }) };
  };

  const result = await postToMax({
    token: 'max-token',
    channel: '-1001',
    filePath: new URL('./fixtures/cover.jpg', import.meta.url).pathname,
    caption: 'Заголовок',
    fetchImpl: fetchStub,
    uploadFetch
  });

  assert.equal(result.messageId, 'mid-7');
  assert.match(calls[0], /\/uploads\?type=image/);
});

test('правка поста в MAX идёт тем же путём, но методом PUT', async () => {
  let sent = null;
  const fetchStub = async (url, options) => {
    if (String(url).includes('/uploads')) {
      return { ok: true, json: async () => ({ url: 'https://iu.oneme.ru/uploadImage' }) };
    }
    sent = { url: String(url), method: options.method };
    return { ok: true, json: async () => ({}) };
  };

  await editMaxPost({
    token: 'max-token',
    messageId: 'mid-7',
    caption: 'Заголовок с ссылками',
    filePath: new URL('./fixtures/cover.jpg', import.meta.url).pathname,
    fetchImpl: fetchStub,
    uploadFetch: async () => ({ ok: true, json: async () => ({ photos: { a: { token: 'tk' } } }) })
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
    postToMax({
      token: 'max-token',
      channel: '-1',
      filePath: new URL('./fixtures/cover.jpg', import.meta.url).pathname,
      caption: 'c',
      fetchImpl: fetchStub,
      uploadFetch: async () => ({ ok: true, json: async () => ({ photos: { a: { token: 't' } } }) })
    }),
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
      filePath: new URL('./fixtures/cover.jpg', import.meta.url).pathname,
      caption: 'c',
      fetchImpl: async (url) =>
        String(url).includes('/uploads')
          ? { ok: true, json: async () => ({ url: 'https://iu.oneme.ru/u' }) }
          : { ok: true, json: async () => body },
      uploadFetch: async () => ({ ok: true, json: async () => ({ photos: { a: { token: 't' } } }) })
    });
    assert.equal(result.messageId, 'mid-1');
  }
});

test('ответ без номера поста — не молчаливая удача', async () => {
  await assert.rejects(
    postToMax({
      token: 't',
      channel: '-1',
      filePath: new URL('./fixtures/cover.jpg', import.meta.url).pathname,
      caption: 'c',
      fetchImpl: async (url) =>
        String(url).includes('/uploads')
          ? { ok: true, json: async () => ({ url: 'https://iu.oneme.ru/u' }) }
          : { ok: true, json: async () => ({ ok: true }) },
      uploadFetch: async () => ({ ok: true, json: async () => ({ photos: { a: { token: 't' } } }) })
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

  const byLink = await findMaxChat({
    token: 't',
    needle: 'https://max.ru/id253_biz2',
    fetchImpl: fetchStub
  });
  assert.equal(byLink.chatId, '-78307129940137');
  // Ссылку на канал запоминаем тут же: у поста в MAX своего адреса нет, и на
  // карточке урока вести некуда, кроме как в канал.
  assert.equal(byLink.link, 'https://max.ru/id253_biz2');

  const byTitle = await findMaxChat({ token: 't', needle: 'Solo AI Journey', fetchImpl: fetchStub });
  assert.equal(byTitle.chatId, '-78307129940137');

  assert.equal(
    await findMaxChat({ token: 't', needle: 'https://max.ru/chuzhoy', fetchImpl: fetchStub }),
    null
  );
});
