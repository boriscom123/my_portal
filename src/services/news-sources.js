// Официальные источники анонсов.
//
// Задача — хранить список лент, которые портал спрашивает про свежие новости
// мира, и дать автору править его самому. Зачем в базе, а не в коде: сегодня
// источников девять, завтра появится NVIDIA — правка и выкатка ради одной
// строки того не стоят.
// Вызывается из src/services/announcements.js и из настроек.

/** Список источников. Отключённые видны автору, но не спрашиваются. */
export async function listSources(pool, { onlyEnabled = false } = {}) {
  const { rows } = await pool.query(
    `SELECT id, title, url, enabled FROM news_sources
      WHERE ($1::boolean = false OR enabled)
      ORDER BY position, id`,
    [onlyEnabled]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    url: row.url,
    enabled: row.enabled
  }));
}

/** Добавляет источник. Повтор адреса не заводит второй такой же. */
export async function addSource(pool, { title, url }) {
  const name = String(title ?? '').trim();
  const address = String(url ?? '').trim();
  if (!name || !address) throw new Error('у источника должны быть название и адрес ленты');
  if (!/^https?:\/\//i.test(address)) throw new Error('адрес ленты должен начинаться с http');

  const { rows } = await pool.query(
    `INSERT INTO news_sources (title, url, position)
     VALUES ($1, $2, COALESCE((SELECT max(position) + 1 FROM news_sources), 1))
     ON CONFLICT (url) DO UPDATE SET title = EXCLUDED.title, enabled = true
     RETURNING id, title, url, enabled`,
    [name, address]
  );
  return {
    id: Number(rows[0].id),
    title: rows[0].title,
    url: rows[0].url,
    enabled: rows[0].enabled
  };
}

/** Убирает источник совсем. */
export async function removeSource(pool, id) {
  const { rowCount } = await pool.query('DELETE FROM news_sources WHERE id = $1', [Number(id)]);
  return rowCount > 0;
}

/** Включает или выключает источник, не удаляя его. */
export async function toggleSource(pool, id, enabled) {
  await pool.query('UPDATE news_sources SET enabled = $2 WHERE id = $1', [
    Number(id),
    Boolean(enabled)
  ]);
}
