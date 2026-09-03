// Проверка страницы входа: она отдаётся HTML, несёт оба способа входа и
// объясняет главное — оба ведут в один аккаунт. Виджет Telegram появляется
// только когда бот настроен, иначе на странице висела бы мёртвая кнопка.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { withServer } from './helpers/http.js';

const base = {
  publicBaseUrl: 'https://soloaijourney.online',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  google: { clientId: 'cid', clientSecret: 'sec' }
};

async function openPage(config) {
  const app = finalize(createApp({ config, pool: null }));
  return withServer(app, async (base) => {
    const res = await fetch(`${base}/login`);
    return { status: res.status, type: res.headers.get('content-type'), html: await res.text() };
  });
}

test('страница входа отдаётся как HTML', async () => {
  const r = await openPage({ ...base, telegram: { botToken: '', botUsername: '' } });
  assert.equal(r.status, 200);
  assert.match(r.type, /text\/html/);
});

test('видны оба способа и объяснение про один аккаунт', async () => {
  const r = await openPage({
    ...base,
    telegram: { botToken: '123:секрет', botId: '123', botUsername: 'solo_ai_journey_bot' }
  });
  assert.match(r.html, /Войти через Google/);
  assert.match(r.html, /Войти через Telegram/);
  assert.match(r.html, /один и тот же аккаунт/);
  assert.match(r.html, /oauth\.telegram\.org/);
});

test('без настроенного бота ссылки нет', async () => {
  const r = await openPage({ ...base, telegram: { botToken: '', botId: '', botUsername: '' } });
  assert.ok(!r.html.includes('oauth.telegram.org'));
  assert.match(r.html, /пока не настроен/);
});

test('чужие символы в номере бота не ломают разметку', async () => {
  const r = await openPage({
    ...base,
    telegram: { botToken: 'т', botId: '"><script>alert(1)</script>', botUsername: '' }
  });
  assert.ok(!r.html.includes('<script>alert(1)</script>'));
});
