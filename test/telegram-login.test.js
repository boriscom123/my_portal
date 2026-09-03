// Вход через Telegram обычным переходом, без чужого iframe.
//
// Виджет Telegram дважды подводил: в приложении с домашнего экрана он то
// появлялся, то нет, а починить чужой iframe снаружи нельзя. Здесь проверяется
// ссылка входа и страница возврата — то, чем виджет заменён.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loginPage } from '../src/views/login.js';
import { telegramReturnPage } from '../src/views/telegram-return.js';

const config = {
  publicBaseUrl: 'https://soloaijourney.online',
  telegram: { botToken: '123456789:секрет', botId: '123456789', botUsername: 'solo_ai_journey_bot' }
};

test('ссылка входа несёт номер бота, наш адрес и путь возврата', () => {
  const html = loginPage({ config });
  const ссылка = html.match(/href="(https:\/\/oauth\.telegram\.org[^"]+)"/)?.[1];
  assert.ok(ссылка, 'на странице нет ссылки входа через Telegram');

  const url = new URL(ссылка.replaceAll('&amp;', '&'));
  assert.equal(url.searchParams.get('bot_id'), '123456789');
  assert.equal(url.searchParams.get('origin'), 'https://soloaijourney.online');
  assert.equal(
    url.searchParams.get('return_to'),
    'https://soloaijourney.online/auth/telegram/return'
  );
  // Разрешение писать нужно боту, чтобы доставлять уведомления тем, у кого
  // нет установленного приложения.
  assert.equal(url.searchParams.get('request_access'), 'write');
});

test('секретная часть токена в разметку не попадает', () => {
  assert.ok(!loginPage({ config }).includes('секрет'));
});

test('без настроенного бота ссылки нет, а есть объяснение', () => {
  const html = loginPage({ config: { ...config, telegram: { botToken: '', botId: '' } } });
  assert.ok(!html.includes('oauth.telegram.org'));
  assert.match(html, /пока не настроен/);
});

test('страница возврата разбирает якорь и отправляет данные на вход', () => {
  const html = telegramReturnPage(config);
  // Данные приходят в якоре: на сервер он не попадает вовсе, разобрать его
  // может только страница.
  assert.match(html, /tgAuthResult/);
  assert.match(html, /\/api\/auth\/telegram/);
  assert.match(html, /location\.replace\('\/'\)/);
});
