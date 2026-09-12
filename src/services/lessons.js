// Витрина: чтение и правка уроков и новостей.
//
// Задача — быть единственным местом, которое знает SQL про контент. Зачем:
// правило «черновик наружу не показываем» должно жить в одном условии, а не
// повторяться в каждом маршруте и каждом шаблоне — там его однажды забудут.
// Вызывается из src/routes/lessons.js и src/routes/pages.js.

import { slugify, uniqueSlug } from '../lib/slug.js';

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
    // Упавшая задача целиком: имя шага и его данные. Ими живёт кнопка
    // «Повторить» на экране проверки.
    pipelineJob: row.pipeline_job ?? null,
    // Отказ необязательного шага — нарисовать обложку, предложить заголовок.
    // Урок при нём цел, и состояние конвейера он не трогает.
    sideError: row.generated?.sideError ?? null,
    // Идёт ли рисование обложки и по какому запросу нарисована последняя —
    // см. src/services/cover-drawing.js.
    drawing: row.generated?.drawing ?? null,
    coverPrompt: row.generated?.coverPrompt ?? null,
    // Главы урока: правит их автор, а уезжают они в описание ролика. Лежат
    // рядом с предложенным моделью — в колонке, заведённой ровно под это.
    chapters: row.generated?.chapters ?? [],
    // Отрезки, оставленные монтажом: по ним время глав переводится на
    // смонтированную запись — см. src/services/trim-ranges.js.
    trimRanges: row.generated?.trimRanges ?? null,
    // Настройки подготовки урока. Без них экран проверки показывал умолчания
    // вместо сохранённого, и это выглядело как «настройки не сохраняются»:
    // следующее сохранение отправляло умолчания обратно и затирало настоящие.
    settings: row.settings ?? {},
    // Есть ли у урока запись. Нужен странице загрузки: по нему она понимает,
    // копирование ещё идёт или уже кончилось.
    sourceAssetId: row.source_asset_id ? Number(row.source_asset_id) : null,
    tags: row.tags ?? [],
    // Серия, в которой стоит урок. Номер здесь — тот, что в базе; зрителю
    // показывается место в списке вышедших, см. seriesNavigation.
    seriesId: row.series_id ? Number(row.series_id) : null,
    seriesPosition: row.series_position === null ? null : Number(row.series_position)
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
  const lessons = rows.map(toLesson);
  if (!lessons.length) return lessons;

  // Ссылки на площадки — одним запросом на всю страницу, а не по одному на
  // урок: двадцать карточек означали бы двадцать походов в базу за тремя
  // строчками каждый.
  const { rows: pubs } = await pool.query(
    `SELECT lesson_id, platform, url, state FROM publications
      WHERE lesson_id = ANY($1::bigint[]) ORDER BY platform`,
    [lessons.map((lesson) => lesson.id)]
  );
  for (const lesson of lessons) {
    lesson.publications = pubs
      .filter((row) => Number(row.lesson_id) === lesson.id)
      .map(({ platform, url, state }) => ({ platform, url, state }));
  }
  return lessons;
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
 * Урок по номеру — для шагов конвейера. Они знают номер, а не slug: имя урока
 * меняется вместе с заголовком, а задача в очереди живёт минутами и часами.
 * Теги здесь нужны: они уезжают на площадку вместе с роликом.
 * Вызывается из src/jobs/publish-youtube.js.
 */
export async function getLessonById(pool, id) {
  const { rows } = await pool.query(
    `SELECT l.*, COALESCE(array_agg(t.slug ORDER BY t.slug) FILTER (WHERE t.slug IS NOT NULL), '{}') AS tags
       FROM lessons l
       LEFT JOIN lesson_tags lt ON lt.lesson_id = l.id
       LEFT JOIN tags t ON t.id = lt.tag_id
      WHERE l.id = $1
      GROUP BY l.id`,
    [id]
  );
  return rows.length ? toLesson(rows[0]) : null;
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

/**
 * Пересобирает адрес урока из заголовка и отдаёт новый.
 *
 * Зачем: адрес собирается при заведении урока, когда заголовка ещё нет — тогда
 * он временный, с датой («Урок от 2026-09-10»). Автор пишет настоящий заголовок
 * на экране проверки, и адрес должен стать по нему, а не остаться датой.
 * Из заголовка вроде «!!! ???» адреса не выходит — тогда адрес по номеру урока:
 * урок без адреса не открыть.
 *
 * Вызывать можно только пока урок никуда не ушёл: после публикации адрес стоит
 * в описании ролика на YouTube и в постах каналов, и менять его значит ломать
 * те ссылки. Это решает вызывающий — src/routes/admin.js при утверждении.
 */
export async function renameLessonSlug(pool, { lessonId, title }) {
  // Свой адрес из занятых исключаем: иначе заголовок, оставленный без правки,
  // превращал бы «rabota-s-docker» в «rabota-s-docker-2».
  const { rows: taken } = await pool.query('SELECT slug FROM lessons WHERE id <> $1', [lessonId]);
  const base = slugify(title) || String(lessonId);
  const slug = uniqueSlug(
    base,
    taken.map((row) => row.slug)
  );
  const { rows } = await pool.query('UPDATE lessons SET slug = $2 WHERE id = $1 RETURNING slug', [
    lessonId,
    slug
  ]);
  return rows[0].slug;
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


