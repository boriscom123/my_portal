// Учёт файлов рабочего буфера.
//
// Задача — знать, какой файл к какому уроку относится и когда его удалять.
// Зачем отдельным сервисом: срок жизни считается в одном месте, иначе
// исходники начнут переживать нарезки, а диск на 34 ГБ переполнится за
// десяток уроков и положит все проекты сервера.
// Вызывается из src/routes/upload.js и задач в src/jobs/.
import path from 'node:path';
import { PublicError } from '../middleware/errors.js';

/**
 * Сколько живёт файл каждого вида, в долях от MEDIA_TTL_HOURS.
 * Исходник и нарезки весят гигабайты — уходят первыми. Субтитры и обложка
 * лёгкие и нужны карточке урока долго после публикации, поэтому живут на
 * порядок дольше.
 */
// Во сколько раз файл живёт дольше срока буфера. Обложки здесь нет намеренно:
// у неё срока нет вовсе — см. KEPT_KINDS.
const TTL_SHARE = { source: 1, audio: 0.5, clip: 1, subtitles: 10 };

// Виды файлов, которые живут, пока на них ссылаются. Это то, что видит
// зритель: удалить их по сроку — значит показать битую картинку на витрине.
const KEPT_KINDS = new Set(['cover', 'image']);

/**
 * Абсолютный путь к файлу буфера.
 * Проверка на выход за пределы обязательна: имя файла приходит из запроса, и
 * без неё «../../» увело бы запись в любое место диска.
 */
export function mediaPath(config, relative) {
  const root = path.resolve(config.media.dir);
  const full = path.resolve(root, relative);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new PublicError('Путь ведёт за пределы буфера', 400);
  }
  return full;
}

/** Записывает файл в учёт и назначает ему срок. */
export async function registerAsset(
  pool,
  config,
  { lessonId = null, newsId = null, kind, relativePath, bytes, position = 0 }
) {
  // Пустой срок — «храним, пока используется». Уборщик такие файлы не трогает
  // по времени и удаляет только когда на них перестали ссылаться.
  const hours = KEPT_KINDS.has(kind) ? null : config.media.ttlHours * (TTL_SHARE[kind] ?? 1);
  // Повтор обработки перезаписывает тот же файл на диске — значит и запись в
  // учёте должна обновиться, а не удвоиться. Иначе уборка удаляла бы один
  // файл дважды, а размер буфера считался вдвое больше настоящего.
  const { rows } = await pool.query(
    `INSERT INTO assets (lesson_id, news_id, kind, path, bytes, position, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6,
             CASE WHEN $7::text IS NULL THEN NULL ELSE now() + ($7 || ' hours')::interval END)
     ON CONFLICT (lesson_id, path) DO UPDATE SET kind = EXCLUDED.kind,
                                                 bytes = EXCLUDED.bytes,
                                                 position = EXCLUDED.position,
                                                 expires_at = EXCLUDED.expires_at
     RETURNING id, path, expires_at`,
    [
      lessonId,
      newsId,
      kind,
      relativePath,
      bytes,
      position,
      hours === null ? null : String(hours)
    ]
  );
  return { id: Number(rows[0].id), path: rows[0].path, expiresAt: rows[0].expires_at };
}

/** Файлы, пережившие свой срок. Их удаляет задача cleanupMedia. */
export async function listExpired(pool) {
  const { rows } = await pool.query(
    'SELECT id, lesson_id, kind, path, bytes FROM assets WHERE expires_at < now() ORDER BY id'
  );
  return rows.map((row) => ({
    id: Number(row.id),
    lessonId: Number(row.lesson_id),
    kind: row.kind,
    path: row.path,
    bytes: Number(row.bytes)
  }));
}

/** Убирает файл из учёта. Сам файл удаляет вызывающий. */
export async function forgetAsset(pool, id) {
  await pool.query('DELETE FROM assets WHERE id = $1', [id]);
}

/** Один файл по номеру. null, если его уже нет. */
/**
 * Все файлы урока. Шагам нужен выбор, а не один известный заранее: выкладка
 * сама решает, монтаж уезжает или исходник, и какие субтитры к нему в пару.
 * Вызывается из src/jobs/publish-youtube.js и src/routes/admin.js.
 */
export async function assetsOfLesson(pool, lessonId) {
  const { rows } = await pool.query(
    'SELECT id, kind, path, bytes FROM assets WHERE lesson_id = $1 ORDER BY id',
    [lessonId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    kind: row.kind,
    path: row.path,
    bytes: Number(row.bytes)
  }));
}

/**
 * Картинки новости в порядке, заданном автором.
 * Первая — та, что уедет в канал: пост берёт одну, а какую именно, решает не
 * случай, а порядок на странице новости.
 * Вызывается из src/jobs/publish-channel.js.
 */
export async function assetsOfNews(pool, newsId) {
  const { rows } = await pool.query(
    `SELECT id, kind, path, bytes FROM assets
      WHERE news_id = $1 AND kind = 'image' ORDER BY position, id`,
    [newsId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    kind: row.kind,
    path: row.path,
    bytes: Number(row.bytes)
  }));
}

export async function assetById(pool, id) {
  const { rows } = await pool.query(
    'SELECT id, lesson_id, kind, path, bytes, expires_at FROM assets WHERE id = $1',
    [id]
  );
  if (!rows.length) return null;
  return {
    id: Number(rows[0].id),
    lessonId: Number(rows[0].lesson_id),
    kind: rows[0].kind,
    path: rows[0].path,
    bytes: Number(rows[0].bytes),
    expiresAt: rows[0].expires_at
  };
}
