// Состояния публикации урока на площадке.
//
// Задача — держать в одном месте смену состояний: их меняют маршрут (поставил
// задачу), шаг очереди (веду, кончил, упал) и кнопка «Проверить» (автор открыл
// ролик). Зачем сервисом, а не запросами по месту: строку публикации надо не
// заводить заново, а переписывать, и прежнюю ошибку при повторе стирать —
// забыть это в одном из трёх мест значит оставить урок красным после удачного
// повтора.
// Вызывается из src/routes/admin.js и src/jobs/publish-youtube.js.

/**
 * Ставит публикацию в очередь. Повтор переписывает ту же строку.
 * assetId — файл, который уезжает: у урока их несколько, и публикация привязана
 * к файлу, а не к уроку.
 */
export async function startPublication(pool, { lessonId, platform, assetId = null, mode }) {
  const { rows } = await pool.query(
    `INSERT INTO publications (lesson_id, platform, asset_id, state, mode, error, updated_at)
     VALUES ($1, $2, $3, 'queued', $4, NULL, now())
     ON CONFLICT (lesson_id, platform, asset_id)
       DO UPDATE SET state = 'queued', mode = EXCLUDED.mode, error = NULL, updated_at = now()
     RETURNING id`,
    [lessonId, platform, assetId, mode]
  );
  return { id: Number(rows[0].id) };
}

/**
 * Записывает новое состояние.
 * Ссылка и внешний номер не затираются пустотой: кнопка «Проверить» знает
 * только новое состояние, и без COALESCE адрес ролика пропал бы из карточки
 * ровно в тот миг, когда он там наконец понадобился.
 */
export async function markPublicationState(
  pool,
  id,
  { state, externalId = null, url = null, error = null }
) {
  await pool.query(
    `UPDATE publications
        SET state = $2,
            external_id = COALESCE($3, external_id),
            url = COALESCE($4, url),
            error = $5,
            updated_at = now()
      WHERE id = $1`,
    [id, state, externalId, url, error]
  );
}

/** Одна публикация по номеру: шаг очереди знает только его. */
export async function publicationById(pool, id) {
  const { rows } = await pool.query(
    `SELECT id, platform, asset_id, state, mode, external_id, url, error
       FROM publications WHERE id = $1`,
    [id]
  );
  if (!rows.length) return null;
  return {
    id: Number(rows[0].id),
    platform: rows[0].platform,
    assetId: rows[0].asset_id === null ? null : Number(rows[0].asset_id),
    state: rows[0].state,
    mode: rows[0].mode,
    externalId: rows[0].external_id,
    url: rows[0].url,
    error: rows[0].error
  };
}

/** Публикации урока — для кабинета и для карточки. */
export async function publicationsFor(pool, lessonId) {
  const { rows } = await pool.query(
    `SELECT id, platform, asset_id, state, mode, external_id, url, error
       FROM publications WHERE lesson_id = $1 ORDER BY platform, id`,
    [lessonId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    platform: row.platform,
    assetId: row.asset_id === null ? null : Number(row.asset_id),
    state: row.state,
    mode: row.mode,
    externalId: row.external_id,
    url: row.url,
    error: row.error
  }));
}
