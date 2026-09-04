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

// Сколько ждём ответ. Модель отвечает за секунды; минута — это уже сбой, и
// висеть на нём, пока автор смотрит на кнопку, незачем.
const TIMEOUT_MS = 60_000;

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
export function createTexts(config, fetchImpl = fetch) {
  const { apiKey, model } = config.gemini ?? {};
  if (!apiKey) return null;

  return {
    async suggest(transcript) {
      const response = await fetchImpl(`${API_BASE}/${model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Ключ заголовком, а не в адресе: адреса попадают в журналы
          // посредников целиком, а заголовки — нет.
          'x-goog-api-key': apiKey
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(transcript) }] }],
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

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(
          `модель ответила ${response.status}: ${hideKey(body, apiKey).slice(0, 200)}`
        );
      }

      return parseTextsResponse(await response.json());
    }
  };
}
