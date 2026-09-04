// Поиск по расшифровкам уроков.
//
// Задача — найти слово внутри урока и сказать, на какой он секунде. Ради
// этого расшифровка и хранится отрезками, а не сплошным текстом: найти урок
// целиком мало, зрителю нужно место.
// Вызывается из src/routes/search.js и src/routes/pages.js.

// Сколько находок показываем. Больше двадцати человек не читает, а запрос по
// всем урокам с подсветкой стоит тем дороже, чем шире выборка.
const DEFAULT_LIMIT = 20;

/**
 * Ищет отрезки по словам.
 * Черновики не ищутся: их не видно и в витрине, а через поиск они утекли бы
 * невышедшим уроком к любому, кто угадает слово.
 */
export async function searchSegments(pool, query, limit = DEFAULT_LIMIT) {
  const text = String(query ?? '').trim();
  if (!text) return [];

  const { rows } = await pool.query(
    `SELECT l.slug, l.title, s.started_ms,
            ts_headline('russian', s.text, plainto_tsquery('russian', $1),
                        'StartSel=<mark>, StopSel=</mark>, MaxWords=25, MinWords=10') AS excerpt
       FROM transcript_segments s
       JOIN lessons l ON l.id = s.lesson_id
      WHERE l.status = 'published'
        AND to_tsvector('russian', s.text) @@ plainto_tsquery('russian', $1)
      ORDER BY ts_rank(to_tsvector('russian', s.text), plainto_tsquery('russian', $1)) DESC,
               s.started_ms
      LIMIT $2`,
    [text, limit]
  );

  return rows.map((row) => ({
    lessonSlug: row.slug,
    lessonTitle: row.title,
    startedMs: Number(row.started_ms),
    // Подсветку собрал postgres из нашего же текста — она приходит с тегами
    // <mark> и вставляется как разметка. Слово запроса в неё не попадает: оно
    // проходит через plainto_tsquery.
    excerpt: row.excerpt
  }));
}
