// Зритель: кнопки проектов ведут на фильтр, фильтр отбирает и основной, и
// связанный проект, неизвестный адрес показывает всё с подсказкой.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { saveLesson } from '../src/services/lessons.js';
import { saveNews, publishNews } from '../src/services/news.js';
import { saveSeries, setLessonSeries } from '../src/services/series.js';
import { getProjectBySlug, saveProject, setProjects } from '../src/services/projects.js';
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

const lesson = (pool, slug, title, day) =>
  saveLesson(pool, {
    slug,
    title,
    status: 'published',
    publishedAt: new Date(`2026-09-0${day}T10:00:00Z`)
  });

async function seed(pool) {
  const solo = await getProjectBySlug(pool, 'solo-ai-journey');
  const idle = await saveProject(pool, { title: 'IDLE игра' });
  const main = await lesson(pool, 'igra-urok', 'Урок про игру', 1);
  const related = await lesson(pool, 'portal-urok', 'Урок портала про игру', 2);
  await lesson(pool, 'chuzhoy', 'Чужой урок', 3);
  await setProjects(pool, 'lesson', main.id, { mainId: idle.id });
  await setProjects(pool, 'lesson', related.id, { mainId: solo.id, relatedIds: [idle.id] });

  const series = await saveSeries(pool, { title: 'Игра с нуля' });
  await setProjects(pool, 'series', series.id, { mainId: idle.id });
  const portal = await saveSeries(pool, { title: 'Портал с нуля' });
  await setProjects(pool, 'series', portal.id, { mainId: solo.id });
  await setLessonSeries(pool, main.id, series.id);

  const news = await saveNews(pool, { title: 'Игра вышла' });
  await setProjects(pool, 'news', news.id, { mainId: idle.id });
  await publishNews(pool, news.slug);
  const other = await saveNews(pool, { title: 'Про портал' });
  await setProjects(pool, 'news', other.id, { mainId: solo.id });
  await publishNews(pool, other.slug);
  return { news };
}

test('фильтр «Уроков» отбирает основной и связанный проект', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));
    await withServer(app, async (base) => {
      const page = await (await fetch(`${base}/lessons?project=idle-igra`)).text();
      assert.match(page, /Уроки проекта «IDLE игра»/);
      assert.match(page, /href="\/lessons">все уроки/);
      assert.match(page, /Урок про игру/);
      assert.match(page, /Урок портала про игру/);
      assert.doesNotMatch(page, /Чужой урок/);
      // Блок серий тоже по проекту.
      assert.match(page, /Игра с нуля/);
      assert.doesNotMatch(page, /Портал с нуля/);

      const unknown = await (await fetch(`${base}/lessons?project=net-takogo`)).text();
      assert.match(unknown, /Такого проекта нет — показаны все уроки/);
      assert.match(unknown, /Чужой урок/);
    });
  });
});

test('фильтр «Новостей» и кнопки проектов', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { news } = await seed(pool);
    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));
    await withServer(app, async (base) => {
      const filtered = await (await fetch(`${base}/news?project=idle-igra`)).text();
      assert.match(filtered, /Новости проекта «IDLE игра»/);
      assert.match(filtered, /Игра вышла/);
      assert.doesNotMatch(filtered, /Про портал/);

      // Кнопка с урока ведёт в «Уроки», с новости — в «Новости».
      const lessons = await (await fetch(`${base}/lessons`)).text();
      assert.match(
        lessons,
        /<a class="project-link main" href="\/lessons\?project=idle-igra">IDLE игра<\/a>/
      );
      assert.match(
        lessons,
        /<a class="project-link" href="\/lessons\?project=idle-igra">IDLE игра<\/a>/
      );

      const home = await (await fetch(`${base}/`)).text();
      assert.match(home, /href="\/lessons\?project=idle-igra"/);
      assert.match(home, /href="\/news\?project=idle-igra"/);

      const lessonPage = await (await fetch(`${base}/lesson/igra-urok`)).text();
      assert.match(lessonPage, /href="\/lessons\?project=idle-igra"/);

      const newsPage = await (await fetch(`${base}/news/${news.slug}`)).text();
      assert.match(newsPage, /href="\/news\?project=idle-igra"/);
    });
  });
});
