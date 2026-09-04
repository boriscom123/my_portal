// Шаг конвейера: обложка, нарисованная моделью.
//
// Задача — заменить кадр из записи нарисованной картинкой, когда автор этого
// захотел. Зачем очередью: рисование идёт минуту с лишним, а запрос через
// nginx рвётся на шестидесяти секундах — на том же и споткнулись тексты.
//
// Кадр из записи при этом остаётся в буфере: если нарисованная не понравится,
// автор вернёт кадр одним нажатием, а не перезапуском обработки.
// Вызывается воркером по имени JOBS.makeCoverImage.
import { writeFile, stat, mkdir } from 'node:fs/promises';
import { buildCoverPrompt, extensionFor } from '../services/images.js';
import { mediaPath, registerAsset } from '../services/media.js';

export function makeMakeCoverImage(config, pool, images) {
  return async ({ lessonId }) => {
    if (!images) throw new Error('рисование не настроено: нет ключа или списка моделей');

    const { rows } = await pool.query(
      `SELECT l.title, l.description,
              COALESCE(array_agg(t.slug) FILTER (WHERE t.slug IS NOT NULL), '{}') AS tags
         FROM lessons l
         LEFT JOIN lesson_tags lt ON lt.lesson_id = l.id
         LEFT JOIN tags t ON t.id = lt.tag_id
        WHERE l.id = $1 GROUP BY l.id`,
      [lessonId]
    );
    if (!rows.length) throw new Error('урок не найден');
    if (!rows[0].title) throw new Error('у урока нет заголовка — рисовать не по чему');

    const { bytes, mimeType, model } = await images.generate(
      buildCoverPrompt({
        title: rows[0].title,
        description: rows[0].description,
        tags: rows[0].tags
      })
    );

    const dir = `lesson-${lessonId}`;
    await mkdir(mediaPath(config, dir), { recursive: true });
    // Имя постоянное: повторное рисование заменяет прошлую картинку, а не
    // копит их в буфере до истечения срока.
    const relative = `${dir}/cover-drawn.${extensionFor(mimeType)}`;
    await writeFile(mediaPath(config, relative), bytes);

    const { size } = await stat(mediaPath(config, relative));
    const asset = await registerAsset(pool, config, {
      lessonId,
      kind: 'cover',
      relativePath: relative,
      bytes: size
    });

    await pool.query('UPDATE lessons SET cover_url = $1 WHERE id = $2', [
      `/media/asset/${asset.id}`,
      lessonId
    ]);

    return { assetId: asset.id, bytes: size, model };
  };
}
