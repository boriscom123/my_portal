// Борд идей: предложить, проголосовать, сменить статус.
//
// Задача — вести список тем для будущих уроков и знать, кого касается каждое
// изменение. Зачем setIdeaStatus возвращает проголосовавших: уведомление о
// смене статуса — обещание, данное людям в спеке, и список адресатов известен
// только здесь; собирать его отдельным запросом в маршруте значит однажды
// поменять статус и забыть уведомить.
// Вызывается из src/routes/ideas.js и src/routes/pages.js.
import { PublicError } from '../middleware/errors.js';

// Порядок соответствует пути идеи от предложения до вышедшего урока.
const STATUSES = ['new', 'accepted', 'in_progress', 'released'];

const MAX_TITLE = 200;

function toIdea(row) {
  return {
    id: Number(row.id),
    title: row.title,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
    votes: Number(row.votes ?? 0),
    votedByViewer: Boolean(row.voted_by_viewer),
    lessonSlug: row.lesson_slug ?? null,
    author: row.display_name ? { id: Number(row.author_id), displayName: row.display_name } : null
  };
}

/** Принимает идею от вошедшего человека. */
export async function createIdea(pool, { userId, title, body }) {
  const theme = String(title ?? '').trim();
  if (!theme) throw new PublicError('У идеи должна быть тема');
  if (theme.length > MAX_TITLE) throw new PublicError('Тема слишком длинная');

  const { rows } = await pool.query(
    `INSERT INTO ideas (author_id, title, body) VALUES ($1, $2, COALESCE($3, ''))
     RETURNING id, title, body, status, created_at, author_id`,
    [userId, theme, String(body ?? '').trim()]
  );
  return toIdea({ ...rows[0], display_name: null });
}

/** Борд целиком: желанные сверху, при равенстве голосов — свежие. */
export async function listIdeas(pool, { status = null, viewerId = null } = {}) {
  const { rows } = await pool.query(
    `SELECT i.id, i.title, i.body, i.status, i.created_at, i.author_id,
            u.display_name, l.slug AS lesson_slug,
            count(v.user_id)::int AS votes,
            COALESCE(bool_or(v.user_id = $2::bigint), false) AS voted_by_viewer
       FROM ideas i
       JOIN users u ON u.id = i.author_id
       LEFT JOIN lessons l ON l.id = i.lesson_id
       LEFT JOIN idea_votes v ON v.idea_id = i.id
      WHERE ($1::text IS NULL OR i.status = $1)
      GROUP BY i.id, u.display_name, l.slug
      ORDER BY count(v.user_id) DESC, i.created_at DESC`,
    [status, viewerId]
  );
  return rows.map(toIdea);
}

/** Голос за идею. Повтор безвреден: пара уже есть, вставка ничего не меняет. */
export async function voteIdea(pool, { ideaId, userId }) {
  await pool.query(
    'INSERT INTO idea_votes (idea_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [ideaId, userId]
  );
}

/** Отзыв голоса. */
export async function unvoteIdea(pool, { ideaId, userId }) {
  await pool.query('DELETE FROM idea_votes WHERE idea_id = $1 AND user_id = $2', [ideaId, userId]);
}

/**
 * Меняет статус идеи и говорит, кого об этом надо уведомить.
 * lessonSlug задаётся вместе со статусом released — идея закрывается ссылкой
 * на вышедший урок.
 */
export async function setIdeaStatus(pool, { ideaId, status, lessonSlug = null }) {
  if (!STATUSES.includes(status)) throw new PublicError('Неизвестный статус идеи');

  const { rows } = await pool.query(
    `UPDATE ideas
        SET status = $2,
            lesson_id = COALESCE((SELECT id FROM lessons WHERE slug = $3), lesson_id)
      WHERE id = $1
      RETURNING id, title, body, status, created_at, author_id`,
    [ideaId, status, lessonSlug]
  );
  if (!rows.length) throw new PublicError('Идея не найдена', 404);

  const { rows: votes } = await pool.query(
    'SELECT user_id FROM idea_votes WHERE idea_id = $1 ORDER BY user_id',
    [ideaId]
  );

  return {
    idea: toIdea({ ...rows[0], display_name: null, lesson_slug: lessonSlug }),
    voterIds: votes.map((row) => Number(row.user_id))
  };
}
