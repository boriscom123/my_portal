// Новости: заведение, правка, картинки.
import test from 'node:test';
import assert from 'node:assert/strict';
import { listNews, getNewsBySlug, saveNews, deleteNews } from '../src/services/news.js';
import { registerAsset } from '../src/services/media.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = { media: { dir: '/tmp', ttlHours: 168 } };

test('новость заводится с адресом из заголовка и даты', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const news = await saveNews(pool, { title: 'Итоги недели', body: 'Что сделано' });
    assert.match(news.slug, /^itogi-nedeli-\d{4}-\d{2}-\d{2}$/);
    assert.equal(news.title, 'Итоги недели');
  });
});

test('одинаковые заголовки не сталкиваются адресами в разные дни', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    // «Итоги недели» повторятся через неделю — адрес обязан их различить.
    const first = await saveNews(pool, { title: 'Итоги недели' });
    await pool.query(`UPDATE news SET slug = $1 WHERE id = $2`, [
      'itogi-nedeli-2026-09-01',
      first.id
    ]);
    const second = await saveNews(pool, { title: 'Итоги недели' });
    assert.notEqual(second.slug, 'itogi-nedeli-2026-09-01');
  });
});

test('правка не меняет адрес: им уже могли поделиться', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const news = await saveNews(pool, { title: 'Было' });
    const fixed = await saveNews(pool, { slug: news.slug, title: 'Стало', body: 'Текст' });
    assert.equal(fixed.slug, news.slug);
    assert.equal(fixed.title, 'Стало');
  });
});

test('пустой заголовок не принимается', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await assert.rejects(saveNews(pool, { title: '   ' }), /заголовок/i);
  });
});

test('картинки отдаются в заданном порядке', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const news = await saveNews(pool, { title: 'Анонс' });
    await registerAsset(pool, config, {
      newsId: news.id,
      kind: 'image',
      relativePath: 'news-1/vtoraya.jpg',
      bytes: 10,
      position: 2
    });
    await registerAsset(pool, config, {
      newsId: news.id,
      kind: 'image',
      relativePath: 'news-1/pervaya.jpg',
      bytes: 10,
      position: 1
    });

    const found = await getNewsBySlug(pool, news.slug);
    assert.equal(found.images.length, 2);
    assert.match(found.images[0].url, /^\/media\/asset\/\d+$/);
    // Порядок задаёт автор, а не случайность загрузки.
    const [first, second] = found.images;
    const { rows } = await pool.query('SELECT id, path FROM assets ORDER BY position');
    assert.equal(first.id, Number(rows[0].id));
    assert.equal(second.id, Number(rows[1].id));
  });
});

test('картинки новости не живут по сроку', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const news = await saveNews(pool, { title: 'Анонс' });
    const image = await registerAsset(pool, config, {
      newsId: news.id,
      kind: 'image',
      relativePath: 'news-1/kartinka.jpg',
      bytes: 10
    });
    // Анонс с картинкой, которая исчезнет через два месяца, — не анонс.
    assert.equal(image.expiresAt, null);
  });
});

test('удаление новости уносит и её картинки из учёта', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const news = await saveNews(pool, { title: 'Анонс' });
    await registerAsset(pool, config, {
      newsId: news.id,
      kind: 'image',
      relativePath: 'news-1/kartinka.jpg',
      bytes: 10
    });

    assert.equal(await deleteNews(pool, news.slug), true);
    const { rows } = await pool.query('SELECT count(*)::int AS count FROM assets');
    assert.equal(rows[0].count, 0, 'файлы без хозяина в учёте не остаются');
    assert.equal((await listNews(pool, {})).length, 0);
  });
});

test('файл обязан принадлежать ровно одному хозяину', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    // Без хозяина файл осиротеет в буфере навсегда, с двумя — удалится вместе
    // с чужой карточкой.
    await assert.rejects(
      pool.query(`INSERT INTO assets (kind, path, bytes) VALUES ('image', '/a', 1)`),
      /assets_one_owner/
    );
  });
});

// Перенесено из тестов уроков вместе с самим сервисом: новости живут своей
// жизнью, и правило урока к ним применять нельзя.
test('новости отдаются свежими сверху', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await pool.query(
      `INSERT INTO news (slug, title, body, published_at) VALUES
       ('staraya', 'Старая', 'текст', '2026-07-01'),
       ('svezhaya', 'Свежая', 'текст', '2026-08-20')`
    );
    const news = await listNews(pool, {});
    assert.deepEqual(
      news.map((n) => n.slug),
      ['svezhaya', 'staraya']
    );
  });
});

test('ссылки в тексте новости становятся кликабельными, а разметка — нет', async () => {
  const { linkify } = await import('../src/views/news.js');
  // Сначала экранируем всё, и только потом делаем ссылками то, что осталось
  // адресом. Обратный порядок пустил бы чужую разметку на страницу.
  const html = linkify('Смотрите https://soloaijourney.online/lesson/urok <script>alert(1)</script>');
  assert.match(html, /<a href="https:\/\/soloaijourney\.online\/lesson\/urok"/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('перенос строки в новости остаётся переносом', async () => {
  const { linkify } = await import('../src/views/news.js');
  assert.match(linkify('первая\nвторая'), /первая<br>вторая/);
});
