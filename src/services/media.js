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
const TTL_SHARE = { source: 1, audio: 0.5, clip: 1, subtitles: 10, cover: 10 };

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
export async function registerAsset(pool, config, { lessonId, kind, relativePath, bytes }) {
  const hours = config.media.ttlHours * (TTL_SHARE[kind] ?? 1);
  const { rows } = await pool.query(
    `INSERT INTO assets (lesson_id, kind, path, bytes, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' hours')::interval)
     RETURNING id, path, expires_at`,
    [lessonId, kind, relativePath, bytes, String(hours)]
  );
  return { id: Number(rows[0].id), path: rows[0].path, expiresAt: rows[0].expires_at };
}

/** Файлы, пережившие свой срок. Их удаляет задача cleanupMedia. */
export async function listExpired(pool) {
  const { rows } = await pool.query(
    'SELECT id, lesson_id, kind, path FROM assets WHERE expires_at < now() ORDER BY id'
  );
  return rows.map((row) => ({
    id: Number(row.id),
    lessonId: Number(row.lesson_id),
    kind: row.kind,
    path: row.path
  }));
}

/** Убирает файл из учёта. Сам файл удаляет вызывающий. */
export async function forgetAsset(pool, id) {
  await pool.query('DELETE FROM assets WHERE id = $1', [id]);
}

/** Один файл по номеру. null, если его уже нет. */
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
