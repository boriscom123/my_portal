// Заведение и удаление уроков.
//
// Задача — то, что раньше делалось руками в базе: создать урок по заголовку и
// убрать урок вместе со всем, что за ним тянется. Зачем отдельно от
// services/lessons.js: там чтение и правка витрины, а здесь распоряжение самим
// существованием урока — действие, которое нельзя отменить.
// Вызывается из src/routes/admin.js.
import { rm } from 'node:fs/promises';
import { slugify, uniqueSlug } from '../lib/slug.js';
import { mediaPath } from './media.js';

/**
 * Заводит урок по заголовку.
 * Адрес собирается из заголовка и делается уникальным: два урока с одним
 * адресом невозможны на уровне базы, и падать на этом при похожих заголовках
 * незачем.
 */
export async function createLesson(pool, { title, description = '' }) {
  const clean = String(title ?? '').trim();
  if (!clean) throw new Error('у урока должен быть заголовок');

  const { rows: taken } = await pool.query('SELECT slug FROM lessons');
  // Из заголовка вроде «!!! ???» адреса не выйдет — тогда собираем от даты:
  // урок без адреса не открыть.
  const base = slugify(clean) || `urok-${new Date().toISOString().slice(0, 10)}`;
  const slug = uniqueSlug(base, taken.map((row) => row.slug));

  const { rows } = await pool.query(
    `INSERT INTO lessons (slug, title, description, status)
     VALUES ($1, $2, $3, 'draft') RETURNING id, slug, title`,
    [slug, clean, String(description ?? '')]
  );
  return { id: Number(rows[0].id), slug: rows[0].slug, title: rows[0].title };
}

/**
 * Убирает урок целиком: записи в базе и файлы в буфере.
 *
 * Файлы удаляются первыми и по списку из учёта, а не сносом каталога: путь к
 * каталогу собирается из номера урока, и ошибка в нём означала бы удаление
 * чужих файлов. Каталог убирается следом, уже пустой.
 *
 * Записи о самом уроке уходят каскадом — так заведены внешние ключи: файлы,
 * расшифровка, отрезки, публикации, реакции и отзывы исчезают вместе с ним.
 */
export async function deleteLesson(config, pool, lessonId) {
  const { rows: assets } = await pool.query('SELECT path FROM assets WHERE lesson_id = $1', [
    lessonId
  ]);

  for (const asset of assets) {
    // force: true — файла может уже не быть: уборка по сроку прошла раньше.
    await rm(mediaPath(config, asset.path), { force: true }).catch((error) =>
      console.error(`Не удалось удалить ${asset.path}: ${error.message}`)
    );
  }

  // Каталог урока: в нём могли остаться рабочие файлы, не попавшие в учёт.
  await rm(mediaPath(config, `lesson-${lessonId}`), { recursive: true, force: true }).catch(
    (error) => console.error(`Не удалось убрать каталог урока: ${error.message}`)
  );

  const { rowCount } = await pool.query('DELETE FROM lessons WHERE id = $1', [lessonId]);
  return { deleted: rowCount > 0, files: assets.length };
}
