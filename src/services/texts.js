// Тексты урока от модели: заголовок, описание, теги.
//
// Задача — сделать из расшифровки заготовку, которую автору остаётся поправить,
// а не переписать. Извлечение по частотности, которое здесь было раньше, даёт
// заголовок вроде «Мы создали приложение, которое собирает форма обратной
// связи…» — то есть первую фразу урока, а не его тему.
//
// Модель внешняя (Gemini), и это отступление от прежнего решения «без облака».
// Оно касалось расшифровки: та гонит на сторону час звука с каждого урока и
// стоит денег. Здесь на сторону уходит уже готовый текст расшифровки — тот же,
// что через час будет лежать в открытом доступе на площадке, — и бесплатной
// доли хватает на десятки уроков в день.
//
// Слой тонкий намеренно: без ключа он отсутствует, при отказе бросает, и в
// обоих случаях вызывающий откатывается на извлечение из src/lib/summary.js.
// Портал обязан работать без модели.
// Вызывается из src/routes/admin.js.

import { parseTimecode } from '../lib/chapters.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Сколько расшифровки отдаём модели. Часовой урок — это тысяч двадцать знаков,
// они помещаются целиком; предел стоит от урока, который окажется вчетверо
// длиннее, чтобы запрос не разрастался без предупреждения.
const TRANSCRIPT_LIMIT = 60_000;

// Сколько ждём ответ одной модели.
//
// Три минуты, а не «разумные тридцать секунд»: на бесплатной доле измеренный
// ответ занял семьдесят две секунды, и таймаут в минуту рубил живую модель на
// полпути. Ждать столько может воркер, но не запрос через nginx — потому шаг и
// вынесен в очередь.
const TIMEOUT_MS = 180_000;

/**
 * Что просим у модели.
 * Требования к длине здесь не украшение: заголовок длиннее строки площадка
 * обрежет сама, и обрежет в неудачном месте.
 */
export function buildPrompt(transcript, timeline = '') {
  const text = String(transcript).slice(0, TRANSCRIPT_LIMIT);
  return `Ты помогаешь автору видеоуроков по разработке. Ниже расшифровка урока,
сделанная распознаванием речи: в ней есть ошибки в терминах и именах.

Составь по ней:
1. title — заголовок урока, до 70 знаков, по-русски, без кавычек и точки в
   конце. Он должен называть тему урока, а не повторять первую фразу.
2. description — описание, 2–4 предложения, до 400 знаков, по-русски. О чём
   урок и что зритель после него сможет сделать.
3. tags — от четырёх до восьми тегов, по-русски или латиницей, строчными
   буквами, без решётки. Названия технологий оставляй как есть: docker, nginx.${
     timeline
       ? `
4. chapters — главы урока: от трёх до восьми. Каждая — объект с полями at
   (время начала в виде 0:00, 5:30 или 1:05:30) и title (название до 50 знаков,
   по-русски, без точки в конце). ПЕРВАЯ глава обязана начинаться с 0:00.
   Между соседними главами не меньше минуты. Главу ставь туда, где меняется
   тема, а не там, где автор сделал паузу.`
       : ''
   }

Пиши как автор о своей работе: без рекламных оборотов, без «в этом видео мы
рассмотрим», без восклицательных знаков.

${
    timeline
      ? `Реплики с временами — по ним определяй, где начинается глава:
${timeline}

`
      : ''
  }Расшифровка:
${text}`;
}

/**
 * Запрос на текст новости.
 *
 * Новость — не урок: у неё нет расшифровки, и всё, что есть, — заголовок,
 * который написал автор. Поэтому просим короткий текст по существу и прямо
 * запрещаем выдумывать подробности: модель, которой не хватило материала,
 * охотно дописывает то, чего не было.
 */
export function buildNewsPrompt(title) {
  return `Ты помогаешь автору портала видеоуроков по разработке писать короткие
новости. Заголовок новости: «${String(title).trim()}».

Напиши текст этой новости: 2–4 предложения, до 500 знаков, по-русски.

Правила:
— пиши только то, что следует из заголовка; не выдумывай дат, чисел, названий и
  обещаний, которых в нём нет;
— без рекламных оборотов, без «мы рады сообщить», без восклицательных знаков;
— это заметка автора о своей работе, а не пресс-релиз;
— если из заголовка непонятно, о чём речь, напиши одно нейтральное предложение,
  которое автор допишет сам.

Верни JSON с единственным полем body.`;
}

/** Достаёт текст новости из ответа модели. */
export function parseNewsResponse(body) {
  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('модель вернула пустой ответ');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('модель вернула не JSON');
  }
  const news = String(parsed.body ?? '').trim();
  if (!news) throw new Error('модель не написала текст');
  return news;
}

/**
 * Разбирает ответ модели.
 * Вынесено отдельно ради проверки без сети: форма ответа у моделей меняется
 * чаще, чем всё остальное в этом файле.
 */
export function parseTextsResponse(body) {
  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('модель вернула пустой ответ');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('модель вернула не JSON');
  }

  const tags = Array.isArray(parsed.tags) ? parsed.tags : [];
  const chapters = Array.isArray(parsed.chapters) ? parsed.chapters : [];
  return {
    title: String(parsed.title ?? '').trim(),
    description: String(parsed.description ?? '').trim(),
    // Решётку и регистр приводим сами: модель ставит их через раз, а теги
    // уходят в адреса вида /tag/docker.
    tags: tags
      .map((tag) => String(tag).trim().toLowerCase().replace(/^#/, ''))
      .filter(Boolean)
      .slice(0, 8),
    // Время приводим к миллисекундам сразу: дальше по порталу время везде в
    // них, и «5:30» в одном месте однажды сравнят с числом в другом.
    chapters: chapters
      .map((chapter) => ({
        atMs: parseTimecode(chapter?.at ?? chapter?.atMs),
        title: String(chapter?.title ?? '').trim()
      }))
      .filter((chapter) => Number.isFinite(chapter.atMs) && chapter.title)
      .slice(0, 8)
  };
}

/**
 * Достаёт человеческую часть из отказа поставщика.
 *
 * Google отвечает JSON-ом на полтора экрана, а на экран автору нужно одно
 * предложение. Сырой ответ попадал в кабинет целиком — вместе с фигурными
 * скобками и ссылкой на документацию по биллингу.
 */
export function readErrorMessage(body) {
  try {
    const parsed = JSON.parse(body);
    const message = parsed?.error?.message;
    if (message) return String(message).split('. ')[0].trim();
  } catch {
    // Не JSON — отдаём как пришло, обрезав.
  }
  return String(body).replace(/\s+/g, ' ').trim();
}

/**
 * Вычищает ключ из чужого ответа.
 * Поставщик кладёт ключ в текст отказа («quota exceeded for key …»), а этот
 * текст уходит и в журнал контейнера, и на экран автору. Правило проекта:
 * сообщения об ошибках токенов не содержат.
 */
export function hideKey(text, apiKey) {
  if (!apiKey) return String(text);
  return String(text).split(apiKey).join('…ключ…');
}

/**
 * Собирает слой текстов или возвращает null.
 * null — не ошибка: портал работает без модели, и кнопка заполнения тогда
 * берёт заготовку из расшифровки своими силами.
 */
/**
 * Стоит ли пробовать следующую модель из списка.
 *
 * 503 — «сейчас высокий спрос»: на бесплатной доле в него упираются разом все
 * ходовые модели, проверено. 404 — модель перестали выдавать новым ключам, на
 * этом уже споткнулись. 429 — кончилась квота на минуту. Всё это про КОНКРЕТНУЮ
 * модель, а не про запрос, и следующая в списке обычно отвечает.
 */
export function shouldTryNext(status) {
  return [404, 429, 503].includes(status);
}

/** Разбирает список моделей из настройки: через запятую, в порядке предпочтения. */
export function parseModels(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function createTexts(config, fetchImpl = fetch) {
  const { apiKey, model } = config.gemini ?? {};
  const models = parseModels(model);
  if (!apiKey || !models.length) return null;

  /**
   * Спрашивает модели по очереди, пока одна не ответит.
   *
   * Схема ответа задаётся вызывающим и обязана перечислять ВСЕ ожидаемые поля:
   * то, чего в ней нет, модель не вернёт. Главы однажды уже не приходили
   * именно поэтому — в запросе их просили словами, а схема их не допускала.
   */
  async function ask(prompt, schema) {
    let lastError = null;

    for (const name of models) {
      const response = await fetchImpl(`${API_BASE}/${name}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Ключ заголовком, а не в адресе: адреса попадают в журналы
          // посредников целиком, а заголовки — нет.
          'x-goog-api-key': apiKey
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            // Просим сразу JSON: разбирать текст с пояснениями вокруг —
            // источник тихих поломок при смене модели.
            responseMimeType: 'application/json',
            responseSchema: schema
          }
        })
      });

      if (response.ok) return { body: await response.json(), model: name };

      const text = await response.text().catch(() => '');
      lastError = new Error(
        `${name} ответила ${response.status}: ` +
          `${readErrorMessage(hideKey(text, apiKey)).slice(0, 200)}`
      );
      // Отказ не про эту модель, а про сам запрос — следующая ответит тем же.
      if (!shouldTryNext(response.status)) throw lastError;
    }

    throw lastError ?? new Error('ни одна модель не ответила');
  }

  return {
    async suggest(transcript, timeline = '') {
      const schema = {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          ...(timeline
            ? {
                chapters: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { at: { type: 'string' }, title: { type: 'string' } },
                    required: ['at', 'title']
                  }
                }
              }
            : {})
        },
        required: timeline ? ['title', 'description', 'tags', 'chapters'] : ['title', 'description', 'tags']
      };

      const { body, model: name } = await ask(buildPrompt(transcript, timeline), schema);
      return { ...parseTextsResponse(body), model: name };
    },

    /**
     * Пишет текст новости по её заголовку.
     * Отдельным запросом, а не тем же: у новости нет ни расшифровки, ни тегов,
     * и просить у модели поля, которых не будет, — верный способ получить
     * выдуманное.
     */
    async suggestNews(title) {
      const { body, model: name } = await ask(buildNewsPrompt(title), {
        type: 'object',
        properties: { body: { type: 'string' } },
        required: ['body']
      });
      return { body: parseNewsResponse(body), model: name };
    }
  };
}
