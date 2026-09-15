// Страница урока: значок правки, порядок блоков и понятная серия.
//
// Заказчик 2026-09-15: к правке урока автор переходит значком у заголовка;
// отзывы — сразу под оценкой, а не в самом низу; серия — с понятным заголовком
// и местом каждого урока в ней, как на странице «Уроки».
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

test('под заголовком — серия и место урока в ней', () => {
  // Заказчик 2026-09-15: где урок в курсе, видно сразу, а не только в блоке
  // серии внизу страницы. Той же строкой, что на карточке в «Уроках».
  const page = lessonPage({ config, lesson, comments: [], user: null, seriesNav });
  assert.match(
    page,
    /<\/h1>\s*<p class="meta series-line">Серия «<a href="\/series\/portal">Портал<\/a>» · урок 2 из 3<\/p>/
  );

  // Урок вне серии — строки нет.
  const alone = lessonPage({ config, lesson, comments: [], user: null });
  assert.doesNotMatch(alone, /series-line/);
});

test('девять значков оценки — всегда в одну строку, на узком экране мельче', async () => {
  // Заказчик 2026-09-15: на телефоне шкала переносилась на вторую строку. Девять
  // кнопок по 44 точки с зазорами — это 444 точки, шире экрана телефона. Шкала
  // не переносится, а кнопки делят ширину поровну и уменьшаются вместе со значком.
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const block = (selector) => {
    const at = styles.indexOf(`${selector} {`);
    assert.ok(at >= 0, `нет правила ${selector}`);
    return styles.slice(at, styles.indexOf('}', at));
  };
  assert.match(block('.rating-scale'), /flex-wrap: nowrap/);
  assert.doesNotMatch(block('.rating-scale'), /flex-wrap: wrap/);
  // Кнопка может сжиматься: без min-width: 0 гибкая раскладка её не уменьшит.
  assert.match(block('.rating-step'), /flex: 1 1 0/);
  assert.match(block('.rating-step'), /min-width: 0/);
  // На широком экране — прежний размер, не больше: растягиваться во всю строку незачем.
  assert.match(block('.rating-step'), /max-width: var\(--tap-target\)/);
  // Значок уменьшается вместе с кнопкой.
  assert.match(block('.rating-step'), /font-size: clamp\(/);
});

test('итоговая оценка — в процентах от низа шкалы', () => {
  // Заказчик 2026-09-15: «7,5 из 9» читается хуже процентов. Шкала 1–9 идёт в
  // 0–100%: низ — 0%, середина — 50%, верх — 100%.
  const summary = (average, total = 3) => {
    const page = lessonPage({ config, lesson, comments: [], user: null, rating: { total, average } });
    return page.match(/<p class="rating-summary">([\s\S]*?)<\/p>/)?.[1].replace(/\s+/g, ' ').trim();
  };
  assert.equal(summary(7), '<b>75%</b> · 3 оценки');
  assert.equal(summary(1, 1), '<b>0%</b> · 1 оценка');
  assert.equal(summary(5, 5), '<b>50%</b> · 5 оценок');
  assert.equal(summary(9, 2), '<b>100%</b> · 2 оценки');
  // Дробное среднее — до целого процента: 7,2 → 77,5% → 78%.
  assert.equal(summary(7.2), '<b>78%</b> · 3 оценки');

  // «из 9» остаётся только в подписях кнопок шкалы для чтеца экрана — в итоге его нет.
  assert.doesNotMatch(summary(7), /из 9/);
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
