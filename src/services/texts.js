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
export function buildPrompt(transcript) {
  const text = String(transcript).slice(0, TRANSCRIPT_LIMIT);
  return `Ты помогаешь автору видеоуроков по разработке. Ниже расшифровка урока,
сделанная распознаванием речи: в ней есть ошибки в терминах и именах.

Составь по ней:
1. title — заголовок урока, до 70 знаков, по-русски, без кавычек и точки в
   конце. Он должен называть тему урока, а не повторять первую фразу.
2. description — описание, 2–4 предложения, до 400 знаков, по-русски. О чём
   урок и что зритель после него сможет сделать.
3. tags — от четырёх до восьми тегов, по-русски или латиницей, строчными
   буквами, без решётки. Названия технологий оставляй как есть: docker, nginx.

Пиши как автор о своей работе: без рекламных оборотов, без «в этом видео мы
рассмотрим», без восклицательных знаков.

Расшифровка:
${text}`;
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
  return {
    title: String(parsed.title ?? '').trim(),
    description: String(parsed.description ?? '').trim(),
    // Решётку и регистр приводим сами: модель ставит их через раз, а теги
    // уходят в адреса вида /tag/docker.
    tags: tags
      .map((tag) => String(tag).trim().toLowerCase().replace(/^#/, ''))
      .filter(Boolean)
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

  return {
    async suggest(transcript) {
      const prompt = buildPrompt(transcript);
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
              responseSchema: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  description: { type: 'string' },
                  tags: { type: 'array', items: { type: 'string' } }
                },
                required: ['title', 'description', 'tags']
              }
            }
          })
        });

        if (response.ok) return { ...parseTextsResponse(await response.json()), model: name };

        const body = await response.text().catch(() => '');
        lastError = new Error(
          `${name} ответила ${response.status}: ` +
            `${readErrorMessage(hideKey(body, apiKey)).slice(0, 200)}`
        );
        // Отказ не про эту модель, а про сам запрос — следующая ответит тем же.
        if (!shouldTryNext(response.status)) throw lastError;
      }

      throw lastError ?? new Error('ни одна модель не ответила');
    }
  };
}
