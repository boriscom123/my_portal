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

async function получить(путь) {
  const app = finalize(createApp({ config, pool: null }));
  return withServer(app, async (base) => {
    const res = await fetch(`${base}${путь}`);
    return { res, тело: await res.text() };
  });
}

test('манифест собран из адреса портала', async () => {
  const { res, тело } = await получить('/manifest.webmanifest');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /manifest\+json/);
  const manifest = JSON.parse(тело);
  assert.equal(manifest.start_url, 'https://soloaijourney.online/');
  // standalone — приложение открывается без адресной строки. Без этого iOS
  // не считает страницу приложением и не даёт Web Push.
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.lang, 'ru');
  // Имя под иконкой на телефоне: длинное обрезается многоточием.
  assert.equal(manifest.short_name, 'Solo');
  assert.ok(manifest.icons.some((i) => i.sizes === '512x512'));
  // maskable нужен Android: без него иконку обрежут в круг по-своему.
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
});

test('service worker отдаётся с корня, иначе не увидит весь сайт', async () => {
  const { res, тело } = await получить('/sw.js');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  assert.match(тело, /addEventListener\('push'/);
});

test('service worker не кладётся в долгий кеш', async () => {
  const { res } = await получить('/sw.js');
  // Закешированный на час worker означает, что старая версия приложения
  // живёт у человека ещё час после выката — включая старую логику пушей.
  assert.match(res.headers.get('cache-control'), /no-cache|max-age=0/);
});

test('офлайн-страница есть и объясняет, что происходит', async () => {
  const { res, тело } = await получить('/offline');
  assert.equal(res.status, 200);
  assert.match(тело, /нет сети|без сети/i);
});
