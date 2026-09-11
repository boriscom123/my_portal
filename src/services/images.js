// Картинки, нарисованные моделью: обложки уроков, следом — картинки новостей.
//
// Рисует FLUX через Hugging Face, а не Gemini: модели рисования Gemini на
// бесплатной доле отказывают по квоте сразу, и портал не нарисовал ими ни
// одной обложки. FLUX.1 schnell стоит около $0.003 за картинку, и бесплатных
// $0.10 в месяц у Hugging Face хватает на три десятка обложек.
//
// Токен и список моделей берутся из базы перед каждой картинкой, а не при
// запуске воркера: автор меняет их в настройках, и новый токен должен работать
// сразу. Список перебирается до первой ответившей модели; при отказе у урока
// остаётся кадр из записи — обложка у него есть в любом случае.
// Собирается в src/worker.js, вызывается из src/jobs/make-cover-image.js и
// src/routes/integrations.js (проверка токена).
import { imageTypeOf } from '../lib/image-type.js';
import { hideKey, readErrorMessage } from './texts.js';

// Поставщик Nscale: он обслуживает FLUX.1 schnell на Hugging Face и отвечает в
// виде OpenAI — картинка base64 в data[0].b64_json. Адрес и формат взяты из
// исходника официального клиента Hugging Face.
export const DRAWING_URL = 'https://router.huggingface.co/nscale/v1/images/generations';

// Проверка токена: бесплатный запрос «чей это токен», картинку не рисует.
export const WHOAMI_URL = 'https://huggingface.co/api/whoami-v2';

// 16:9 — обложка идёт в карточку урока и в превью ссылки, а квадрат там
// обрезается. Меньше мегапикселя — значит, по нижней цене.
export const COVER_SIZE = '1024x576';

// Schnell рисует за секунды; две минуты — с запасом на очередь у поставщика.
const TIMEOUT_MS = 120_000;
const CHECK_TIMEOUT_MS = 15_000;

/**
 * Стоит ли пробовать следующую модель.
 * 429 и 5xx — про занятость конкретной модели. 400–403 — про запрос, токен
 * или счёт: следующая модель ответит тем же.
 */
function shouldTryNext(status) {
  return status === 429 || status >= 500;
}

/** Достаёт картинку из ответа. Вид — по первым байтам, а не по догадке. */
export function parseDrawingResponse(body) {
  const data = body?.data?.[0]?.b64_json;
  if (!data) throw new Error('модель не вернула картинку');
  const bytes = Buffer.from(data, 'base64');
  const type = imageTypeOf(bytes);
  if (!type) throw new Error('модель вернула не картинку');
  return { bytes, type };
}

/** Что сказать автору под кнопкой. status 0 — никто не ответил вовремя. */
export function describeDrawingFailure(status, detail = '') {
  if (status === 401 || status === 403) {
    return 'Токен Hugging Face не подходит — проверьте его в настройках';
  }
  if (status === 402) {
    return (
      'Кончились бесплатные кредиты Hugging Face на этот месяц: ' +
      'https://huggingface.co/settings/billing'
    );
  }
  if (status === 0 || status === 429 || status >= 500) {
    return 'Модели сейчас заняты, попробуйте через несколько минут';
  }
  return `Hugging Face ответил ${status}${detail ? `: ${detail}` : ''}`;
}

/**
 * Запрос для обложки без текстовой модели.
 * Путь запасной: основной запрос пишет Gemini. Теги и заголовок урока бывают
 * по-русски, и FLUX их почти не поймёт, поэтому смысл держит сама сцена из
 * шаблона — предметная, а не значок: абстракцию модель рисует кнопкой play.
 * Отрицаний в шаблоне нет намеренно: «no play buttons» модель читает как
 * «нарисуй кнопку play», так вышла вторая обложка.
 */
export function coverPromptTemplate({ title, tags = [] }) {
  return [
    'Flat vector illustration for the cover of a software development lesson.',
    tags.length ? `Topic keywords: ${tags.join(', ')}.` : '',
    `Lesson title: ${title}.`,
    'Show a concrete physical scene with real-world objects (a machine, a workshop, a conveyor, tools) as a visual metaphor of the topic.',
    'Simple composition readable at thumbnail size, plain surfaces, clean flat shapes.',
    'Dark background, deep blue and violet tones, a single warm orange accent, soft glow.'
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Вычищает отрицания из запроса целыми кусками между запятыми и точками.
 * Модель рисования отрицаний не понимает: «no play buttons» она читает как
 * «нарисуй кнопку play». Gemini просят их не писать, а это страховка на
 * случай, если напишет. Запрос автора сюда не попадает: что писать, решает он.
 */
export function stripNegations(prompt) {
  return String(prompt)
    .split(/(?<=[,.;])/)
    .filter((part) => !/^\s*(no|without|avoid|never|not)\b/i.test(part))
    .join('')
    .replace(/[,;]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Проверяет токен бесплатным запросом. Токен в ответ не попадает. */
export async function checkDrawingToken(token, fetchImpl = fetch) {
  if (!token) return { ok: false, message: 'Токен не сохранён' };
  let response;
  try {
    response = await fetchImpl(WHOAMI_URL, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS)
    });
  } catch (error) {
    const reason = error.name === 'TimeoutError' ? 'не ответил вовремя' : hideKey(error.message, token);
    return { ok: false, message: `Hugging Face не ответил: ${reason}` };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, message: 'Токен Hugging Face не подходит' };
  }
  if (!response.ok) return { ok: false, message: `Hugging Face ответил ${response.status}` };
  const body = await response.json().catch(() => ({}));
  return { ok: true, account: String(body?.name ?? '') };
}

/**
 * Слой рисования. loadSettings — async () => ({ token, models }): читает
 * настройки из базы при каждом вызове.
 */
export function createImages(loadSettings, fetchImpl = fetch) {
  return {
    async isConfigured() {
      const { token } = await loadSettings();
      return Boolean(token);
    },

    async generate(prompt, { size = COVER_SIZE } = {}) {
      const { token, models } = await loadSettings();
      if (!token) {
        throw new Error('рисование не настроено: добавьте токен Hugging Face в настройках');
      }

      let lastStatus = 0;
      let lastDetail = '';
      for (const model of models) {
        let response;
        try {
          response = await fetchImpl(DRAWING_URL, {
            method: 'POST',
            headers: {
              // Токен заголовком, а не в адресе: адреса попадают в журналы
              // посредников целиком.
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            signal: AbortSignal.timeout(TIMEOUT_MS),
            body: JSON.stringify({ model, prompt, size, response_format: 'b64_json' })
          });
        } catch (error) {
          // Не ответила вовремя — это про эту модель: следующая может быть свободна.
          lastStatus = 0;
          lastDetail = error.name === 'TimeoutError' ? 'не ответила вовремя' : hideKey(error.message, token);
          continue;
        }

        if (response.ok) return { ...parseDrawingResponse(await response.json()), model };

        const body = await response.text().catch(() => '');
        lastStatus = response.status;
        lastDetail = readErrorMessage(hideKey(body, token)).slice(0, 200);
        if (!shouldTryNext(response.status)) break;
      }

      throw new Error(describeDrawingFailure(lastStatus, lastDetail));
    }
  };
}
