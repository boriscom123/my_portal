// Проекты: пометка уроков, новостей и серий.
//
// Задача — связать материалы с проектами автора (этот портал, IDLE игра,
// Уведомлятор…), чтобы зритель одним нажатием видел материалы одного проекта.
// Основной проект и связанные лежат в одних таблицах связей с пометкой
// is_main: удаление проекта убирает только связи, материалы остаются. Поэтому
// «проект обязателен» проверяется здесь и на экранах, а не базой.
// Серия задаёт основной проект своим урокам — правило живёт тоже здесь.
// Вызывается из src/routes/admin.js, src/routes/pages.js и служб уроков,
// новостей и серий.
import { slugify } from '../lib/slug.js';

// Таблица связей и колонка материала для каждого вида.
const LINKS = {
  lesson: { table: 'lesson_projects', column: 'lesson_id' },
  news: { table: 'news_projects', column: 'news_id' },
  series: { table: 'series_projects', column: 'series_id' }
};

/** Отказ со своим кодом: маршрут переводит его в ответ со словами. */
export class ProjectError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function toProject(row) {
  return {
    id: Number(row.id),
    slug: row.slug,
    title: row.title,
    description: row.description,
    lessonCount: row.lesson_count === undefined ? undefined : Number(row.lesson_count),
    newsCount: row.news_count === undefined ? undefined : Number(row.news_count),
    seriesCount: row.series_count === undefined ? undefined : Number(row.series_count),
    // Сколько материалов останутся без основного, если проект удалить.
    mainCount: row.main_count === undefined ? undefined : Number(row.main_count)
  };
}

/** Все проекты со счётчиками материалов — для раздела настроек. */
export async function listProjects(pool) {
  const { rows } = await pool.query(
    `SELECT p.*,
            (SELECT count(*) FROM lesson_projects x WHERE x.project_id = p.id) AS lesson_count,
            (SELECT count(*) FROM news_projects x WHERE x.project_id = p.id) AS news_count,
            (SELECT count(*) FROM series_projects x WHERE x.project_id = p.id) AS series_count,
            (SELECT count(*) FROM lesson_projects x WHERE x.project_id = p.id AND x.is_main)
          + (SELECT count(*) FROM news_projects x WHERE x.project_id = p.id AND x.is_main)
          + (SELECT count(*) FROM series_projects x WHERE x.project_id = p.id AND x.is_main) AS main_count
       FROM projects p
      ORDER BY p.title`
  );
  return rows.map(toProject);
}

/** Проект по адресу. null — такого нет. */
export async function getProjectBySlug(pool, slug) {
  const { rows } = await pool.query('SELECT * FROM projects WHERE slug = $1', [String(slug)]);
  return rows.length ? toProject(rows[0]) : null;
}

/**
 * Заводит или правит проект.
 * Адрес считается из названия один раз, при заведении: менять его потом значит
 * ломать ссылки с фильтром, которыми уже поделились.
 */
export async function saveProject(pool, { slug = null, title, description = '' }) {
  const name = String(title ?? '').trim();
  if (!name) throw new ProjectError('empty_title', 'Название проекта пустое');

  if (slug) {
    const { rows } = await pool.query(
      'UPDATE projects SET title = $2, description = $3 WHERE slug = $1 RETURNING *',
      [slug, name, String(description ?? '')]
    );
    return rows.length ? toProject(rows[0]) : null;
  }

  // Из названия вроде «!!!» адреса не выйдет — тогда общий, с номером ниже.
  const base = slugify(name) || 'proekt';
  const { rows } = await pool.query(
    `INSERT INTO projects (slug, title, description)
     VALUES (
       CASE WHEN EXISTS (SELECT 1 FROM projects WHERE slug = $1)
            THEN $1 || '-' || nextval(pg_get_serial_sequence('projects', 'id'))
            ELSE $1 END,
       $2, $3)
     RETURNING *`,
    [base, name, String(description ?? '')]
  );
  return toProject(rows[0]);
}

/**
 * Убирает проект. Материалы остаются — уходят только связи, так заведены
 * внешние ключи. Возвращает, сколько материалов остались без основного
 * проекта: автору это называется при подтверждении.
 */
export async function deleteProject(pool, slug) {
  const project = await getProjectBySlug(pool, slug);
  if (!project) return { deleted: false, orphaned: null };

  const {
    rows: [counts]
  } = await pool.query(
    `SELECT (SELECT count(*) FROM lesson_projects WHERE project_id = $1 AND is_main) AS lessons,
            (SELECT count(*) FROM news_projects WHERE project_id = $1 AND is_main) AS news,
            (SELECT count(*) FROM series_projects WHERE project_id = $1 AND is_main) AS series`,
    [project.id]
  );
  await pool.query('DELETE FROM projects WHERE id = $1', [project.id]);
  return {
    deleted: true,
    orphaned: {
      lessons: Number(counts.lessons),
      news: Number(counts.news),
      series: Number(counts.series)
    }
  };
}

/**
 * Проекты материалов одним запросом на всю страницу.
 * У материала без связей — { main: null, related: [] }.
 */
export async function projectsFor(db, kind, ids) {
  const owners = ids.map(Number);
  const result = new Map(owners.map((id) => [id, { main: null, related: [] }]));
  if (!owners.length) return result;

  const { table, column } = LINKS[kind];
  const { rows } = await db.query(
    `SELECT x.${column} AS owner_id, x.is_main, p.id, p.slug, p.title
       FROM ${table} x
       JOIN projects p ON p.id = x.project_id
      WHERE x.${column} = ANY($1::bigint[])
      ORDER BY p.title`,
    [owners]
  );
  for (const row of rows) {
    const entry = result.get(Number(row.owner_id));
    const project = { id: Number(row.id), slug: row.slug, title: row.title };
    if (row.is_main) entry.main = project;
    else entry.related.push(project);
  }
  return result;
}

/**
 * Ставит основной проект, не трогая связанные. Если этот проект был среди
 * связанных, оттуда он уходит: основным и связанным сразу он не бывает.
 */
export async function setMainProject(db, kind, id, projectId) {
  const { table, column } = LINKS[kind];
  await db.query(`DELETE FROM ${table} WHERE ${column} = $1 AND (is_main OR project_id = $2)`, [
    id,
    projectId
  ]);
  await db.query(`INSERT INTO ${table} (${column}, project_id, is_main) VALUES ($1, $2, true)`, [
    id,
    projectId
  ]);
}

/** Урок встал в серию — получает её основной проект, если он у серии есть. */
export async function inheritSeriesProject(db, lessonId, seriesId) {
  const { rows } = await db.query(
    'SELECT project_id FROM series_projects WHERE series_id = $1 AND is_main',
    [seriesId]
  );
  if (rows.length) await setMainProject(db, 'lesson', lessonId, Number(rows[0].project_id));
}

/**
 * Основной и связанные проекты материала целиком — блок проектов на экране.
 * Проект необязателен: mainId пустой — основного нет, связанные ставятся и без
 * него. Урок в серии с основным проектом держит проект серии: другой — отказ.
 * Серия с проектом меняет основной проект всем своим урокам; снятый проект
 * серии у уроков остаётся.
 */
export async function setProjects(pool, kind, id, { mainId = null, relatedIds = [] }) {
  const main = mainId ? Number(mainId) : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (kind === 'lesson') {
      const { rows } = await client.query(
        `SELECT sp.project_id FROM lessons l
           JOIN series_projects sp ON sp.series_id = l.series_id AND sp.is_main
          WHERE l.id = $1`,
        [id]
      );
      if (rows.length && Number(rows[0].project_id) !== main) {
        throw new ProjectError('series_locked', 'Основной проект урока задаётся серией');
      }
    }

    const { table, column } = LINKS[kind];
    await client.query(`DELETE FROM ${table} WHERE ${column} = $1`, [id]);
    if (main) {
      await client.query(
        `INSERT INTO ${table} (${column}, project_id, is_main) VALUES ($1, $2, true)`,
        [id, main]
      );
    }
    const related = [...new Set(relatedIds.map(Number))].filter((item) => item && item !== main);
    if (related.length) {
      await client.query(
        `INSERT INTO ${table} (${column}, project_id, is_main)
         SELECT $1, unnest($2::bigint[]), false`,
        [id, related]
      );
    }

    if (kind === 'series' && main) {
      const { rows: lessons } = await client.query('SELECT id FROM lessons WHERE series_id = $1', [
        id
      ]);
      for (const lesson of lessons) {
        await setMainProject(client, 'lesson', Number(lesson.id), main);
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Проект для заведения материала. Проект необязателен: не выбран — null, и
 * материал заводится без проекта; подстановки «по умолчанию» нет — автор сам
 * решает, нужен ли проект. Выбранный, но несуществующий — отказ до заведения.
 */
export async function resolveProjectId(db, projectId = null) {
  if (!projectId) return null;
  const { rows } = await db.query('SELECT id FROM projects WHERE id = $1', [projectId]);
  if (!rows.length) throw new ProjectError('not_found', 'Проект не найден');
  return Number(rows[0].id);
}

/** Номера проектов по адресам из формы, в том же порядке. Неизвестный — отказ. */
export async function projectIdsBySlugs(db, slugs) {
  const wanted = [...new Set(slugs.map(String).filter(Boolean))];
  if (!wanted.length) return [];
  const { rows } = await db.query('SELECT id, slug FROM projects WHERE slug = ANY($1::text[])', [
    wanted
  ]);
  if (rows.length !== wanted.length) throw new ProjectError('not_found', 'Проект не найден');
  const bySlug = new Map(rows.map((row) => [row.slug, Number(row.id)]));
  return wanted.map((slug) => bySlug.get(slug));
}
