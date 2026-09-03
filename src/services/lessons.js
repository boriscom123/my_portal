// Витрина: чтение и правка уроков и новостей.
//
// Задача — быть единственным местом, которое знает SQL про контент. Зачем:
// правило «черновик наружу не показываем» должно жить в одном условии, а не
// повторяться в каждом маршруте и каждом шаблоне — там его однажды забудут.
// Вызывается из src/routes/lessons.js и src/routes/pages.js.

// Сколько уроков отдаём за раз. Лента бесконечной не бывает, а без предела
// первый же год работы портала превратит главную в мегабайт HTML.
const DEFAULT_LIMIT = 20;

/** Приводит строку базы к виду, в котором её ждут шаблоны и API. */
function toLesson(row) {
  return {
    id: Number(row.id),
    slug: row.slug,
    title: row.title,
    description: row.description,
    coverUrl: row.cover_url,
    status: row.status,
    publishedAt: row.published_at,
    durationSeconds: row.duration_seconds,
    // Состояние обработки: отдельно от статуса. Статус видит зритель,
    // состояние — только автор в кабинете.
    pipelineState: row.pipeline_state ?? 'idle',
    pipelineError: row.pipeline_error ?? null,
    tags: row.tags ?? []
  };
}

/** Лента уроков. includeDrafts включается только для админа. */
export async function listLessons(
  pool,
  { tag = null, limit = DEFAULT_LIMIT, offset = 0, includeDrafts = false }
) {
  const { rows } = await pool.query(
    `SELECT l.*, COALESCE(array_agg(t.slug ORDER BY t.slug) FILTER (WHERE t.slug IS NOT NULL), '{}') AS tags
       FROM lessons l
       LEFT JOIN lesson_tags lt ON lt.lesson_id = l.id
       LEFT JOIN tags t ON t.id = lt.tag_id
      WHERE ($1::boolean OR l.status = 'published')
        AND ($2::text IS NULL OR EXISTS (
              SELECT 1 FROM lesson_tags lt2
                JOIN tags t2 ON t2.id = lt2.tag_id
               WHERE lt2.lesson_id = l.id AND t2.slug = $2))
      GROUP BY l.id
      ORDER BY COALESCE(l.published_at, l.created_at) DESC
      LIMIT $3 OFFSET $4`,
    [includeDrafts, tag, limit, offset]
  );
  return rows.map(toLesson);
}

/** Карточка урока вместе со ссылками на площадки. null, если показывать нечего. */
export async function getLessonBySlug(pool, slug, { includeDrafts = false }) {
  const { rows } = await pool.query(
    `SELECT l.*, COALESCE(array_agg(t.slug ORDER BY t.slug) FILTER (WHERE t.slug IS NOT NULL), '{}') AS tags
       FROM lessons l
       LEFT JOIN lesson_tags lt ON lt.lesson_id = l.id
       LEFT JOIN tags t ON t.id = lt.tag_id
      WHERE l.slug = $1 AND ($2::boolean OR l.status = 'published')
      GROUP BY l.id`,
    [slug, includeDrafts]
  );
  if (!rows.length) return null;

  const lesson = toLesson(rows[0]);
  const { rows: pubs } = await pool.query(
    `SELECT platform, url, state FROM publications WHERE lesson_id = $1 ORDER BY platform`,
    [lesson.id]
  );
  lesson.publications = pubs;
  return lesson;
}

/**
 * Заводит или обновляет урок по slug.
 * Зачем один метод на оба случая: карточка урока правится многократно — при
 * загрузке, после расшифровки, после проверки автором, — и раздельные
 * create/update означали бы «сначала выясни, есть ли он уже» в каждом месте.
 * Незаданные поля не затираются: правка заголовка не должна снять урок с
 * публикации и стереть описание.
 */
export async function saveLesson(pool, lesson) {
  const { rows } = await pool.query(
    `INSERT INTO lessons (slug, title, description, cover_url, status, published_at, duration_seconds)
     VALUES ($1, $2, COALESCE($3, ''), $4, COALESCE($5, 'draft'), $6, $7)
     ON CONFLICT (slug) DO UPDATE SET
       title = EXCLUDED.title,
       description = COALESCE($3, lessons.description),
       cover_url = COALESCE($4, lessons.cover_url),
       status = COALESCE($5, lessons.status),
       published_at = COALESCE($6, lessons.published_at),
       duration_seconds = COALESCE($7, lessons.duration_seconds)
     RETURNING *`,
    [
      lesson.slug,
      lesson.title,
      lesson.description ?? null,
      lesson.coverUrl ?? null,
      lesson.status ?? null,
      lesson.publishedAt ?? null,
      lesson.durationSeconds ?? null
    ]
  );
  return toLesson(rows[0]);
}

/** Заменяет набор тегов урока целиком. Незнакомые теги заводятся на лету. */
export async function setLessonTags(pool, lessonId, tagSlugs) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM lesson_tags WHERE lesson_id = $1', [lessonId]);
    for (const slug of tagSlugs) {
      const { rows } = await client.query(
        `INSERT INTO tags (slug, title) VALUES ($1, $1)
         ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
         RETURNING id`,
        [slug]
      );
      await client.query('INSERT INTO lesson_tags (lesson_id, tag_id) VALUES ($1, $2)', [
        lessonId,
        rows[0].id
      ]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Лента новостей. Новость публикуется сразу: черновиков у неё нет. */
export async function listNews(pool, { limit = DEFAULT_LIMIT } = {}) {
  const { rows } = await pool.query(
    'SELECT id, slug, title, body, published_at FROM news ORDER BY published_at DESC LIMIT $1',
    [limit]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    slug: r.slug,
    title: r.title,
    body: r.body,
    publishedAt: r.published_at
  }));
}
