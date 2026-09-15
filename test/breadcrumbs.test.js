// Хлебные крошки: «Главная › Раздел › Страница» над заголовком.
//
// Заказчик 2026-09-15: вернуться на уровень выше было нечем — стрелки «← Уроки»
// стояли вразнобой, а на странице урока и новости их не было вовсе. Крошки идут
// по устройству сайта, а не по истории браузера: работают и у того, кто открыл
// страницу по ссылке из Telegram.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { breadcrumbsHtml } from '../src/views/breadcrumbs.js';
import { newsPage, newsEditPage } from '../src/views/news.js';
import { seriesPage } from '../src/views/series.js';
import { lessonNewPage } from '../src/views/lesson-new.js';
import { adminPreviewPage } from '../src/views/admin-preview.js';
import { feedPage } from '../src/views/feed.js';

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

const admin = { role: 'admin' };

test('крошки: «Главная» первой, последний пункт — без ссылки, заголовок экранирован', () => {
  const html = breadcrumbsHtml([{ title: 'Новости', href: '/news' }, { title: 'Заголовок <b>' }]);
  assert.match(html, /<nav class="breadcrumbs" aria-label="Навигация по сайту">/);
  assert.match(html, /<a href="\/">Главная<\/a>/);
  assert.match(html, /<a href="\/news">Новости<\/a>/);
  assert.match(html, /<span aria-current="page">Заголовок &lt;b&gt;<\/span>/);
  assert.doesNotMatch(html, /<b>/);
  // Нечего показывать — строки нет вовсе, а не пустая полоса.
  assert.equal(breadcrumbsHtml(null), '');
  assert.equal(breadcrumbsHtml([]), '');
});

test('у страниц свои цепочки, а на главной крошек нет', () => {
  const item = {
    slug: 'novost',
    title: 'Новость',
    body: 'Текст',
    status: 'published',
    publishedAt: new Date('2026-09-15T10:00:00Z'),
    images: [],
    projects: { main: null, related: [] }
  };
  const news = newsPage({ config, user: null, item });
  assert.match(news, /<a href="\/news">Новости<\/a>[\s\S]*<span aria-current="page">Новость<\/span>/);

  const edit = newsEditPage({ config, user: admin, item });
  assert.match(
    edit,
    /<a href="\/news">Новости<\/a>[\s\S]*<a href="\/news\/novost">Новость<\/a>[\s\S]*<span aria-current="page">Правка<\/span>/
  );
  const fresh = newsEditPage({ config, user: admin });
  assert.match(fresh, /<span aria-current="page">Новая новость<\/span>/);

  const series = seriesPage({
    config,
    user: null,
    series: { slug: 'portal', title: 'Портал', description: '', lessons: [] }
  });
  assert.match(series, /<a href="\/lessons">Уроки<\/a>[\s\S]*<span aria-current="page">Серия «Портал»<\/span>/);

  const newLesson = lessonNewPage({ config, user: admin });
  assert.match(newLesson, /<a href="\/lessons">Уроки<\/a>[\s\S]*<span aria-current="page">Новый урок<\/span>/);

  const preview = adminPreviewPage({
    config,
    user: admin,
    lesson: { slug: 'urok', title: 'Урок' },
    videoUrl: '/v',
    subtitlesUrl: '/s'
  });
  assert.match(
    preview,
    /<a href="\/lessons">Уроки<\/a>[\s\S]*<a href="\/admin\/lesson\/urok">Урок<\/a>[\s\S]*<span aria-current="page">Проверка записи<\/span>/
  );

  const home = feedPage({ config, lessons: [], news: [], user: null });
  assert.doesNotMatch(home, /class="breadcrumbs"/);
  const tag = feedPage({ config, lessons: [], news: [], user: null, tag: 'docker' });
  assert.match(tag, /<span aria-current="page">Тег «docker»<\/span>/);
});

test('разрозненных стрелок «← …» на страницах не осталось', async () => {
  const dir = new URL('../src/views/', import.meta.url);
  for (const name of await readdir(dir)) {
    const source = await readFile(new URL(name, dir), 'utf8');
    assert.ok(!source.includes('← '), `в ${name} осталась стрелка «←» — её заменяют крошки`);
  }
});
