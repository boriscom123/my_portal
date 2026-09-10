// Главная: что на неё попадает и как раскладывается.
//
// Главная — витрина, а не рабочий стол. Ошибка здесь видна каждому, кто зайдёт
// на портал, и заметил её первым заказчик: черновик стоял среди вышедших.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveLesson } from '../src/services/lessons.js';
import { saveNews, publishNews } from '../src/services/news.js';
import { feedPage } from '../src/views/feed.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

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

/** Урок в виде, в котором его ждёт лента. */
function lesson(slug, title, day) {
  return {
    id: slug.length,
    slug,
    title,
    description: 'Описание',
    coverUrl: null,
    status: 'published',
    publishedAt: new Date(`2026-09-${day}T10:00:00Z`),
    tags: [],
    publications: []
  };
}

function newsItem(slug, title, day) {
  return {
    slug,
    title,
    body: 'Текст новости',
    status: 'published',
    publishedAt: new Date(`2026-09-${day}T10:00:00Z`),
    images: []
  };
}

test('черновика на главной нет даже у автора', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveLesson(pool, {
      slug: 'vyshel',
      title: 'Вышедший урок',
      status: 'published',
      publishedAt: new Date('2026-09-01T10:00:00Z')
    });
    await saveLesson(pool, { slug: 'chernovik', title: 'Недоделанный урок' });

    const { rows } = await pool.query(
      `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
    );
    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));

    await withServer(app, async (base) => {
      for (const [who, headers] of [
        ['гость', {}],
        [
          'автор',
          {
            Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'admin' }, config.jwtSecret)}`
          }
        ]
      ]) {
        const page = await (await fetch(base, { headers })).text();
        assert.match(page, /Вышедший урок/, `${who} не видит вышедшего урока`);
        // Автор смотрит на витрину, чтобы увидеть её глазами зрителя.
        // Недоделанное лежит в разделе «Уроки», там оно к месту.
        assert.doesNotMatch(page, /Недоделанный урок/, `${who} видит черновик на главной`);
      }
    });
  });
});

test('урок идёт во всю ширину, а не карточкой в ряду', () => {
  const page = feedPage({ config, lessons: [lesson('urok', 'Урок', '02')], news: [] });
  assert.match(page, /class="lesson-card wide"/);
  // Прежняя общая сетка ставила урок в ряд с новостями по трети ширины.
  assert.doesNotMatch(page, /class="lessons-grid"/);
});

test('соседние новости встают в один ряд, а урок его разрывает', () => {
  const page = feedPage({
    config,
    lessons: [lesson('urok', 'Запись про портал', '02')],
    news: [newsItem('pervaya', 'Первая', '03'), newsItem('vtoraya', 'Вторая', '01')]
  });

  // Две новости 3-го — в одном ряду; урок 2-го стоит между ними по дате, и
  // ряд обязан разорваться, иначе лента врёт про порядок.
  const rows = [...page.matchAll(/<div class="news-grid">/g)];
  assert.equal(rows.length, 2, 'новости по разные стороны урока — это два ряда');
  assert.ok(
    page.indexOf('Первая') < page.indexOf('Запись про портал'),
    'порядок по дате обязан сохраниться'
  );
  assert.ok(page.indexOf('Запись про портал') < page.indexOf('Вторая'));
});

test('идущие подряд новости кладутся в один ряд', () => {
  const page = feedPage({
    config,
    lessons: [],
    news: [newsItem('pervaya', 'Первая', '03'), newsItem('vtoraya', 'Вторая', '02')]
  });
  assert.equal([...page.matchAll(/<div class="news-grid">/g)].length, 1);
});

test('черновик новости в ленту не попадает', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveLesson(pool, {
      slug: 'vyshel',
      title: 'Вышедший урок',
      status: 'published',
      publishedAt: new Date('2026-09-01T10:00:00Z')
    });
    const draft = await saveNews(pool, { title: 'Черновик новости' });
    const shown = await saveNews(pool, { title: 'Вышедшая новость' });
    await publishNews(pool, shown.slug);

    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));
    await withServer(app, async (base) => {
      const page = await (await fetch(base)).text();
      assert.match(page, /Вышедшая новость/);
      assert.doesNotMatch(page, /Черновик новости/);
      assert.ok(draft.slug, 'черновик заведён — иначе проверка ничего не значит');
    });
  });
});
