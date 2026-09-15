// Серии уроков и похожие уроки.
//
// Задача — связать уроки между собой двумя способами. Первый — серия: явный
// порядок, заданный автором, «урок 3 из 8». Второй — похожие: их никто не
// задаёт руками, они считаются по общим тегам, иначе на каждый новый урок
// пришлось бы вручную перебирать все прежние.
// Вызывается из src/routes/pages.js, src/routes/admin.js и страницы урока.
import { slugify } from '../lib/slug.js';

/** Строка серии в виде, в котором её ждут шаблоны. */
function toSeries(row) {
  return {
    id: Number(row.id),
    slug: row.slug,
    title: row.title,
    description: row.description,
    // Сколько уроков внутри: список серий без этого числа говорит человеку
    // ровно ничего.
    lessonCount: row.lesson_count === undefined ? undefined : Number(row.lesson_count)
  };
}

/** Короткая карточка урока: серии и «похожим» большего не нужно. */
function toCard(row) {
  return {
    id: Number(row.id),
    slug: row.slug,
    title: row.title,
    description: row.description,
    coverUrl: row.cover_url,
    status: row.status,
    publishedAt: row.published_at,
    position: row.series_position === null ? null : Number(row.series_position)
  };
}

/** Все серии со счётчиком уроков. Пустые тоже: автор их только что завёл. */
export async function listSeries(pool, { includeDrafts = false } = {}) {
  const { rows } = await pool.query(
    `SELECT s.id, s.slug, s.title, s.description,
            count(l.id) FILTER (WHERE $1::boolean OR l.status = 'published') AS lesson_count
       FROM series s
       LEFT JOIN lessons l ON l.series_id = s.id
      GROUP BY s.id
      ORDER BY s.title`,
    [includeDrafts]
  );
  return rows.map(toSeries);
}

/** Серия вместе с её уроками по порядку. null — такой серии нет. */
export async function getSeriesBySlug(pool, slug, { includeDrafts = false } = {}) {
  const { rows } = await pool.query('SELECT * FROM series WHERE slug = $1', [slug]);
  if (!rows.length) return null;

  const series = toSeries(rows[0]);
  series.lessons = await seriesLessons(pool, series.id, { includeDrafts });
  series.lessonCount = series.lessons.length;
  return series;
}

/** Уроки серии по порядку. */
export async function seriesLessons(pool, seriesId, { includeDrafts = false } = {}) {
  const { rows } = await pool.query(
    `SELECT id, slug, title, description, cover_url, status, published_at, series_position
       FROM lessons
      WHERE series_id = $1 AND ($2::boolean OR status = 'published')
      ORDER BY series_position`,
    [seriesId, includeDrafts]
  );
  return rows.map(toCard);
}

/**
 * Заводит или правит серию.
 * Адрес считается из названия один раз, при заведении: менять его потом значит
 * ломать ссылки, которыми уже поделились.
 */
export async function saveSeries(pool, { slug = null, title, description = '' }) {
  const name = String(title ?? '').trim();
  if (!name) throw new Error('название серии пустое');

  if (slug) {
    const { rows } = await pool.query(
      `UPDATE series SET title = $2, description = $3 WHERE slug = $1 RETURNING *`,
      [slug, name, String(description ?? '')]
    );
    return rows.length ? toSeries(rows[0]) : null;
  }

  const base = slugify(name);
  // Одинаковые названия у серий — редкость, но адрес обязан быть один на одну
  // серию, и падать на этом посреди заведения урока незачем.
  const { rows } = await pool.query(
    `INSERT INTO series (slug, title, description)
     VALUES (
       CASE WHEN EXISTS (SELECT 1 FROM series WHERE slug = $1)
            THEN $1 || '-' || nextval(pg_get_serial_sequence('series', 'id'))
            ELSE $1 END,
       $2, $3)
     RETURNING *`,
    [base, name, String(description ?? '')]
  );
  return toSeries(rows[0]);
}

/**
 * Убирает серию. Уроки остаются — они и есть то, ради чего всё.
 *
 * Номер снимаем сами, до удаления. Само по себе ON DELETE SET NULL обнуляет
 * только ссылку на серию, номер в ней остаётся — и урок упирается в правило
 * «номер без серии бессмыслен». Удаление тогда падает ошибкой базы прямо в
 * лицо автору, а серия остаётся неудаляемой.
 */
export async function deleteSeries(pool, slug) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT id FROM series WHERE slug = $1', [slug]);
    if (!rows.length) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(
      'UPDATE lessons SET series_id = NULL, series_position = NULL WHERE series_id = $1',
      [rows[0].id]
    );
    await client.query('DELETE FROM series WHERE id = $1', [rows[0].id]);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Нумерует уроки серии подряд с единицы в заданном порядке.
 * Номера без дыр: иначе автор видит «1, 3» и ищет пропавший второй урок.
 */
async function renumber(client, seriesId, orderedIds) {
  if (!orderedIds.length) return;
  await client.query(
    `UPDATE lessons l
        SET series_id = $1, series_position = o.ord
       FROM unnest($2::bigint[]) WITH ORDINALITY AS o(id, ord)
      WHERE l.id = o.id`,
    [seriesId, orderedIds]
  );
}

/**
 * Ставит урок в серию или вынимает его оттуда.
 *
 * Номер не указан — урок встаёт в конец: автор чаще всего выкладывает уроки
 * по порядку. А если урок уже в этой серии, номер не трогаем: иначе
 * «сохранить» на экране урока каждый раз отправляло бы его в конец списка.
 * Номер указан — урок встаёт на это место, остальные сдвигаются; номер больше
 * числа уроков означает «в конец». Серия, которую урок покинул, смыкается.
 *
 * Всё в одной сделке с отложенной проверкой уникальности: на середине
 * перенумерации два урока неизбежно стоят на одном номере.
 */
export async function setLessonSeries(pool, lessonId, seriesId, { position = null } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET CONSTRAINTS lessons_series_position_key DEFERRED');

    const { rows: mine } = await client.query(
      'SELECT series_id FROM lessons WHERE id = $1 FOR UPDATE',
      [lessonId]
    );
    if (!mine.length) {
      await client.query('ROLLBACK');
      return null;
    }
    const previousSeriesId = mine[0].series_id === null ? null : Number(mine[0].series_id);
    const targetSeriesId = seriesId ? Number(seriesId) : null;

    let placed = null;
    if (targetSeriesId === null) {
      await client.query(
        'UPDATE lessons SET series_id = NULL, series_position = NULL WHERE id = $1',
        [lessonId]
      );
    } else {
      const { rows } = await client.query(
        'SELECT id FROM lessons WHERE series_id = $1 ORDER BY series_position FOR UPDATE',
        [targetSeriesId]
      );
      const ids = rows.map((row) => Number(row.id));
      const current = ids.indexOf(Number(lessonId));
      const others = ids.filter((id) => id !== Number(lessonId));
      const index =
        position !== null
          ? Math.min(Math.max(Number(position) - 1, 0), others.length)
          : current >= 0
            ? current
            : others.length;
      others.splice(index, 0, Number(lessonId));
      await renumber(client, targetSeriesId, others);
      placed = index + 1;
    }

    // Урок ушёл из прежней серии — она смыкается, чтобы не зиять дырой.
    if (previousSeriesId !== null && previousSeriesId !== targetSeriesId) {
      const { rows } = await client.query(
        'SELECT id FROM lessons WHERE series_id = $1 ORDER BY series_position FOR UPDATE',
        [previousSeriesId]
      );
      await renumber(
        client,
        previousSeriesId,
        rows.map((row) => Number(row.id))
      );
    }

    await client.query('COMMIT');
    return placed;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Меняет урок местами с соседом по серии.
 *
 * Стрелками, а не перетаскиванием: автор чаще всего у телефона, и тащить
 * строку пальцем по списку там мучительно, а промах не виден до перезагрузки.
 * Обмен идёт в одной сделке с отложенной проверкой уникальности: на середине
 * обмена два урока неизбежно стоят на одном номере.
 */
export async function moveLessonInSeries(pool, lessonSlug, direction) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET CONSTRAINTS lessons_series_position_key DEFERRED');

    const { rows: mine } = await client.query(
      'SELECT id, series_id, series_position FROM lessons WHERE slug = $1 FOR UPDATE',
      [lessonSlug]
    );
    if (!mine.length || mine[0].series_id === null) {
      await client.query('ROLLBACK');
      return false;
    }

    const { rows: neighbour } = await client.query(
      `SELECT id, series_position FROM lessons
        WHERE series_id = $1 AND series_position ${direction === 'up' ? '<' : '>'} $2
        ORDER BY series_position ${direction === 'up' ? 'DESC' : 'ASC'}
        LIMIT 1 FOR UPDATE`,
      [mine[0].series_id, mine[0].series_position]
    );
    // Край списка — не ошибка: кнопка просто ничего не делает.
    if (!neighbour.length) {
      await client.query('ROLLBACK');
      return false;
    }

    await client.query('UPDATE lessons SET series_position = $2 WHERE id = $1', [
      mine[0].id,
      neighbour[0].series_position
    ]);
    await client.query('UPDATE lessons SET series_position = $2 WHERE id = $1', [
      neighbour[0].id,
      mine[0].series_position
    ]);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Место урока в серии: сама серия, номер, всего и соседи.
 * null — урок ни в какой серии не состоит.
 */
export async function seriesNavigation(pool, lesson, { includeDrafts = false } = {}) {
  if (!lesson?.seriesId) return null;

  const { rows } = await pool.query('SELECT * FROM series WHERE id = $1', [lesson.seriesId]);
  if (!rows.length) return null;

  const lessons = await seriesLessons(pool, lesson.seriesId, { includeDrafts });
  // Номер считаем по месту в списке, а не по series_position: черновики из
  // списка выпали, и «урок 5 из 3» — это то, что увидел бы зритель.
  const index = lessons.findIndex((item) => item.id === lesson.id);

  return {
    series: toSeries(rows[0]),
    total: lessons.length,
    number: index === -1 ? null : index + 1,
    previous: index > 0 ? lessons[index - 1] : null,
    next: index !== -1 && index + 1 < lessons.length ? lessons[index + 1] : null
  };
}

/**
 * Похожие уроки: больше общих тегов — выше, при равенстве свежие вперёд.
 *
 * Уроки той же серии сюда не попадают: они уже показаны блоком серии, и
 * повторять их значит отнимать место у того, чего человек ещё не видел.
 * Не набралось по тегам — дополняем свежими: пустой блок «похожие» выглядит
 * поломкой, а у нового урока тегов может не быть вовсе.
 */
export async function relatedLessons(pool, lesson, { limit = 3 } = {}) {
  const { rows } = await pool.query(
    `SELECT l.id, l.slug, l.title, l.description, l.cover_url, l.status, l.published_at,
            l.series_position, count(*) AS shared
       FROM lessons l
       JOIN lesson_tags lt ON lt.lesson_id = l.id
      WHERE lt.tag_id IN (SELECT tag_id FROM lesson_tags WHERE lesson_id = $1)
        AND l.id <> $1
        AND l.status = 'published'
        AND ($2::bigint IS NULL OR l.series_id IS DISTINCT FROM $2)
      GROUP BY l.id
      ORDER BY shared DESC, l.published_at DESC NULLS LAST
      LIMIT $3`,
    [lesson.id, lesson.seriesId ?? null, limit]
  );
  const found = rows.map(toCard);
  if (found.length >= limit) return found;

  const { rows: fresh } = await pool.query(
    `SELECT id, slug, title, description, cover_url, status, published_at, series_position
       FROM lessons
      WHERE status = 'published' AND id <> ALL($1::bigint[])
        AND ($2::bigint IS NULL OR series_id IS DISTINCT FROM $2)
      ORDER BY published_at DESC NULLS LAST
      LIMIT $3`,
    [[lesson.id, ...found.map((item) => item.id)], lesson.seriesId ?? null, limit - found.length]
  );
  return [...found, ...fresh.map(toCard)];
}
