// Проверка манифеста. Он собирается на сервере, а не лежит файлом, ровно по
// одной причине: адрес портала живёт в окружении, а манифест обязан его знать.
// Файл-константа заставил бы править репозиторий при смене адреса.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { withServer } from './helpers/http.js';

const config = {
  publicBaseUrl: 'https://soloaijourney.online',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', channelId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: 'mailto:a@b' }
};

async function fetchPage(path) {
  const app = finalize(createApp({ config, pool: null }));
  return withServer(app, async (base) => {
    const res = await fetch(`${base}${path}`);
    return { res, body: await res.text() };
  });
}

test('манифест собран из адреса портала', async () => {
  const { res, body } = await fetchPage('/manifest.webmanifest');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /manifest\+json/);
  const manifest = JSON.parse(body);
  assert.equal(manifest.start_url, 'https://soloaijourney.online/');
  // standalone — приложение открывается без адресной строки. Без этого iOS
  // не считает страницу приложением и не даёт Web Push.
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.lang, 'ru');
  // Имя под иконкой на телефоне: длинное обрезается многоточием.
  assert.equal(manifest.short_name, 'Solo');
  // Полное имя тоже короткое: разные версии iOS подставляют под иконку то
  // одно, то другое, и длинное вылезало на домашний экран целиком.
  assert.equal(manifest.name, 'Solo AI Journey');
  assert.ok(manifest.icons.some((i) => i.sizes === '512x512'));
  // maskable нужен Android: без него иконку обрежут в круг по-своему.
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
});

test('манифест перечитывается, а не живёт в кеше сутками', async () => {
  const { res } = await fetchPage('/manifest.webmanifest');
  assert.match(res.headers.get('cache-control'), /no-cache|max-age=0/);
});

test('service worker отдаётся с корня, иначе не увидит весь сайт', async () => {
  const { res, body } = await fetchPage('/sw.js');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  assert.match(body, /addEventListener\('push'/);
});

test('service worker не кладётся в долгий кеш', async () => {
  const { res } = await fetchPage('/sw.js');
  // Закешированный на час worker означает, что старая версия приложения
  // живёт у человека ещё час после выката — включая старую логику пушей.
  assert.match(res.headers.get('cache-control'), /no-cache|max-age=0/);
});

test('офлайн-страница есть и объясняет, что происходит', async () => {
  const { res, body } = await fetchPage('/offline');
  assert.equal(res.status, 200);
  assert.match(body, /нет сети|без сети/i);
});

test('worker меняется вместе с клиентскими файлами', async () => {
  // Браузер считает worker новым только по изменению его байтов. Пока в нём не
  // было отпечатков клиента, правки app.js и styles.css не вступали в силу:
  // установленное приложение неделями крутило старый код.
  const { body } = await fetchPage('/sw.js');
  assert.match(body, /версия клиента:.*app\.js\?v=[0-9a-f]{8}/);
  assert.match(body, /styles\.css\?v=[0-9a-f]{8}/);
});
