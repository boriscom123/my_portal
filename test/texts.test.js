// Тексты урока от модели. В сеть не ходим: fetch подставляется. Проверяется
// то, что ломается на самом деле — разбор ответа, откат без ключа и то, что
// ключ не попадает ни в адрес, ни в сообщение об ошибке.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTexts,
  parseTextsResponse,
  buildPrompt,
  hideKey,
  shouldTryNext,
  parseModels
} from '../src/services/texts.js';

const config = { gemini: { apiKey: 'секретный-ключ', model: 'gemini-flash-latest' } };
const listConfig = { gemini: { apiKey: 'k', model: 'первая, вторая , третья' } };

/** Ответ модели в том виде, в каком его отдаёт Gemini. */
function reply(payload) {
  return {
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }]
    })
  };
}

test('без ключа слоя нет, и это не ошибка', () => {
  // Портал обязан работать без модели: кнопка заполнения тогда берёт заготовку
  // из расшифровки своими силами.
  assert.equal(createTexts({ gemini: { apiKey: '', model: 'x' } }), null);
  assert.equal(createTexts({}), null);
});

test('ответ модели разбирается в три поля', () => {
  const parsed = parseTextsResponse({
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify({
                title: 'Портал на VPS с нуля',
                description: 'Поднимаем каркас.',
                tags: ['Docker', '#nginx', ' VPS ']
              })
            }
          ]
        }
      }
    ]
  });
  assert.equal(parsed.title, 'Портал на VPS с нуля');
  // Решётку и регистр приводим сами: модель ставит их через раз, а теги уходят
  // в адреса вида /tag/docker.
  assert.deepEqual(parsed.tags, ['docker', 'nginx', 'vps']);
});

test('пустой и битый ответ не роняют шаг молча', () => {
  assert.throws(() => parseTextsResponse({}), /пустой/);
  assert.throws(
    () => parseTextsResponse({ candidates: [{ content: { parts: [{ text: 'просто текст' }] } }] }),
    /не JSON/
  );
});

test('ключ уходит заголовком, а не в адресе', async () => {
  let seen = null;
  const texts = createTexts(config, async (url, options) => {
    seen = { url: String(url), options };
    return reply({ title: 'Т', description: 'О', tags: [] });
  });
  await texts.suggest('расшифровка');

  // Адреса попадают в журналы посредников целиком, а заголовки — нет.
  assert.ok(!seen.url.includes('секретный-ключ'), `ключ в адресе: ${seen.url}`);
  assert.equal(seen.options.headers['x-goog-api-key'], 'секретный-ключ');
  assert.match(seen.url, /gemini-flash-latest:generateContent$/);
});

test('в отказе модели ключа нет', async () => {
  const texts = createTexts(config, async () => ({
    ok: false,
    status: 429,
    text: async () => 'quota exceeded for key секретный-ключ'
  }));
  await assert.rejects(texts.suggest('расшифровка'), (error) => {
    // Поставщик кладёт ключ прямо в текст отказа, а сообщение уходит и в
    // журнал, и на экран человеку.
    assert.ok(!error.message.includes('секретный-ключ'), `ключ утёк: ${error.message}`);
    assert.match(error.message, /429/);
    return true;
  });
});

test('ключ вычищается из любого чужого текста', () => {
  assert.equal(hideKey('quota for key abc123 exceeded', 'abc123'), 'quota for key …ключ… exceeded');
  assert.equal(hideKey('без ключа', ''), 'без ключа');
});

test('просим у модели ровно то, что нужно площадке', () => {
  const prompt = buildPrompt('расшифровка урока');
  // Заголовок длиннее строки площадка обрежет сама, и обрежет в неудачном месте.
  assert.match(prompt, /70 знаков/);
  assert.match(prompt, /расшифровка урока/);
  // Первая фраза урока — это «Итак, мы продолжаем», и заголовком она быть не
  // должна: на этом и споткнулось извлечение по частотности.
  assert.match(prompt, /не повторять первую фразу/);
});

test('длинная расшифровка обрезается, а не растёт без предела', () => {
  const prompt = buildPrompt('а'.repeat(200_000));
  assert.ok(prompt.length < 100_000, `запрос вырос до ${prompt.length} знаков`);
});

test('по умолчанию задан список моделей, а не одна', async () => {
  // Одна не годится по двум причинам сразу, и обе встретились в первый день:
  // закреплённое имя перестают выдавать новым ключам, а на бесплатной доле
  // ходовые модели разом отвечают «высокий спрос».
  const { loadConfig } = await import('../src/config.js');
  const loaded = loadConfig({
    PUBLIC_BASE_URL: 'https://x',
    DB_HOST: 'db', DB_NAME: 'n', DB_USER: 'u', DB_PASS: 'p',
    JWT_SECRET: 'x'.repeat(32)
  });
  assert.ok(parseModels(loaded.gemini.model).length >= 2, loaded.gemini.model);
});

test('список моделей разбирается с пробелами и пустотами', () => {
  assert.deepEqual(parseModels('первая, вторая , третья'), ['первая', 'вторая', 'третья']);
  assert.deepEqual(parseModels(''), []);
  assert.deepEqual(parseModels(null), []);
});

test('перегруженная модель уступает следующей', async () => {
  // На бесплатной доле из пяти ходовых моделей отвечала одна: остальные давали
  // 503 «высокий спрос». Останавливаться на первой значило бы отдавать автору
  // заготовку похуже при живой модели рядом.
  const tried = [];
  const texts = createTexts(listConfig, async (url) => {
    const name = String(url).split('/').pop().split(':')[0];
    tried.push(name);
    if (name !== 'третья') {
      return { ok: false, status: 503, text: async () => 'high demand' };
    }
    return {
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify({ title: 'Т', description: 'О', tags: ['a'] }) }]
            }
          }
        ]
      })
    };
  });

  const result = await texts.suggest('расшифровка');
  assert.deepEqual(tried, ['первая', 'вторая', 'третья']);
  assert.equal(result.title, 'Т');
  // Какая модель ответила — видно в ответе: без этого разбирать разницу в
  // качестве заготовок пришлось бы гаданием.
  assert.equal(result.model, 'третья');
});

test('отказ не про модель следующую не пробует', async () => {
  // 400 — это про сам запрос: следующая модель ответит тем же, и перебор
  // означал бы три бессмысленных обращения вместо одного.
  const tried = [];
  const texts = createTexts(listConfig, async (url) => {
    tried.push(String(url).split('/').pop());
    return { ok: false, status: 400, text: async () => 'bad request' };
  });
  await assert.rejects(texts.suggest('расшифровка'), /400/);
  assert.equal(tried.length, 1);
});

test('какие коды считаются поводом попробовать другую модель', () => {
  assert.ok(shouldTryNext(503), 'высокий спрос');
  assert.ok(shouldTryNext(404), 'модель перестали выдавать');
  assert.ok(shouldTryNext(429), 'квота на минуту');
  assert.ok(!shouldTryNext(400));
  assert.ok(!shouldTryNext(403), 'ключ негодный — другая модель не поможет');
});

test('пустой список моделей означает отсутствие слоя', () => {
  assert.equal(createTexts({ gemini: { apiKey: 'k', model: '' } }), null);
});
