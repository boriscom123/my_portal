// Проверка чтения окружения. Задача теста — закрепить два правила: без
// обязательной переменной приложение не стартует молча, а падает с её именем;
// адрес портала берётся только из окружения и нормализуется.
// Вызывается из `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

// Минимальный набор, при котором приложение имеет право стартовать.
const minimal = {
  PUBLIC_BASE_URL: 'https://soloaijourney.online/',
  DB_HOST: 'postgres',
  DB_NAME: 'portal',
  DB_USER: 'portal',
  DB_PASS: 'secret',
  JWT_SECRET: 'x'.repeat(32)
};

test('нет обязательной переменной — падаем с её именем', () => {
  const env = { ...minimal };
  delete env.JWT_SECRET;
  assert.throws(() => loadConfig(env), /JWT_SECRET/);
});

test('хвостовой слэш в адресе срезается', () => {
  assert.equal(loadConfig(minimal).publicBaseUrl, 'https://soloaijourney.online');
});

test('порт по умолчанию 3004', () => {
  assert.equal(loadConfig(minimal).port, 3004);
});

test('список админов разбирается в пары провайдер-идентификатор', () => {
  const config = loadConfig({ ...minimal, ADMIN_IDENTITIES: 'google:42, tg_widget:7 ' });
  assert.deepEqual(config.adminIdentities, [
    { provider: 'google', externalId: '42' },
    { provider: 'tg_widget', externalId: '7' }
  ]);
});

test('имя бота читается и очищается от собаки', () => {
  assert.equal(loadConfig({ ...minimal, TELEGRAM_BOT_USERNAME: '@solo_ai_journey_bot' }).telegram.botUsername, 'solo_ai_journey_bot');
  assert.equal(loadConfig(minimal).telegram.botUsername, '');
});

test('очередь и облако читаются с умолчаниями', () => {
  const config = loadConfig(minimal);
  assert.equal(config.redis.prefix, 'portal:');
  assert.match(config.redis.url, /^redis:\/\//);
  // Без ключей облака портал обязан подниматься: витрина и вход от них не
  // зависят, а конвейер сам скажет, что не настроен.
  assert.equal(config.yandex.apiKey, '');
});

test('номер бота выделяется из токена', () => {
  const config = loadConfig({ ...minimal, TELEGRAM_BOT_TOKEN: '123456789:AAA-секрет' });
  assert.equal(config.telegram.botId, '123456789');
  assert.equal(loadConfig(minimal).telegram.botId, '');
});

test('пустой список админов не даёт пустых пар', () => {
  assert.deepEqual(loadConfig(minimal).adminIdentities, []);
});
