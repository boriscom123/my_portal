// Обложка урока, нарисованная моделью.
//
// Задача — получить картинку для карточки урока и превью на площадках, когда
// кадр из записи не годится. Кадр берётся с десятой части урока и часто
// показывает экран редактора: для превью это скучно, а для площадок коротких
// видео ещё и нечитаемо.
//
// Слой устроен как соседний слой текстов: без ключа его нет, список моделей
// перебирается до первой ответившей, а при отказе вызывающий остаётся с кадром
// из записи. Обложка у урока в любом случае есть.
// Вызывается из src/jobs/make-cover-image.js.
import { hideKey, shouldTryNext, parseModels } from './texts.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Рисование идёт дольше текста, и ждёт его воркер, а не запрос через nginx.
const TIMEOUT_MS = 180_000;

/**
 * Что просим нарисовать.
 *
 * Надписи запрещены прямым текстом: модели рисуют буквы с ошибками, а
 * кириллицу — особенно, и обложка с исковерканным словом хуже, чем без слов.
 * Название урока на превью всё равно рисует площадка поверх картинки.
 */
export function buildCoverPrompt({ title, description = '', tags = [] }) {
  const topic = [title, description].filter(Boolean).join('. ');
  return `Нарисуй обложку для видеоурока по разработке.

Тема урока: ${topic}
Ключевые слова: ${tags.join(', ')}

Требования:
— Никаких надписей, букв, цифр и логотипов на изображении. Совсем.
— Тёмный фон, глубокие синие и фиолетовые тона, один тёплый оранжевый акцент.
— Одна ясная метафора темы, а не набор иконок. Композиция простая: превью
  смотрят размером с ноготь.
— Без людей и без лиц.
— Плоская векторная графика, чистые формы, лёгкое свечение.`;
}

/**
 * Достаёт картинку из ответа.
 * Модель отвечает несколькими частями и может вернуть пояснение текстом вместо
 * картинки — тогда это отказ, а не картинка: разбирать надо явно.
 */
export function parseImageResponse(body) {
  const parts = body?.candidates?.[0]?.content?.parts ?? [];
  const image = parts.find((part) => part?.inlineData?.data);
  if (!image) {
    const text = parts.find((part) => part?.text)?.text;
    throw new Error(text ? `модель ответила текстом: ${text.slice(0, 120)}` : 'модель не вернула картинку');
  }
  return {
    bytes: Buffer.from(image.inlineData.data, 'base64'),
    mimeType: image.inlineData.mimeType ?? 'image/png'
  };
}

/** Расширение файла по типу из ответа: png и jpeg модели отдают вперемешку. */
export function extensionFor(mimeType) {
  return String(mimeType).includes('jpeg') ? 'jpg' : 'png';
}

export function createImages(config, fetchImpl = fetch) {
  const { apiKey, imageModel } = config.gemini ?? {};
  const models = parseModels(imageModel);
  if (!apiKey || !models.length) return null;

  return {
    async generate(prompt) {
      let lastError = null;

      for (const name of models) {
        const response = await fetchImpl(`${API_BASE}/${name}:generateContent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Ключ заголовком, а не в адресе: адреса попадают в журналы
            // посредников целиком.
            'x-goog-api-key': apiKey
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            // Соотношение сторон просим явно: обложка идёт в карточку урока и
            // в превью ссылки, а квадрат там обрезается по краям.
            generationConfig: { imageConfig: { aspectRatio: '16:9' } }
          })
        });

        if (response.ok) return { ...parseImageResponse(await response.json()), model: name };

        const body = await response.text().catch(() => '');
        lastError = new Error(
          `${name} ответила ${response.status}: ${hideKey(body, apiKey).slice(0, 160)}`
        );
        if (!shouldTryNext(response.status)) throw lastError;
      }

      throw lastError ?? new Error('ни одна модель не ответила');
    }
  };
}
