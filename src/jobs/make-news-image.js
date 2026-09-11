// Шаг очереди: картинка к новости, нарисованная моделью.
//
// Задача — нарисовать картинку и поставить её в ленту новости следующей, как
// будто её загрузил автор. Зачем очередью: рисование идёт до минуты, а запрос
// через nginx рвётся на шестидесяти секундах.
//
// Запрос по-английски. Автор мог поправить его в поле — тогда он идёт как
// есть; иначе его составляет текстовая модель по заголовку и тексту, а без
// неё — шаблон. Отрицания из запроса модели и шаблона уходят: модель рисования
// «no» не понимает и рисует ровно то, что запрещено.
// Вызывается воркером по имени JOBS.makeNewsImage.
import { getNewsById } from '../services/news.js';
import { newsPromptTemplate, stripNegations } from '../services/images.js';
import { attachNewsImage } from '../services/news-images.js';
import { finishDrawing } from '../services/cover-drawing.js';

/** Запрос для рисования и откуда он взялся — видно, по чему рисовали. */
async function newsPrompt(texts, item) {
  if (texts) {
    try {
      const { prompt } = await texts.suggestImagePrompt(item.title, item.body ?? '');
      return { prompt, source: 'gemini' };
    } catch (error) {
      console.error('Запрос для картинки новости собран шаблоном:', error.message);
    }
  }
  return { prompt: newsPromptTemplate(item), source: 'template' };
}

export function makeMakeNewsImage(config, pool, images, texts = null) {
  return async ({ newsId, prompt: authorPrompt = '' }) => {
    if (!images || !(await images.isConfigured())) {
      throw new Error('рисование не настроено: добавьте токен Hugging Face в настройках');
    }
    const item = await getNewsById(pool, newsId);
    if (!item) throw new Error('новость не найдена');

    const { prompt: rawPrompt, source } = authorPrompt
      ? { prompt: authorPrompt, source: 'author' }
      : await newsPrompt(texts, item);
    const prompt = source === 'author' ? rawPrompt : stripNegations(rawPrompt);
    const { bytes, type, model } = await images.generate(prompt);

    const { assetId } = await attachNewsImage(pool, config, newsId, bytes, type);
    // Запрос запоминается: при плохой картинке автор видит, по чему рисовали,
    // и правит его, а не гадает.
    await finishDrawing(pool, newsId, { text: prompt, source }, 'news');
    return { assetId, model, promptSource: source };
  };
}
