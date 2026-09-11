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
import { readFile } from 'node:fs/promises';
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

test('обложка урока в ленте не обрезается по краям', async () => {
  // Обложка у урока — не картинка, а плакат: на нём написаны название и краткое
  // содержание. Обрезка съедает край вместе с буквами, а растяжение по высоте
  // соседней колонки и есть та обрезка. Заказчик увидел это первым.
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const at = styles.indexOf('.lesson-card.wide img.cover {');
  assert.ok(at >= 0, 'правило для обложки широкой карточки пропало');
  const rule = styles.slice(at);
  assert.match(rule.slice(0, 500), /object-fit: contain/);
  assert.match(rule.slice(0, 500), /aspect-ratio: 16 \/ 9/);
});

test('бейдж «Урок» или «Новость» лежит на картинке, а старой серой пометки нет', () => {
  const withCover = { ...lesson('urok', 'Урок с обложкой', '04'), coverUrl: '/media/asset/1' };
  const page = feedPage({
    config,
    lessons: [withCover, lesson('bez', 'Урок без обложки', '01')],
    news: [
      { ...newsItem('s-kartinkoy', 'Новость с картинкой', '03'), images: [{ id: 2, url: '/media/asset/2' }] },
      newsItem('bez-kartinki', 'Новость без картинки', '02')
    ]
  });
  // Видно до заголовка: бейдж внутри ссылки-картинки, поверх неё.
  assert.match(
    page,
    /<a class="card-media" href="\/lesson\/urok"><img[^>]*class="cover">\s*<span class="kind-badge kind-lesson">Урок<\/span><\/a>/
  );
  // У урока без обложки бейдж ложится на фирменную заглушку.
  assert.match(
    page,
    /<a class="card-media" href="\/lesson\/bez"><div class="cover button-brand"><\/div>\s*<span class="kind-badge kind-lesson">Урок<\/span><\/a>/
  );
  assert.match(
    page,
    /<a class="card-media" href="\/news\/s-kartinkoy"><img[^>]*>\s*<span class="kind-badge kind-news">Новость<\/span><\/a>/
  );
  // Новость без картинки — бейдж первой строкой карточки, в том же виде.
  assert.match(page, /<div class="card-body">\s*<span class="kind-badge kind-news">Новость<\/span>/);
  // Серая пометка у даты терялась — заказчик её не замечал.
  assert.doesNotMatch(page, /class="badge">новость</);
});

test('бейджи в фирменных переливах: урок — знака, новость — пламени', async () => {
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const block = (selector) => {
    const at = styles.indexOf(`${selector} {`);
    assert.ok(at >= 0, `нет правила ${selector}`);
    return styles.slice(at, styles.indexOf('}', at));
  };
  assert.match(block('.kind-badge'), /animation: shimmer/);
  assert.match(block('.kind-lesson'), /var\(--brand-1\)[\s\S]*var\(--brand-3\)/);
  // Разные цвета — чтобы отличать по цвету, не читая слово.
  assert.match(block('.kind-news'), /var\(--flame\)/);
  assert.match(block('.card-media .kind-badge'), /position: absolute/);
  assert.match(block('.card-media .kind-badge'), /top: \d+px/);
  assert.match(block('.card-media .kind-badge'), /left: \d+px/);
  // Кто отключил анимацию в системе, видит неподвижный градиент.
  const calm = styles.slice(styles.indexOf('@media (prefers-reduced-motion: reduce) {'));
  assert.match(calm.slice(0, 400), /\.kind-badge/);
});

test('фирменная заглушка урока без обложки не перекрыта фоном картинки', async () => {
  // Правило обложки широкой карточки задавало фон всему .cover и глушило
  // градиент заглушки: вместо него было пустое светлое место.
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.ok(!styles.includes('.lesson-card.wide .cover {'), 'фон обложки снова задан и заглушке');
});

