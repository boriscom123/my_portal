// Шаг конвейера: обложка, нарисованная моделью.
//
// Задача — заменить кадр из записи нарисованной картинкой, когда автор этого
// захотел. Зачем очередью: запрос для рисования и само рисование вместе могут
// идти дольше минуты, а запрос через nginx рвётся на шестидесяти секундах.
//
// Английский запрос для FLUX составляет текстовая модель; без неё или при её
// отказе — шаблон. Рисование от текстовой модели не зависит. Запрос,
// поправленный автором на странице урока, идёт как есть, без Gemini.
// Кадр из записи при этом остаётся в буфере: если нарисованная не понравится,
// автор вернёт кадр одним нажатием, а не перезапуском обработки.
// Вызывается воркером по имени JOBS.makeCoverImage.
import { writeFile, stat, mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { coverPromptTemplate, stripNegations } from '../services/images.js';
import { mediaPath, registerAsset, forgetAsset } from '../services/media.js';
import { finishDrawing } from '../services/cover-drawing.js';

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
  return async ({ lessonId, prompt: authorPrompt = '' }) => {
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
    const { prompt: rawPrompt, source } = authorPrompt
      ? { prompt: authorPrompt, source: 'author' }
      : await coverPrompt(texts, lesson);
    // Отрицания уходят из запроса Gemini и шаблона: модель рисования «no» не
    // понимает и рисует ровно то, что запрещено. Запрос автора — как есть.
    const prompt = source === 'author' ? rawPrompt : stripNegations(rawPrompt);
    const { bytes, type, model } = await images.generate(prompt);

    const dir = `lesson-${lessonId}`;
    await mkdir(mediaPath(config, dir), { recursive: true });
    // Имя своё у каждой картинки: адрес обложки браузер держит сутки, и с
    // постоянным именем автор видел старую картинку, пока не удалял её руками.
    // Случайный хвост, а не время: две перерисовки в одну миллисекунду иначе
    // легли бы в один файл.
    const relative = `${dir}/cover-drawn-${randomUUID().slice(0, 8)}.${type}`;
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

    // Прежние нарисованные уходят и с диска, и из учёта: в буфере живёт одна,
    // иначе картинки копились бы до истечения срока.
    const { rows: previous } = await pool.query(
      `SELECT id, path FROM assets
        WHERE lesson_id = $1 AND kind = 'cover' AND path LIKE $2 AND id <> $3`,
      [lessonId, `${dir}/cover-drawn%`, asset.id]
    );
    for (const old of previous) {
      await rm(mediaPath(config, old.path), { force: true });
      await forgetAsset(pool, Number(old.id));
    }

    // Запрос запоминается: при плохой картинке автор видит, по чему рисовали,
    // и правит его, а не гадает.
    await finishDrawing(pool, lessonId, { text: prompt, source });

    return { assetId: asset.id, bytes: size, model, promptSource: source };
  };
}
