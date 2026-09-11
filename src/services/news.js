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
    status: row.status,
    publishedAt: row.published_at,
    // Черновику дата выхода не положена, а показать в кабинете что-то надо:
    // показываем день, когда его завели.
    createdAt: row.created_at,
    // Служебное: идёт ли рисование картинки, по какому запросу рисуется и
    // почему не вышло — см. src/services/cover-drawing.js.
    drawing: row.generated?.drawing ?? null,
    imagePrompt: row.generated?.imagePrompt ?? null,
    sideError: row.generated?.sideError ?? null,
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

const FIELDS = 'id, slug, title, body, status, published_at, created_at, generated';

/**
 * Лента новостей, свежие сверху.
 * includeDrafts — только для кабинета: черновик читателю не показывается, и
 * решает это запрос, а не шаблон. Забыть проверку в шаблоне легко, и тогда
 * недописанная новость окажется на витрине.
 */
export async function listNews(pool, { limit = DEFAULT_LIMIT, includeDrafts = false } = {}) {
  const { rows } = await pool.query(
    `SELECT ${FIELDS} FROM news
      WHERE $2::boolean OR status = 'published'
      -- Черновик сортируется по дню заведения: даты выхода у него ещё нет, а
      -- проваливаться в конец списка он не должен — автор пишет его сейчас.
      ORDER BY COALESCE(published_at, created_at) DESC LIMIT $1`,
    [limit, includeDrafts]
  );
  return attachImages(pool, rows.map(toNews));
}

/** Одна новость по номеру: шаг очереди знает только его. */
export async function getNewsById(pool, id) {
  const { rows } = await pool.query(`SELECT ${FIELDS} FROM news WHERE id = $1`, [id]);
  if (!rows.length) return null;
  const [item] = await attachImages(pool, [toNews(rows[0])]);
  return item;
}

/** Одна новость по адресу. null, если её нет. */
export async function getNewsBySlug(pool, slug) {
  const { rows } = await pool.query(`SELECT ${FIELDS} FROM news WHERE slug = $1`, [slug]);
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
       RETURNING ${FIELDS}`,
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
     RETURNING ${FIELDS}`,
    [`${slugify(name)}-${stamp}`, name, String(body ?? '')]
  );
  return toNews(rows[0]);
}

/**
 * Выпускает новость в свет или возвращает её в черновики.
 *
 * Дата выхода ставится один раз, при первом выпуске: вернуть новость в
 * черновик и выпустить снова — обычное дело, и если каждый раз обновлять дату,
 * старая новость прыгнет в начало ленты, будто её только что написали.
 */
export async function publishNews(pool, slug, publish = true) {
  const { rows } = await pool.query(
    `UPDATE news
        SET status = $2,
            -- ELSE published_at, а не пустота: вернуть новость в черновик и
            -- выпустить снова — обычное дело, и стирать дату значит поднять
            -- старую новость в начало ленты, будто её только что написали.
            published_at = CASE WHEN $2 = 'published'
                                THEN COALESCE(published_at, now())
                                ELSE published_at END
      WHERE slug = $1
      RETURNING ${FIELDS}`,
    [slug, publish ? 'published' : 'draft']
  );
  return rows.length ? toNews(rows[0]) : null;
}

/** Убирает новость вместе с её картинками: их удалит уборщик буфера. */
export async function deleteNews(pool, slug) {
  const { rowCount } = await pool.query('DELETE FROM news WHERE slug = $1', [slug]);
  return rowCount > 0;
}
