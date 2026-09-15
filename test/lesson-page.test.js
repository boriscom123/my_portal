// Страница урока: значок правки, порядок блоков и понятная серия.
//
// Заказчик 2026-09-15: к правке урока автор переходит значком у заголовка;
// отзывы — сразу под оценкой, а не в самом низу; серия — с понятным заголовком
// и местом каждого урока в ней, как на странице «Уроки».
import test from 'node:test';
import assert from 'node:assert/strict';
import { lessonPage } from '../src/views/lesson.js';

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

const card = (slug, title) => ({
  id: slug.length,
  slug,
  title,
  description: 'Описание',
  coverUrl: null,
  publishedAt: new Date('2026-09-10T10:00:00Z')
});

const lesson = {
  ...card('vtoroy', 'Второй урок'),
  tags: [],
  publications: [],
  projects: { main: null, related: [] }
};

const seriesNav = {
  series: { slug: 'portal', title: 'Портал' },
  number: 2,
  total: 3,
  previous: card('pervyy', 'Первый урок'),
  next: card('tretiy', 'Третий урок')
};

test('у заголовка урока автор видит значок правки, зритель — нет', () => {
  const author = lessonPage({ config, lesson, comments: [], user: { role: 'admin', id: 1 } });
  assert.match(author, /<h1>Второй урок <a class="edit" href="\/admin\/lesson\/vtoroy"[^>]*>✎<\/a><\/h1>/);

  const guest = lessonPage({ config, lesson, comments: [], user: null });
  assert.doesNotMatch(guest, /class="edit"/);
});

test('отзывы — сразу под оценкой, до серии и похожих', () => {
  const page = lessonPage({ config, lesson, comments: [], user: null, seriesNav });
  const rating = page.indexOf('class="rating"');
  const comments = page.indexOf('class="comments"');
  const series = page.indexOf('Серия уроков');
  assert.ok(rating > 0 && comments > rating, 'отзывы стоят не под оценкой');
  assert.ok(series > comments, 'серия выше отзывов');
});

test('серия — с понятным заголовком и местом урока на карточках', () => {
  const page = lessonPage({ config, lesson, comments: [], user: null, seriesNav });
  assert.match(page, /<h2>Серия уроков «Портал»<\/h2>/);
  assert.match(page, /Урок 2 из 3/);
  // На карточках соседей — место в серии, как на странице «Уроки».
  assert.match(page, /Третий урок[\s\S]*?Серия «<a href="\/series\/portal">Портал<\/a>» · урок 3 из 3/);
  assert.match(page, /Первый урок[\s\S]*?Серия «<a href="\/series\/portal">Портал<\/a>» · урок 1 из 3/);
});
