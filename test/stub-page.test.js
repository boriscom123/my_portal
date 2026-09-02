// Проверка заглушки. Спека обещает её уже на этапе 0: адрес открыт, а
// смотреть нечего — это выглядит как сломанный сайт, а не как каркас.
// Страница живёт до этапа 2, где её сменит настоящая витрина.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { withServer } from './helpers/http.js';

const config = { publicBaseUrl: 'https://soloaijourney.online', port: 0 };

test('корень отдаёт HTML со знаком проекта', async () => {
  const app = finalize(createApp({ config, pool: null }));
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    assert.match(html, /<html lang="ru">/);
    assert.match(html, /Solo AI Journey/);
  });
});

test('фирменное написание набрано живым градиентом', async () => {
  const app = finalize(createApp({ config, pool: null }));
  await withServer(app, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    // Класс «знак» несёт градиент и его анимацию: без него написание
    // отрисуется прозрачным и пропадёт со страницы.
    assert.match(html, /class="знак"/);
    assert.match(html, /styles\.css/);
  });
});

test('на странице виден номер версии — по нему видно, что выкатилось', async () => {
  const app = finalize(createApp({ config, pool: null }));
  await withServer(app, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /0\.1\.0/);
  });
});
