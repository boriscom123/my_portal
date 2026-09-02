// Проверка каркаса приложения: живой ответ /healthz и единая форма ошибки.
// Вызывается из `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { withServer } from './helpers/http.js';
import { version } from '../src/version.js';

const config = { publicBaseUrl: 'https://soloaijourney.online', port: 0 };

test('/healthz отвечает версией', async () => {
  const app = finalize(createApp({ config, pool: null }));
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok', version });
  });
});

test('неизвестный маршрут — 404 в общем формате', async () => {
  const app = finalize(createApp({ config, pool: null }));
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/no-such-route`, { headers: { Accept: 'application/json' } });
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'Не найдено' });
  });
});

// Адреса маршрутов только латиницей: Express сверяет сырой путь запроса, а
// браузер шлёт кириллицу percent-кодированной — литерал '/урок' не совпадёт
// никогда. Проверено экспериментом, см. коммит.
test('ошибка в асинхронном обработчике не роняет процесс и даёт 500', async () => {
  const app = createApp({ config, pool: null });
  app.get('/boom', async () => {
    throw new Error('внутренняя поломка');
  });
  finalize(app);
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/boom`, { headers: { Accept: 'application/json' } });
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, 'Внутренняя ошибка');
    // Текст исключения наружу не отдаём: он часто содержит запрос и параметры.
    assert.ok(!JSON.stringify(body).includes('внутренняя поломка'));
  });
});
