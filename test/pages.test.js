// Проверка серверных страниц. Ради них серверный рендер и существует: урок
// должен открываться из инкогнито и разворачиваться превью в мессенджере.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveLesson, setLessonTags } from '../src/services/lessons.js';
import { addComment } from '../src/services/feedback.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://soloaijourney.online',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', channelId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' }
};

async function lesson(pool, fields = {}) {
  return saveLesson(pool, {
    slug: 'docker-1',
    title: 'Docker, часть 1',
    description: 'Контейнеры с нуля',
    status: 'published',
    publishedAt: new Date('2026-08-01T10:00:00Z'),
    ...fields
  });
}

test('лента отдаёт HTML с заголовком урока', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await lesson(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /text\/html/);
      const html = await res.text();
      assert.match(html, /Docker, часть 1/);
      assert.match(html, /1 августа 2026/);
    });
  });
});

test('карточка урока несёт теги превью и канонический адрес', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await lesson(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (await fetch(`${base}/lesson/docker-1`)).text();
      assert.match(html, /<meta property="og:title" content="Docker, часть 1">/);
      assert.match(html, /Контейнеры с нуля/);
      assert.match(html, /canonical" href="https:\/\/soloaijourney\.online\/lesson\/docker-1"/);
    });
  });
});

test('черновик по прямой ссылке даёт 404 гостю и открывается автору', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await lesson(pool, { slug: 'chernovik', status: 'draft', publishedAt: null });
    const { rows } = await pool.query(
      `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
    );
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      assert.equal((await fetch(`${base}/lesson/chernovik`)).status, 404);
      const mine = await fetch(`${base}/lesson/chernovik`, {
        headers: {
          Authorization: `Bearer ${signSession({ userId: rows[0].id, role: 'admin' }, config.jwtSecret)}`
        }
      });
      assert.equal(mine.status, 200);
    });
  });
});

test('страница 404 отдаётся человеку как страница, а не как JSON', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/lesson/net-takogo`, { headers: { Accept: 'text/html' } });
      assert.equal(res.status, 404);
      assert.match(res.headers.get('content-type'), /text\/html/);
      assert.match(await res.text(), /Урок не найден/);
    });
  });
});

test('название урока с разметкой экранируется', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await lesson(pool, { slug: 'xss', title: '<script>alert(1)</script>' });
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (await fetch(`${base}/`)).text();
      assert.ok(!html.includes('<script>alert(1)</script>'));
      assert.match(html, /&lt;script&gt;/);
    });
  });
});

test('лента по тегу показывает только его уроки', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const l = await lesson(pool);
    await setLessonTags(pool, l.id, ['docker']);
    await lesson(pool, { slug: 'drugoj', title: 'Другой урок' });
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (await fetch(`${base}/tag/docker`)).text();
      assert.match(html, /Docker, часть 1/);
      assert.ok(!html.includes('Другой урок'));
    });
  });
});

test('гостю не показывают форму отзыва, а неодобренный отзыв скрыт', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const l = await lesson(pool);
    const { rows } = await pool.query(
      `INSERT INTO users (display_name) VALUES ('Пётр') RETURNING id`
    );
    await addComment(pool, {
      userId: Number(rows[0].id),
      objectType: 'lesson',
      objectId: l.id,
      body: 'Скрытый пока отзыв'
    });
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const guest = await (await fetch(`${base}/lesson/docker-1`)).text();
      assert.ok(!guest.includes('Скрытый пока отзыв'));
      assert.ok(!guest.includes('id="comment-form"'));
      assert.match(guest, /Войдите/);

      const author = await (
        await fetch(`${base}/lesson/docker-1`, {
          headers: {
            Authorization: `Bearer ${signSession({ userId: rows[0].id, role: 'user' }, config.jwtSecret)}`
          }
        })
      ).text();
      assert.match(author, /Скрытый пока отзыв/);
      assert.match(author, /ждёт проверки/);
      assert.match(author, /id="comment-form"/);
    });
  });
});

test('внутренние ссылки кабинета ведут на существующие адреса', async () => {
  // Ссылка на страницу, которой нет, ломается тихо: человек нажимает и
  // получает «не найдено». Так и вышло с подключениями площадок — их страница
  // ещё в плане, а ссылка на неё уже стояла в двух местах.
  const { readdir, readFile } = await import('node:fs/promises');
  const viewsDir = new URL('../src/views/', import.meta.url);
  const routes = await readFile(new URL('../src/routes/pages.js', import.meta.url), 'utf8');

  // Адреса маршрутов: и точные, и с частями вида :slug.
  const patterns = [...routes.matchAll(/router\.get\('([^']+)'/g)].map(([, path]) =>
    new RegExp(`^${path.replace(/:[^/]+/g, '[^/]+')}$`)
  );

  const links = new Set();
  for (const name of await readdir(viewsDir)) {
    const source = await readFile(new URL(name, viewsDir), 'utf8');
    for (const [, href] of source.matchAll(/href="(\/admin[^"?#]*)"/g)) {
      // Ссылки со вставками вида ${...} проверяем по образцу маршрута.
      links.add(href.replace(/\$\{[^}]+\}/g, 'x'));
    }
  }

  for (const link of links) {
    assert.ok(
      patterns.some((pattern) => pattern.test(link)),
      `ссылка ${link} ведёт на адрес, которого нет`
    );
  }
});

test('обложка видна на самой странице урока, а не только в превью ссылки', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, {
      slug: 'urok',
      title: 'Урок',
      status: 'published',
      publishedAt: new Date(),
      coverUrl: '/media/asset/7'
    });
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (
        await fetch(`${base}/lesson/urok`, { headers: { Accept: 'text/html' } })
      ).text();
      // Обложка уходила только в превью ссылки, и страница оставалась без
      // единой картинки — заказчик назвал её недоделанной, и был прав.
      assert.match(html, /<img class="lesson-cover" src="\/media\/asset\/7"/);
      assert.match(html, /og:image" content="https:\/\/[^"]*\/media\/asset\/7"/);
    });
    assert.ok(lesson.id);
  });
});
