// Рисование через Hugging Face. В сеть не ходим: fetch подставляется.
// Проверяется то, что ломается на деле — разбор ответа, перебор моделей,
// тексты отказов и то, что токен не утекает и читается свежим.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createImages,
  parseDrawingResponse,
  describeDrawingFailure,
  coverPromptTemplate,
  checkDrawingToken,
  stripNegations,
  DRAWING_URL,
  WHOAMI_URL,
  COVER_SIZE
} from '../src/services/images.js';

const TOKEN = 'hf_secret_token';
// Настоящая подпись PNG: вид файла определяется по первым байтам.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16)
]);

const settings = (over = {}) => async () => ({ token: TOKEN, models: ['первая', 'вторая'], ...over });

/** Ответ поставщика с картинкой в том виде, в каком его отдаёт Nscale. */
function withImage(bytes = PNG) {
  return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: bytes.toString('base64') }] }) };
}

function failure(status, text = 'отказ') {
  return { ok: false, status, text: async () => text };
}

test('картинка достаётся из b64_json, вид — по первым байтам', () => {
  const { bytes, type } = parseDrawingResponse({ data: [{ b64_json: PNG.toString('base64') }] });
  assert.ok(bytes.equals(PNG));
  assert.equal(type, 'png');
});

test('ответ без картинки — отказ, а не пустой файл', () => {
  // Принять пустоту за обложку значит положить в карточку урока битый файл.
  assert.throws(() => parseDrawingResponse({}), /не вернула картинку/);
  assert.throws(
    () => parseDrawingResponse({ data: [{ b64_json: Buffer.from('не картинка вовсе').toString('base64') }] }),
    /не картинку/
  );
});

test('в запросе модель, размер 16:9, base64 и токен заголовком', async () => {
  let seen = null;
  const images = createImages(settings(), async (url, options) => {
    seen = { url, options, body: JSON.parse(options.body) };
    return withImage();
  });
  const result = await images.generate('a lighthouse');
  assert.equal(seen.url, DRAWING_URL);
  assert.equal(seen.body.model, 'первая');
  assert.equal(seen.body.prompt, 'a lighthouse');
  // Обложка идёт в карточку урока и в превью ссылки, а квадрат там обрезается.
  assert.equal(seen.body.size, COVER_SIZE);
  assert.equal(seen.body.response_format, 'b64_json');
  assert.equal(seen.options.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(result.model, 'первая');
  assert.equal(result.type, 'png');
});

test('занятая модель уступает следующей', async () => {
  const tried = [];
  const images = createImages(settings(), async (url, options) => {
    const { model } = JSON.parse(options.body);
    tried.push(model);
    return model === 'первая' ? failure(429) : withImage();
  });
  const result = await images.generate('a lighthouse');
  assert.deepEqual(tried, ['первая', 'вторая']);
  assert.equal(result.model, 'вторая');
});

test('на неверном токене и пустом счёте следующую модель не спрашиваем', async () => {
  // Следующая модель ответит тем же: токен и счёт общие для всех.
  for (const [status, text] of [
    [401, /не подходит/],
    [402, /кредиты/]
  ]) {
    const tried = [];
    const images = createImages(settings(), async (url, options) => {
      tried.push(JSON.parse(options.body).model);
      return failure(status);
    });
    await assert.rejects(images.generate('a lighthouse'), text);
    assert.equal(tried.length, 1, `на ${status} спросили вторую модель`);
  }
});

test('заняты все — так и говорим', async () => {
  const images = createImages(settings(), async () => failure(503));
  await assert.rejects(images.generate('a lighthouse'), /заняты/);
});

test('токен не попадает в текст отказа', async () => {
  const images = createImages(settings(), async () =>
    failure(400, `{"error":"bad request for token ${TOKEN}"}`)
  );
  await assert.rejects(images.generate('a lighthouse'), (error) => {
    assert.ok(!error.message.includes(TOKEN), `токен утёк: ${error.message}`);
    return true;
  });
});

test('токен читается перед каждой картинкой', async () => {
  // Автор меняет токен в настройках — следующая картинка идёт уже с новым,
  // без перезапуска воркера.
  let token = 'hf_first';
  const headers = [];
  const images = createImages(
    async () => ({ token, models: ['первая'] }),
    async (url, options) => {
      headers.push(options.headers.Authorization);
      return withImage();
    }
  );
  await images.generate('a');
  token = 'hf_second';
  await images.generate('b');
  assert.deepEqual(headers, ['Bearer hf_first', 'Bearer hf_second']);
});

test('без токена рисования нет, и сказано, где его взять', async () => {
  let called = false;
  const images = createImages(settings({ token: '' }), async () => {
    called = true;
    return withImage();
  });
  assert.equal(await images.isConfigured(), false);
  await assert.rejects(images.generate('a'), /токен Hugging Face в настройках/);
  assert.equal(called, false, 'без токена ушли в сеть');
});

test('шаблонный запрос — по-английски, по тегам и без надписей', () => {
  const prompt = coverPromptTemplate({ title: 'Портал на VPS', tags: ['vps', 'docker'] });
  assert.match(prompt, /vps, docker/);
  assert.match(prompt, /Портал на VPS/);
  // Отрицаний нет вовсе: модель рисования читает «no X» как «нарисуй X».
  assert.ok(!/\b(no|without)\b/i.test(prompt), `в шаблоне отрицание: ${prompt}`);
});

test('тексты отказов понятны автору', () => {
  assert.match(describeDrawingFailure(401), /Токен Hugging Face не подходит/);
  assert.match(describeDrawingFailure(403), /Токен Hugging Face не подходит/);
  assert.match(describeDrawingFailure(402), /Кончились бесплатные кредиты/);
  assert.match(describeDrawingFailure(402), /huggingface\.co\/settings\/billing/);
  assert.match(describeDrawingFailure(503), /заняты/);
  assert.match(describeDrawingFailure(400, 'bad size'), /400: bad size/);
});

test('токен проверяется бесплатным запросом, картинка не рисуется', async () => {
  let seenUrl = null;
  const good = await checkDrawingToken(TOKEN, async (url) => {
    seenUrl = url;
    return { ok: true, status: 200, json: async () => ({ name: 'boris' }) };
  });
  assert.equal(seenUrl, WHOAMI_URL);
  assert.deepEqual(good, { ok: true, account: 'boris' });

  const bad = await checkDrawingToken(TOKEN, async () => failure(401));
  assert.equal(bad.ok, false);
  assert.match(bad.message, /не подходит/);

  assert.equal((await checkDrawingToken('', async () => withImage())).ok, false);
});

test('шаблонный запрос просит предметную сцену, а не значок видео', () => {
  const prompt = coverPromptTemplate({ title: 'Т', tags: [] });
  assert.match(prompt, /concrete physical scene/);
  // Даже в запрете: слово «play» в запросе и рисует кнопку play.
  assert.ok(!/play|video|screen/i.test(prompt), `в шаблоне слово про видео: ${prompt}`);
});

test('отрицания вычищаются из запроса целыми кусками', () => {
  assert.equal(
    stripNegations('A workshop with gears, no text, no play buttons, soft glow'),
    'A workshop with gears, soft glow'
  );
  assert.equal(stripNegations('A conveyor. Without people. Dark background'), 'A conveyor. Dark background');
  assert.equal(stripNegations('A lighthouse, no text'), 'A lighthouse');
  // Слово внутри куска не трогаем: «snow» и «know» — не отрицания.
  assert.equal(stripNegations('A snowy mountain'), 'A snowy mountain');
});
