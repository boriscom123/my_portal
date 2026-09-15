// Страница одной новости: как автор переходит к правке.
//
// Заказчик 2026-09-15: кнопка «Править новость» под текстом не нужна — вместо
// неё значок правки у заголовка, как в разделах «Новости» и «Уроки». Зритель
// ни значка, ни кнопки не видит.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newsPage } from '../src/views/news.js';

const config = {
  publicBaseUrl: 'https://portal.example',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', botId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: '' },
  redis: { url: 'redis://redis:6379', prefix: 'portal:' },
  yandex: { apiKey: '', folderId: '' },
  yandexOauth: { clientId: '', clientSecret: '' },
  tokenEncryptionKey: 'a'.repeat(64),
  media: { dir: '/tmp', ttlHours: 168 },
  youtube: { clientId: '', clientSecret: '', redirectUri: '/back', mode: 'semi' }
};

const item = {
  slug: 'novost',
  title: 'Новость',
  body: 'Текст новости',
  status: 'published',
  publishedAt: new Date('2026-09-15T10:00:00Z'),
  images: [],
  projects: { main: null, related: [] }
};

test('на странице новости автор видит значок правки у заголовка, а не кнопку', () => {
  const author = newsPage({ config, user: { role: 'admin' }, item });
  assert.match(author, /<h1>Новость <a class="edit" href="\/news\/novost\/edit"[^>]*>✎<\/a><\/h1>/);
  assert.doesNotMatch(author, /Править новость<\/a>/, 'кнопка «Править новость» осталась');

  const guest = newsPage({ config, user: null, item });
  assert.doesNotMatch(guest, /class="edit"/);
  assert.doesNotMatch(guest, /\/news\/novost\/edit/);
});
