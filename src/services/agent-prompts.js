// Запросы агента роликов к модели и разбор её ответов.
//
// Два запроса: выбрать из свежих новостей лучшие для ролика и написать по
// новости сценарий. Отдельно от src/services/texts.js, потому что это другой
// жанр: там — подписи к тому, что автор уже снял, здесь — сам ролик, и главная
// опасность в нём другая: модель охотно дописывает новости то, чего в ней не
// было. Ролик с выдумкой под именем автора хуже, чем никакого.
// Вызывается из src/services/texts.js (pickShortTopics, writeShortScript).

// Сколько новостей показываем модели за раз. Больше — и запрос раздувается
// пересказами, а выбирать из сотни ей не легче, чем из сорока.
const CANDIDATE_LIMIT = 40;

// Длина сценария в словах. 70–110 слов синтезатор читает за 30–45 секунд —
// столько досматривают ролик в ленте.
export const SCRIPT_WORDS = { min: 70, max: 110 };

function textOf(body) {
  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('модель вернула пустой ответ');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('модель вернула не JSON');
  }
}

/** Запрос на выбор тем. Номера — с единицы, как модель их и видит. */
export function buildPickPrompt(items, count) {
  const list = items
    .slice(0, CANDIDATE_LIMIT)
    .map(
      (item, index) =>
        `${index + 1}. [${item.source ?? ''}] ${item.title}\n   ${String(item.summary ?? '').slice(0, 300)}`
    )
    .join('\n');
  return `Ты редактор канала коротких вертикальных роликов об искусственном интеллекте
для русскоязычной аудитории: разработчики, предприниматели и просто любопытные.
Цель канала — набрать аудиторию: ролик должен цеплять в первые секунды и давать
зрителю что-то полезное или удивительное.

Ниже свежие новости. Выбери ${count} лучших для ролика на 30–45 секунд.
Хорошая тема: новый инструмент или модель, которую зритель может попробовать сам;
заметный шаг больших компаний; неожиданное применение ИИ. Плохая: внутренние
дела компаний, финансовые отчёты, мелкие обновления, то, что нельзя объяснить
за полминуты. Темы должны быть разными, не две об одном.

Верни picks — список объектов { number, reason }: номер новости из списка и
одна фраза, почему она зайдёт зрителю.

Новости:
${list}`;
}

/**
 * Разбирает выбор тем. Номера вне списка и повторы отбрасываются: модель
 * иногда ошибается на единицу или называет один номер дважды.
 */
export function parsePickResponse(body, items, count) {
  const parsed = textOf(body);
  const picks = Array.isArray(parsed.picks) ? parsed.picks : [];
  const chosen = [];
  for (const pick of picks) {
    const index = Number(pick?.number) - 1;
    const item = items[index];
    if (!Number.isInteger(index) || !item || chosen.some((one) => one.item === item)) continue;
    chosen.push({ item, reason: String(pick.reason ?? '').trim() });
    if (chosen.length === count) break;
  }
  return chosen;
}

/** Запрос на сценарий ролика по одной новости. */
export function buildScriptPrompt(topic, { instruction = '', previous = null } = {}) {
  return `Ты пишешь сценарий короткого вертикального ролика об искусственном интеллекте
для русскоязычной аудитории. Текст читает за кадром синтезатор речи, поверх идут
крупные титры. Ролик длится 30–45 секунд.

Новость:
Источник: ${topic.source ?? ''}
Заголовок: ${topic.title}
Текст: ${String(topic.summary ?? '').slice(0, 2000)}
Адрес: ${topic.url}

Правила:
- Опирайся ТОЛЬКО на текст новости. Не придумывай цифр, дат, возможностей и
  цитат, которых в нём нет. Если подробностей мало — говори о том, что есть, и
  о том, почему это важно зрителю, без выдуманных деталей.
- sentences — сценарий, список предложений, всего ${SCRIPT_WORDS.min}–${SCRIPT_WORDS.max} слов. Первое предложение
  — крючок: вопрос или неожиданный факт из новости, без приветствий. Последнее
  — короткий призыв подписаться, чтобы не пропускать новинки ИИ.
- Пиши так, как говорят вслух: короткие предложения, без скобок, списков,
  сокращений и ссылок. Названия компаний и продуктов — как они пишутся
  (OpenAI, Gemini), числа — словами, если их меньше ста.
- title — заголовок ролика для площадок, до 90 знаков, по-русски, без кавычек
  и точки в конце: по его словам площадка решает, кому показать ролик.
- description — 1–2 предложения о том, что зритель узнает. Без ссылок: ссылку
  на источник добавим сами.
- hashtags — от трёх до пяти хэштегов без решётки, строчными, без пробелов.
- headline — 2–5 слов крупно на экране в начале ролика.
${
  instruction
    ? `\nАвтор посмотрел прошлый вариант и просит поправить: ${instruction}\n`
    : previous
      ? '\nПрошлый вариант автору не понравился — напиши заметно другой.\n'
      : ''
}${previous ? `\nПрошлый вариант:\n${(previous.sentences ?? []).join(' ')}\n` : ''}`;
}

/** Схема ответа на сценарий: чего в ней нет, того модель не вернёт. */
export const SCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    headline: { type: 'string' },
    sentences: { type: 'array', items: { type: 'string' } }
  },
  required: ['title', 'description', 'hashtags', 'headline', 'sentences']
};

export const PICK_SCHEMA = {
  type: 'object',
  properties: {
    picks: {
      type: 'array',
      items: {
        type: 'object',
        properties: { number: { type: 'integer' }, reason: { type: 'string' } },
        required: ['number', 'reason']
      }
    }
  },
  required: ['picks']
};

/**
 * Разбирает сценарий. Слишком короткий — ошибка: синтезатор прочитает его за
 * десять секунд, и ролик выйдет пустым. Длинный не режем — читается дольше,
 * но цельно; предел площадок (60 с) проверяет сборка по настоящей длине звука.
 */
export function parseScriptResponse(body) {
  const parsed = textOf(body);
  const sentences = (Array.isArray(parsed.sentences) ? parsed.sentences : [])
    .map((sentence) => String(sentence).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const words = sentences.join(' ').split(' ').filter(Boolean).length;
  if (words < SCRIPT_WORDS.min / 2) {
    throw new Error(`сценарий слишком короткий: ${words} слов`);
  }
  const title = String(parsed.title ?? '').trim().replace(/[.\s]+$/, '');
  if (!title) throw new Error('модель не дала заголовок');
  return {
    title: title.slice(0, 100),
    description: String(parsed.description ?? '').trim(),
    headline: String(parsed.headline ?? '').trim().slice(0, 60),
    hashtags: [
      ...new Set(
        (Array.isArray(parsed.hashtags) ? parsed.hashtags : [])
          .map((tag) => String(tag).toLowerCase().replace(/[#\s]+/g, ''))
          .filter(Boolean)
      )
    ].slice(0, 5),
    sentences
  };
}
