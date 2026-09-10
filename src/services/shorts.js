// Короткие вертикальные ролики.
//
// Задача — раздел, устроенный как новости: черновик, выпуск, своя страница. Но
// с двумя источниками содержимого: нарезка, которую сделал конвейер из урока, и
// файл, снятый и смонтированный автором отдельно. Различие между ними живёт
// только здесь — дальше, на площадках, это просто ролик.
// Вызывается из src/routes/pages.js, src/routes/admin.js и src/routes/upload.js.
import { slugify } from '../lib/slug.js';

const DEFAULT_LIMIT = 20;
const FIELDS = `id, slug, title, description, status, asset_id, cover_url, lesson_id,
                published_at, created_at`;

// То же самое, но с именем таблицы: ролик почти везде читается вместе с уроком,
// из которого вырезан, и без приставки postgres не знает, чей это slug.
const JOINED = `s.id, s.slug, s.title, s.description, s.status, s.asset_id, s.cover_url,
                s.lesson_id, s.published_at, s.created_at,
                l.slug AS lesson_slug, l.title AS lesson_title
           FROM shorts s LEFT JOIN lessons l ON l.id = s.lesson_id`;

/** Строка базы в виде, в котором её ждут шаблоны. */
function toShort(row) {
  return {
    id: Number(row.id),
    slug: row.slug,
    title: row.title,
    description: row.description,
    status: row.status,
    assetId: row.asset_id === null ? null : Number(row.asset_id),
    coverUrl: row.cover_url,
    lessonId: row.lesson_id === null ? null : Number(row.lesson_id),
    publishedAt: row.published_at,
    createdAt: row.created_at,
    // Урок, из которого вырезан ролик: нужен ссылкой на странице и в посте.
    // Заполняется только там, где есть что показать.
    lesson: row.lesson_slug ? { slug: row.lesson_slug, title: row.lesson_title } : null
  };
}

/**
 * Лента роликов, свежие сверху.
 * Черновик сортируется по дню заведения: даты выхода у него ещё нет, а
 * проваливаться в конец списка он не должен — автор работает с ним сейчас.
 */
export async function listShorts(pool, { limit = DEFAULT_LIMIT, includeDrafts = false } = {}) {
  const { rows } = await pool.query(
    `SELECT ${JOINED}
      WHERE $2::boolean OR s.status = 'published'
      ORDER BY COALESCE(s.published_at, s.created_at) DESC LIMIT $1`,
    [limit, includeDrafts]
  );
  return rows.map(toShort);
}

/** Один ролик по адресу. null, если его нет. */
export async function getShortBySlug(pool, slug) {
  const { rows } = await pool.query(`SELECT ${JOINED} WHERE s.slug = $1`, [slug]);
  return rows.length ? toShort(rows[0]) : null;
}

/** Один ролик по номеру: шаг очереди знает только его. */
export async function getShortById(pool, id) {
  const { rows } = await pool.query(`SELECT ${JOINED} WHERE s.id = $1`, [id]);
  return rows.length ? toShort(rows[0]) : null;
}

/**
 * Заводит или правит ролик.
 * Адрес считается из заголовка один раз, при заведении: менять его потом значит
 * ломать ссылки, которыми уже поделились.
 */
export async function saveShort(pool, { slug = null, title, description = '', lessonId = null }) {
  const name = String(title ?? '').trim();
  if (!name) throw new Error('заголовок ролика пустой');

  if (slug) {
    const { rows } = await pool.query(
      `UPDATE shorts SET title = $2, description = $3 WHERE slug = $1 RETURNING ${FIELDS}`,
      [slug, name, String(description ?? '')]
    );
    return rows.length ? toShort(rows[0]) : null;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query(
    `INSERT INTO shorts (slug, title, description, lesson_id)
     VALUES ($1, $2, $3, $4) RETURNING ${FIELDS}`,
    [`${slugify(name)}-${stamp}`, name, String(description ?? ''), lessonId]
  );
  return toShort(rows[0]);
}

/**
 * Делает роликом готовую нарезку урока.
 *
 * Файл остаётся за уроком, ролик на него ссылается — иначе нарезка исчезла бы с
 * экрана урока, где автор её и смотрит. А вот срок жизни с файла снимается: у
 * нарезки он как у исходника, и через несколько суток уборщик удалил бы то, на
 * что смотрит зритель.
 *
 * null — у этой нарезки ролик уже есть. Второй завести нельзя: в разделе
 * оказались бы близнецы, и какой из них отправлен, было бы не разобрать.
 */
export async function shortFromClip(pool, { assetId, lesson, title }) {
  const exists = await pool.query('SELECT slug FROM shorts WHERE asset_id = $1', [assetId]);
  if (exists.rows.length) return null;

  const short = await saveShort(pool, { title, lessonId: lesson.id });
  await pool.query('UPDATE shorts SET asset_id = $2 WHERE id = $1', [short.id, assetId]);
  await pool.query('UPDATE assets SET expires_at = NULL WHERE id = $1', [assetId]);
  return { ...short, assetId };
}

/** Привязывает к ролику загруженный файл и его кадр-заставку. */
export async function setShortFile(pool, shortId, { assetId, coverUrl = null }) {
  const { rows } = await pool.query(
    `UPDATE shorts SET asset_id = $2, cover_url = COALESCE($3, cover_url)
      WHERE id = $1 RETURNING ${FIELDS}`,
    [shortId, assetId, coverUrl]
  );
  return rows.length ? toShort(rows[0]) : null;
}

/**
 * Выпускает ролик в свет или возвращает в черновики.
 * Дата выхода ставится один раз: вернуть ролик в черновик и выпустить снова —
 * обычное дело, и обновляй мы дату каждый раз, старый ролик прыгал бы в начало
 * раздела.
 */
export async function publishShort(pool, slug, publish = true) {
  const { rows } = await pool.query(
    `UPDATE shorts
        SET status = $2,
            published_at = CASE WHEN $2 = 'published'
                                THEN COALESCE(published_at, now())
                                ELSE published_at END
      WHERE slug = $1
      RETURNING ${FIELDS}`,
    [slug, publish ? 'published' : 'draft']
  );
  return rows.length ? toShort(rows[0]) : null;
}

/**
 * Убирает ролик. Свои файлы уходят с ним, чужие остаются: нарезка принадлежит
 * уроку, и удаление ролика не должно вырывать её из урока.
 */
export async function deleteShort(pool, slug) {
  const { rowCount } = await pool.query('DELETE FROM shorts WHERE slug = $1', [slug]);
  return rowCount > 0;
}

/** Ролики, вырезанные из этого урока: экран урока показывает, что уже сделано. */
export async function shortsOfLesson(pool, lessonId) {
  const { rows } = await pool.query(
    `SELECT ${FIELDS} FROM shorts WHERE lesson_id = $1 ORDER BY id`,
    [lessonId]
  );
  return rows.map(toShort);
}
