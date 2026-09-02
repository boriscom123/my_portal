// Реакции и комментарии.
//
// Задача — правила обратной связи в одном месте: одна реакция на человека,
// комментарий приходит скрытым, скрытое видит только автор и админ. Зачем
// сервисом, а не в маршрутах: те же правила понадобятся борду идей на этапе 4
// и сводной ленте отзывов на этапе 9.
// Вызывается из src/routes/feedback.js и src/routes/pages.js.
import { PublicError } from '../middleware/errors.js';

// Длина комментария. Верхняя граница защищает страницу от простыни на экран,
// нижняя отсекает пустые нажатия.
const МАКС_ДЛИНА = 4000;

/** Ставит или меняет реакцию. Повтор той же реакции ничего не меняет. */
export async function setReaction(pool, { userId, objectType, objectId, kind }) {
  await pool.query(
    `INSERT INTO reactions (user_id, object_type, object_id, kind)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, object_type, object_id) DO UPDATE SET kind = EXCLUDED.kind`,
    [userId, objectType, objectId, kind]
  );
}

/** Снимает реакцию. Повторный вызов безвреден. */
export async function removeReaction(pool, { userId, objectType, objectId }) {
  await pool.query(
    'DELETE FROM reactions WHERE user_id = $1 AND object_type = $2 AND object_id = $3',
    [userId, objectType, objectId]
  );
}

/** Счётчики по видам реакций. Пустой объект, если реакций нет. */
export async function countReactions(pool, { objectType, objectId }) {
  const { rows } = await pool.query(
    `SELECT kind, count(*)::int AS n FROM reactions
      WHERE object_type = $1 AND object_id = $2 GROUP BY kind`,
    [objectType, objectId]
  );
  return Object.fromEntries(rows.map((r) => [r.kind, r.n]));
}

/**
 * Какую реакцию поставил этот человек. null — никакой.
 * Зачем отдельно от счётчиков: кнопка должна показывать, что она уже нажата,
 * иначе человек жмёт её второй раз и не понимает, почему счётчик не растёт.
 * Вызывается из src/routes/pages.js при отрисовке карточки урока.
 */
export async function getViewerReaction(pool, { objectType, objectId, userId }) {
  if (!userId) return null;
  const { rows } = await pool.query(
    'SELECT kind FROM reactions WHERE user_id = $1 AND object_type = $2 AND object_id = $3',
    [userId, objectType, objectId]
  );
  return rows.length ? rows[0].kind : null;
}

/** Принимает комментарий. Он появляется скрытым и ждёт модерации. */
export async function addComment(pool, { userId, objectType, objectId, parentId = null, body }) {
  const текст = String(body ?? '').trim();
  if (!текст) throw new PublicError('Комментарий пуст');
  if (текст.length > МАКС_ДЛИНА) throw new PublicError('Комментарий слишком длинный');

  const { rows } = await pool.query(
    `INSERT INTO comments (user_id, object_type, object_id, parent_id, body)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, user_id, parent_id, body, status, created_at`,
    [userId, objectType, objectId, parentId, текст]
  );
  const row = rows[0];
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    parentId: row.parent_id ? Number(row.parent_id) : null,
    body: row.body,
    status: row.status,
    createdAt: row.created_at
  };
}

/**
 * Комментарии объекта. Гость и посторонний видят только одобренные, автор —
 * ещё и свои ожидающие, админ — все: иначе ему нечего модерировать.
 */
export async function listComments(
  pool,
  { objectType, objectId, viewerId = null, isAdmin = false }
) {
  const { rows } = await pool.query(
    `SELECT c.id, c.parent_id, c.body, c.status, c.created_at,
            u.id AS author_id, u.display_name, u.avatar_url
       FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.object_type = $1 AND c.object_id = $2
        AND (c.status = 'approved' OR $3::boolean OR c.user_id = $4::bigint)
      ORDER BY c.created_at`,
    [objectType, objectId, isAdmin, viewerId]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    parentId: r.parent_id ? Number(r.parent_id) : null,
    body: r.body,
    status: r.status,
    createdAt: r.created_at,
    author: { id: Number(r.author_id), displayName: r.display_name, avatarUrl: r.avatar_url }
  }));
}

/** Решение модератора. Вызывается только из-под requireAdmin. */
export async function moderateComment(pool, { commentId, status }) {
  if (!['approved', 'rejected'].includes(status)) throw new PublicError('Неизвестное решение');
  const { rowCount } = await pool.query('UPDATE comments SET status = $1 WHERE id = $2', [
    status,
    commentId
  ]);
  if (!rowCount) throw new PublicError('Комментарий не найден', 404);
}
