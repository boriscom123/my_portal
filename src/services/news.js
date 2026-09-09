// Новости портала.
//
// Задача — то же, что у уроков, но короче: заголовок, текст, картинки. Зачем
// отдельным файлом от уроков: новость живёт своей жизнью — её пишут между
// уроками, у неё нет ни конвейера, ни площадок, — и держать её в одном файле с
// уроком значит однажды случайно применить к ней правило урока.
// Вызывается из src/routes/pages.js, src/routes/admin.js и ленты на главной.
import { slugify } from '../lib/slug.js';

const DEFAULT_LIMIT = 20;

/** Приводит строку базы к виду, в котором её ждут шаблоны. */
function toNews(row) {
  return {
    id: Number(row.id),
    slug: row.slug,
    title: row.title,
    body: row.body,
    publishedAt: row.published_at,
    images: []
  };
}

/** Картинки, разложенные по новостям. Одним запросом на всю страницу. */
async function attachImages(pool, items) {
  if (!items.length) return items;
  const { rows } = await pool.query(
    `SELECT id, news_id, position FROM assets
      WHERE news_id = ANY($1::bigint[]) AND kind = 'image'
      ORDER BY position, id`,
    [items.map((item) => item.id)]
  );
  for (const item of items) {
    item.images = rows
      .filter((row) => Number(row.news_id) === item.id)
      .map((row) => ({ id: Number(row.id), url: `/media/asset/${row.id}` }));
  }
  return items;
}

/** Лента новостей, свежие сверху. */
export async function listNews(pool, { limit = DEFAULT_LIMIT } = {}) {
  const { rows } = await pool.query(
    'SELECT id, slug, title, body, published_at FROM news ORDER BY published_at DESC LIMIT $1',
    [limit]
  );
  return attachImages(pool, rows.map(toNews));
}

/** Одна новость по адресу. null, если её нет. */
export async function getNewsBySlug(pool, slug) {
  const { rows } = await pool.query(
    'SELECT id, slug, title, body, published_at FROM news WHERE slug = $1',
    [slug]
  );
  if (!rows.length) return null;
  const [item] = await attachImages(pool, [toNews(rows[0])]);
  return item;
}

/**
 * Заводит или правит новость.
 * Адрес считается из заголовка один раз, при заведении: менять его потом
 * значит ломать ссылки, которыми уже поделились.
 */
export async function saveNews(pool, { slug = null, title, body = '' }) {
  const name = String(title ?? '').trim();
  if (!name) throw new Error('заголовок новости пустой');

  if (slug) {
    const { rows } = await pool.query(
      `UPDATE news SET title = $2, body = $3 WHERE slug = $1
       RETURNING id, slug, title, body, published_at`,
      [slug, name, String(body ?? '')]
    );
    return rows.length ? toNews(rows[0]) : null;
  }

  // Одинаковые заголовки бывают — «Итоги недели» повторится через неделю.
  // Поэтому к адресу добавляется дата: она же помогает человеку понять, о
  // каком времени новость, ещё до перехода.
  const stamp = new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query(
    `INSERT INTO news (slug, title, body) VALUES ($1, $2, $3)
     RETURNING id, slug, title, body, published_at`,
    [`${slugify(name)}-${stamp}`, name, String(body ?? '')]
  );
  return toNews(rows[0]);
}

/** Убирает новость вместе с её картинками: их удалит уборщик буфера. */
export async function deleteNews(pool, slug) {
  const { rowCount } = await pool.query('DELETE FROM news WHERE slug = $1', [slug]);
  return rowCount > 0;
}
