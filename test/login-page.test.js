// Проверка страницы входа: она отдаётся HTML, несёт оба способа входа и
// объясняет главное — оба ведут в один аккаунт. Виджет Telegram появляется
// только когда бот настроен, иначе на странице висела бы мёртвая кнопка.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { withServer } from './helpers/http.js';

const базовый = {
  publicBaseUrl: 'https://soloaijourney.online',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  google: { clientId: 'cid', clientSecret: 'sec' }
};

async function страница(config) {
  const app = finalize(createApp({ config, pool: null }));
  return withServer(app, async (base) => {
    const res = await fetch(`${base}/login`);
    return { status: res.status, тип: res.headers.get('content-type'), html: await res.text() };
  });
}

test('страница входа отдаётся как HTML', async () => {
  const r = await страница({ ...базовый, telegram: { botToken: '', botUsername: '' } });
  assert.equal(r.status, 200);
  assert.match(r.тип, /text\/html/);
});

test('видны оба способа и объяснение про один аккаунт', async () => {
  const r = await страница({
    ...базовый,
    telegram: { botToken: 'т', botUsername: 'solo_ai_journey_bot' }
  });
  assert.match(r.html, /Войти через Google/);
  assert.match(r.html, /один и тот же аккаунт/);
  assert.match(r.html, /telegram-widget\.js/);
  assert.match(r.html, /data-telegram-login="solo_ai_journey_bot"/);
});

test('без настроенного бота виджет не показывается', async () => {
  const r = await страница({ ...базовый, telegram: { botToken: '', botUsername: '' } });
  assert.ok(!r.html.includes('telegram-widget.js'));
  assert.match(r.html, /пока не настроен/);
});

test('имя бота экранируется', async () => {
  const r = await страница({
    ...базовый,
    telegram: { botToken: 'т', botUsername: '"><script>alert(1)</script>' }
  });
  assert.ok(!r.html.includes('<script>alert(1)</script>'));
});
