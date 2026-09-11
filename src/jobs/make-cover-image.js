// Шаг конвейера: обложка, нарисованная моделью.
//
// Задача — заменить кадр из записи нарисованной картинкой, когда автор этого
// захотел. Зачем очередью: запрос для рисования и само рисование вместе могут
// идти дольше минуты, а запрос через nginx рвётся на шестидесяти секундах.
//
// Английский запрос для FLUX составляет текстовая модель; без неё или при её
// отказе — шаблон. Рисование от текстовой модели не зависит.
// Кадр из записи при этом остаётся в буфере: если нарисованная не понравится,
// автор вернёт кадр одним нажатием, а не перезапуском обработки.
// Вызывается воркером по имени JOBS.makeCoverImage.
import { writeFile, stat, mkdir } from 'node:fs/promises';
import { coverPromptTemplate } from '../services/images.js';
import { mediaPath, registerAsset } from '../services/media.js';

/** Запрос для рисования и откуда он взялся — видно, по чему рисовали. */
async function coverPrompt(texts, lesson) {
  if (texts) {
    try {
      const { prompt } = await texts.suggestCoverPrompt(lesson);
      return { prompt, source: 'gemini' };
    } catch (error) {
      console.error('Запрос для обложки собран шаблоном:', error.message);
    }
  }
  return { prompt: coverPromptTemplate(lesson), source: 'template' };
}

export function makeMakeCoverImage(config, pool, images, texts = null) {
  return async ({ lessonId }) => {
    if (!images || !(await images.isConfigured())) {
      throw new Error('рисование не настроено: добавьте токен Hugging Face в настройках');
    }

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

    const lesson = {
      title: rows[0].title,
      description: rows[0].description ?? '',
      tags: rows[0].tags
    };
    const { prompt, source } = await coverPrompt(texts, lesson);
    const { bytes, type, model } = await images.generate(prompt);

    const dir = `lesson-${lessonId}`;
    await mkdir(mediaPath(config, dir), { recursive: true });
    // Имя постоянное: повторное рисование заменяет прошлую картинку, а не
    // копит их в буфере до истечения срока.
    const relative = `${dir}/cover-drawn.${type}`;
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

    return { assetId: asset.id, bytes: size, model, promptSource: source };
  };
}
