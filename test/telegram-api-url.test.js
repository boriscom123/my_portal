// Адрес сервера Telegram Bot API. Главное — все обращения бота портала идут по
// одной настройке: бот, переехавший на свой сервер, в облако ходить не должен.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { createTelegramChannel } from '../src/services/notify/telegram.js';
import {
  postToTelegram,
  checkTelegramChannel,
  checkBotApi,
  DEFAULT_API_URL
} from '../src/services/platforms/telegram-channel.js';

const ok = (result) => ({ ok: true, status: 200, json: async () => ({ ok: true, result }) });

const minimal = {
  PUBLIC_BASE_URL: 'https://p.example',
  DB_HOST: 'db',
  DB_NAME: 'portal',
  DB_USER: 'portal',
  DB_PASS: 'x',
  JWT_SECRET: 'x'.repeat(32)
};

test('без настройки адрес — облако Telegram, со своим — свой и без хвостового слэша', () => {
  assert.equal(loadConfig(minimal).telegram.apiUrl, DEFAULT_API_URL);
  assert.equal(loadConfig({ ...minimal, TELEGRAM_API_URL: '' }).telegram.apiUrl, DEFAULT_API_URL);
  assert.equal(
    loadConfig({ ...minimal, TELEGRAM_API_URL: 'http://claudeservice-telegram-bot-api-1:8081/' }).telegram.apiUrl,
    'http://claudeservice-telegram-bot-api-1:8081'
  );
});

test('посты в канал идут по настроенному адресу', async () => {
  const urls = [];
  await postToTelegram({
    apiUrl: 'http://bot-api:8081',
    token: 't',
    channel: '@kanal',
    photoUrl: null,
    caption: 'текст',
    fetchImpl: async (url) => (urls.push(url), ok({ message_id: 1 }))
  });
  await checkTelegramChannel({
    apiUrl: 'http://bot-api:8081',
    token: 't',
    channel: '@kanal',
    fetchImpl: async (url) => (urls.push(url), ok({ username: 'bot' }))
  });
  assert.equal(urls.length, 3);
  assert.ok(urls.every((url) => url.startsWith('http://bot-api:8081/bott/')), urls.join('\n'));
});

test('без адреса — облако, как было', async () => {
  let seen = null;
  await postToTelegram({
    token: 't',
    channel: '@kanal',
    photoUrl: null,
    caption: 'текст',
    fetchImpl: async (url) => ((seen = url), ok({ message_id: 1 }))
  });
  assert.equal(seen, 'https://api.telegram.org/bott/sendMessage');
});

test('уведомления идут по тому же адресу', async () => {
  let seen = null;
  const send = createTelegramChannel(
    { publicBaseUrl: 'https://p.example', telegram: { botToken: 't', apiUrl: 'http://bot-api:8081' } },
    async (url) => ((seen = url), { ok: true })
  );
  await send(1, { title: 'Т', body: 'б', url: '/' });
  assert.equal(seen, 'http://bot-api:8081/bott/sendMessage');
});

test('проверка связи отвечает именем бота или причиной', async () => {
  const good = await checkBotApi({
    apiUrl: 'http://bot-api:8081',
    token: 't',
    fetchImpl: async () => ok({ username: 'solo_bot' })
  });
  assert.deepEqual(good, { ok: true, username: 'solo_bot' });

  const down = await checkBotApi({
    apiUrl: 'http://bot-api:8081',
    token: 't',
    fetchImpl: async () => {
      throw new Error('connect ECONNREFUSED');
    }
  });
  assert.equal(down.ok, false);
  assert.match(down.message, /сервер Telegram Bot API недоступен/);

  const refused = await checkBotApi({
    token: 't',
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ description: 'Unauthorized' }) })
  });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /401: Unauthorized/);
});
