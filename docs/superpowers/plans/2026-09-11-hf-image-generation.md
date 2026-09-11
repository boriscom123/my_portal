# Рисование через Hugging Face — план реализации части 2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** обложки уроков рисует FLUX.1 schnell через Hugging Face вместо Gemini, токен вводится в блоке настроек.

**Architecture:** токен и список моделей лежат в `platform_apps` (строка `huggingface`, токен зашифрован) и читаются из базы перед каждой картинкой. Слой `src/services/images.js` ходит в роутер Hugging Face к поставщику Nscale обычным `fetch` и перебирает модели. Английский запрос для FLUX составляет текстовый Gemini (`suggestCoverPrompt`), без него — шаблон.

**Tech Stack:** Node 24, Express, PostgreSQL, BullMQ, `node:test`; без новых зависимостей.

**Spec:** `docs/superpowers/specs/2026-09-11-hf-image-generation-design.md`

## Global Constraints

- Имена — только латиницей (переменные, функции, файлы, `data-`атрибуты, классы); комментарии и тексты для человека — по-русски. Каждый новый файл начинается с русского комментария: задача, зачем так, откуда вызывается.
- Модель по умолчанию — ровно `black-forest-labs/FLUX.1-schnell`.
- Адрес рисования — ровно `https://router.huggingface.co/nscale/v1/images/generations`; проверка токена — `https://huggingface.co/api/whoami-v2`.
- Размер обложки — `1024x576`.
- Токен никогда не попадает в текст ошибки, в ответ API, в разметку страницы и в журнал.
- Строка `platform_apps` — `name = 'huggingface'`, `client_id = ''`, токен в `client_secret`, модели в `settings.models`.
- Отдельный тест запускается так (из корня репозитория):
  `docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app my_portal-worker node --test test/<файл>.test.js`
- Полная проверка перед фиксацией (из `CLAUDE.md`), только в образе проекта и только в несколько потоков:
  `docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app my_portal-worker sh -c 'node --test --test-concurrency=8 "test/**/*.test.js"; npm run lint'`
- Фиксации — по задаче; `git push` и выкатка (`docker compose up -d --build`) — один раз, в задаче 6, когда рисованием уже можно пользоваться.

---

### Task 1: Хранение настроек рисования

**Files:**
- Create: `src/services/drawing-settings.js`
- Test: `test/drawing-settings.test.js`

**Interfaces:**
- Consumes: `loadPlatformApp`, `savePlatformApp`, `forgetPlatformSecret` из `src/services/platform-apps.js`; `parseModels` из `src/services/texts.js`.
- Produces:
  - `DRAWING_APP = 'huggingface'`
  - `DEFAULT_DRAWING_MODELS = 'black-forest-labs/FLUX.1-schnell'`
  - `loadDrawingSettings(pool, config) → Promise<{ token: string, modelsText: string, models: string[] }>` — `modelsText` как сохранено (может быть `''`), `models` — разобранный список с подстановкой умолчания.
  - `saveDrawingSettings(pool, config, { token, models }) → Promise<void>` — пустой `token` прежний не стирает.
  - `forgetDrawingToken(pool) → Promise<void>`

- [ ] **Step 1: Write the failing test**

`test/drawing-settings.test.js`:

```js
// Настройки рисования: токен Hugging Face и список моделей.
// Главное — токен хранится зашифрованным, пустое поле его не стирает, а пустой
// список моделей означает список по умолчанию, а не «рисовать нечем».
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadDrawingSettings,
  saveDrawingSettings,
  forgetDrawingToken,
  DEFAULT_DRAWING_MODELS
} from '../src/services/drawing-settings.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = { tokenEncryptionKey: 'a'.repeat(64) };

test('без сохранённых настроек токена нет, модели — по умолчанию', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const settings = await loadDrawingSettings(pool, config);
    assert.equal(settings.token, '');
    assert.equal(settings.modelsText, '');
    assert.deepEqual(settings.models, [DEFAULT_DRAWING_MODELS]);
  });
});

test('токен и модели сохраняются, токен в базе зашифрован', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveDrawingSettings(pool, config, { token: 'hf_secret_token', models: 'первая, вторая' });
    const settings = await loadDrawingSettings(pool, config);
    assert.equal(settings.token, 'hf_secret_token');
    assert.equal(settings.modelsText, 'первая, вторая');
    assert.deepEqual(settings.models, ['первая', 'вторая']);

    const { rows } = await pool.query(
      `SELECT client_secret FROM platform_apps WHERE name = 'huggingface'`
    );
    assert.ok(!rows[0].client_secret.includes('hf_secret_token'), 'токен лежит открытым');
  });
});

test('пустое поле токена прежний не стирает', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveDrawingSettings(pool, config, { token: 'hf_secret_token', models: '' });
    // Показать сохранённый токен нельзя, поэтому поле на странице всегда
    // пустое: правка одного списка моделей не должна молча выключать рисование.
    await saveDrawingSettings(pool, config, { token: '', models: 'другая' });
    const settings = await loadDrawingSettings(pool, config);
    assert.equal(settings.token, 'hf_secret_token');
    assert.deepEqual(settings.models, ['другая']);
  });
});

test('убранный токен выключает рисование, модели остаются', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveDrawingSettings(pool, config, { token: 'hf_secret_token', models: 'своя' });
    await forgetDrawingToken(pool);
    const settings = await loadDrawingSettings(pool, config);
    assert.equal(settings.token, '');
    assert.deepEqual(settings.models, ['своя']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app my_portal-worker node --test test/drawing-settings.test.js`
Expected: FAIL — `Cannot find module '.../src/services/drawing-settings.js'`.

- [ ] **Step 3: Write minimal implementation**

`src/services/drawing-settings.js`:

```js
// Настройки рисования: токен Hugging Face и список моделей.
//
// Задача — держать их там, где их меняет автор, — в блоке настроек, — и
// отдавать слою рисования свежими перед каждой картинкой. Хранятся в той же
// таблице, что ключи площадок, и токен шифруется тем же ключом. Номера
// приложения у Hugging Face нет, поэтому client_id пустой.
// Вызывается из src/worker.js, src/routes/integrations.js, src/routes/pages.js
// и src/routes/admin.js.
import { loadPlatformApp, savePlatformApp, forgetPlatformSecret } from './platform-apps.js';
import { parseModels } from './texts.js';

export const DRAWING_APP = 'huggingface';

// FLUX.1 schnell: около $0.003 за картинку, и на Hugging Face его сейчас
// обслуживает поставщик Nscale, в которого и ходит слой рисования.
export const DEFAULT_DRAWING_MODELS = 'black-forest-labs/FLUX.1-schnell';

/** Токен и модели из базы. Пустой список моделей — значит, по умолчанию. */
export async function loadDrawingSettings(pool, config) {
  const stored = await loadPlatformApp(pool, config, DRAWING_APP);
  const modelsText = String(stored?.settings?.models ?? '').trim();
  return {
    token: stored?.clientSecret ?? '',
    modelsText,
    models: parseModels(modelsText || DEFAULT_DRAWING_MODELS)
  };
}

/** Сохраняет токен и модели. Пустой токен прежний не стирает. */
export async function saveDrawingSettings(pool, config, { token = '', models = '' }) {
  await savePlatformApp(pool, config, {
    name: DRAWING_APP,
    clientId: '',
    clientSecret: String(token ?? '').trim(),
    mode: 'semi',
    settings: { models: parseModels(models).join(', ') }
  });
}

/** Стирает токен: рисование выключается, список моделей остаётся. */
export async function forgetDrawingToken(pool) {
  await forgetPlatformSecret(pool, DRAWING_APP);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app my_portal-worker node --test test/drawing-settings.test.js`
Expected: PASS, 4 теста, 0 пропущенных (если пропущены — не хватает сети `shared-data`, это не зелёный прогон).

- [ ] **Step 5: Commit**

```bash
git add src/services/drawing-settings.js test/drawing-settings.test.js
git commit -m "feat: портал хранит токен Hugging Face и список моделей рисования"
```

---

### Task 2: Английский запрос для обложки от текстового Gemini

**Files:**
- Modify: `src/services/texts.js` (новая функция после `parseImagePrompt`, новый метод в объекте `createTexts` после `suggestImagePrompt`)
- Test: `test/texts.test.js`

**Interfaces:**
- Consumes: внутренние `ask`, `parseImagePrompt`, `NEWS_MODEL_TIMEOUT_MS`, `NEWS_TOTAL_MS` из `src/services/texts.js`.
- Produces:
  - `buildCoverImagePrompt({ title, description = '', tags = [] }) → string`
  - метод `texts.suggestCoverPrompt({ title, description, tags }) → Promise<{ prompt: string, model: string }>`

- [ ] **Step 1: Write the failing test**

В `test/texts.test.js` добавить `buildCoverImagePrompt` в список импорта из `'../src/services/texts.js'` (после `parseImagePrompt,`) и дописать в конец файла:

```js
test('запрос для обложки просят по-английски и по теме урока', () => {
  const prompt = buildCoverImagePrompt({
    title: 'Портал на VPS',
    description: 'Каркас',
    tags: ['vps', 'docker']
  });
  // FLUX понимает русский плохо: запрос для него — английский.
  assert.match(prompt, /на английском/);
  assert.match(prompt, /Портал на VPS/);
  assert.match(prompt, /vps, docker/);
  // Модели рисуют буквы с ошибками: обложка с исковерканным словом хуже, чем
  // без слов.
  assert.match(prompt, /никаких надписей/);
});

test('запрос для обложки приходит из модели готовой фразой', async () => {
  let sent = null;
  const texts = createTexts(config, async (url, options) => {
    sent = JSON.parse(options.body);
    return reply({ prompt: 'A glowing server rack as a lighthouse on a dark sea' });
  });
  const { prompt } = await texts.suggestCoverPrompt({ title: 'Портал на VPS', tags: ['vps'] });
  assert.equal(prompt, 'A glowing server rack as a lighthouse on a dark sea');
  assert.match(sent.contents[0].parts[0].text, /Портал на VPS/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app my_portal-worker node --test test/texts.test.js`
Expected: FAIL — `buildCoverImagePrompt` не экспортируется (SyntaxError об отсутствующем экспорте).

- [ ] **Step 3: Write minimal implementation**

В `src/services/texts.js` сразу после функции `parseImagePrompt` (заканчивается строкой `  return prompt;\n}`) добавить:

```js
/**
 * Запрос для рисования обложки урока.
 *
 * По-английски: FLUX понимает русский плохо, а переводить на ходу — терять
 * точность. Требования к картинке те же, что были у обложки на Gemini:
 * надписи модели рисуют с ошибками, а превью смотрят размером с ноготь.
 */
export function buildCoverImagePrompt({ title, description = '', tags = [] }) {
  const topic = [title, description].filter(Boolean).join('. ');
  return `Ты помогаешь автору технического портала готовить запрос для
рисовальщика изображений.

Тема видеоурока по разработке: ${String(topic).trim().slice(0, 1200)}
Ключевые слова: ${tags.join(', ')}

Составь ОДИН запрос на английском языке, по которому рисовальщик сделает
обложку этого урока.

Требования к картинке:
— никаких надписей, букв, цифр и логотипов;
— тёмный фон, глубокие синие и фиолетовые тона, один тёплый оранжевый акцент;
— одна ясная метафора темы, а не набор иконок; композиция простая: превью
  смотрят размером с ноготь;
— без людей и без лиц;
— плоская векторная графика, чистые формы, лёгкое свечение.

Одна связная фраза-запрос, 40–70 слов, без списков и без пояснений.

Верни JSON с единственным полем prompt.`;
}
```

В объекте, который возвращает `createTexts`, после метода `suggestImagePrompt` (заканчивается `      return { prompt: parseImagePrompt(body), model: name };\n    }`) поставить запятую и добавить:

```js
    /**
     * Английский запрос для рисования обложки урока.
     * Сроки короткие, как у новости: ждёт воркер, но рисование и так идёт
     * своим чередом, и минута на запрос к тексту была бы лишней.
     */
    async suggestCoverPrompt(lesson) {
      const { body, model: name } = await ask(
        buildCoverImagePrompt(lesson),
        {
          type: 'object',
          properties: { prompt: { type: 'string' } },
          required: ['prompt']
        },
        { timeoutMs: NEWS_MODEL_TIMEOUT_MS, totalMs: NEWS_TOTAL_MS }
      );
      return { prompt: parseImagePrompt(body), model: name };
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app my_portal-worker node --test test/texts.test.js`
Expected: PASS, все тесты файла.

- [ ] **Step 5: Commit**

```bash
git add src/services/texts.js test/texts.test.js
git commit -m "feat: текстовый Gemini составляет английский запрос для обложки"
```

---

### Task 3: Слой рисования на Hugging Face и шаг обложки

**Files:**
- Modify (переписать целиком): `src/services/images.js`
- Modify: `src/jobs/make-cover-image.js`
- Modify: `src/worker.js:23,108`
- Modify: `src/config.js:120-126` (убрать `imageModel`)
- Modify: `.env.example` (убрать `GEMINI_IMAGE_MODEL` и комментарий над ним)
- Modify: `src/views/legal.js:70` (Hugging Face в списке сторонних сервисов)
- Test (переписать целиком): `test/images.test.js`
- Test: `test/cover-image.test.js`

**Interfaces:**
- Consumes: `imageTypeOf(bytes) → 'png'|'jpg'|'webp'|null` из `src/lib/image-type.js`; `hideKey`, `readErrorMessage` из `src/services/texts.js`; `loadDrawingSettings` (Task 1); `texts.suggestCoverPrompt` (Task 2).
- Produces:
  - `DRAWING_URL`, `WHOAMI_URL`, `COVER_SIZE = '1024x576'`
  - `createImages(loadSettings, fetchImpl = fetch)` → `{ isConfigured(): Promise<boolean>, generate(prompt, { size }?): Promise<{ bytes: Buffer, type: string, model: string }> }`; `loadSettings` — `async () => ({ token, models })`.
  - `parseDrawingResponse(body) → { bytes, type }`
  - `describeDrawingFailure(status, detail?) → string`
  - `coverPromptTemplate({ title, tags }) → string`
  - `checkDrawingToken(token, fetchImpl = fetch) → Promise<{ ok: true, account: string } | { ok: false, message: string }>`
  - `makeMakeCoverImage(config, pool, images, texts = null)` → задача, возвращает `{ assetId, bytes, model, promptSource: 'gemini' | 'template' }`

- [ ] **Step 1: Write the failing tests**

`test/images.test.js` — заменить содержимое целиком:

```js
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
  assert.match(prompt, /No text/);
  assert.match(prompt, /no people/);
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
```

В `test/cover-image.test.js`:

1. В импорт добавить сохранение токена:

```js
import { saveDrawingSettings } from '../src/services/drawing-settings.js';
```

2. В `makeConfig()` добавить ключ шифрования (строкой после `media: …`, не забыв запятую):

```js
    tokenEncryptionKey: 'a'.repeat(64)
```

3. Заменить заготовку `drawing` целиком:

```js
const drawing = {
  isConfigured: async () => true,
  generate: async () => ({
    bytes: Buffer.from('нарисованная картинка'),
    type: 'png',
    model: 'black-forest-labs/FLUX.1-schnell'
  })
};
```

4. Дописать в конец файла:

```js
test('запрос для обложки даёт текстовая модель, а без неё — шаблон', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson } = await seed(pool, config);
    const prompts = [];
    const recording = {
      isConfigured: async () => true,
      generate: async (prompt) => {
        prompts.push(prompt);
        return { bytes: Buffer.from('картинка'), type: 'png', model: 'm' };
      }
    };

    const fromModel = await makeMakeCoverImage(config, pool, recording, {
      suggestCoverPrompt: async () => ({ prompt: 'A lighthouse made of servers', model: 't' })
    })({ lessonId: lesson.id });
    assert.equal(fromModel.promptSource, 'gemini');
    assert.equal(prompts[0], 'A lighthouse made of servers');

    // Текстовая модель отказала — рисование от неё не зависит.
    const fromTemplate = await makeMakeCoverImage(config, pool, recording, {
      suggestCoverPrompt: async () => {
        throw new Error('503');
      }
    })({ lessonId: lesson.id });
    assert.equal(fromTemplate.promptSource, 'template');
    assert.match(prompts[1], /No text/);
  });
});
```

5. В тесте `'новая попытка не показывает прошлый отказ как свежий'` сразу после строки `const { lesson, headers } = await seed(pool, config);` добавить (с этого места маршрут без токена отвечает 409 — задача 5):

```js
    await saveDrawingSettings(pool, config, { token: 'hf_secret_token', models: '' });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app my_portal-worker node --test test/images.test.js test/cover-image.test.js`
Expected: FAIL — `images.js` не экспортирует `parseDrawingResponse` и прочее; тест шаблона в `cover-image.test.js` падает на `promptSource`.

- [ ] **Step 3: Write the implementation**

`src/services/images.js` — заменить содержимое целиком:

```js
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
 * Теги урока и так латиницей и несут смысл; заголовок по-русски FLUX почти не
 * поймёт, но и не испортит.
 */
export function coverPromptTemplate({ title, tags = [] }) {
  return [
    'Flat vector illustration for the cover of a software development video lesson.',
    tags.length ? `Topic keywords: ${tags.join(', ')}.` : '',
    `Lesson title: ${title}.`,
    'One clear visual metaphor of the topic, simple composition readable at thumbnail size.',
    'Dark background, deep blue and violet tones, a single warm orange accent, soft glow, clean shapes.',
    'No text, no letters, no numbers, no logos, no people, no faces.'
  ]
    .filter(Boolean)
    .join(' ');
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
```

`src/jobs/make-cover-image.js` — заменить содержимое целиком:

```js
// Шаг конвейера: обложка, нарисованная моделью.
//
// Задача — заменить кадр из записи нарисованной картинкой, когда автор этого
// захотел. Зачем очередью: запрос для рисования и само рисование вместе могут
// идти дольше минуты, а запрос через nginx рвётся на шестидесяти секундах.
//
// Английский запрос для FLUX составляет текстовая модель; без неё или при её
// отказе — шаблон. Рисование от текстовой модели не зависит.
// Кадр из записи при этом остаётся в буфере: если нарисованная не понравится,
// автор вернёт кадр одним нажатием, а не перезапуском обработки.
// Вызывается воркером по имени JOBS.makeCoverImage.
import { writeFile, stat, mkdir } from 'node:fs/promises';
import { coverPromptTemplate } from '../services/images.js';
import { mediaPath, registerAsset } from '../services/media.js';

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
  return async ({ lessonId }) => {
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
    const { prompt, source } = await coverPrompt(texts, lesson);
    const { bytes, type, model } = await images.generate(prompt);

    const dir = `lesson-${lessonId}`;
    await mkdir(mediaPath(config, dir), { recursive: true });
    // Имя постоянное: повторное рисование заменяет прошлую картинку, а не
    // копит их в буфере до истечения срока.
    const relative = `${dir}/cover-drawn.${type}`;
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

    return { assetId: asset.id, bytes: size, model, promptSource: source };
  };
}
```

`src/worker.js`:
- после строки `import { createImages } from './services/images.js';` добавить
  `import { loadDrawingSettings } from './services/drawing-settings.js';`
- строку `  [JOBS.makeCoverImage]: makeMakeCoverImage(config, pool, createImages(config)),` заменить на:

```js
  // Токен рисования читается из базы перед каждой картинкой: автор меняет его
  // в настройках, и новый должен работать без перезапуска воркера.
  [JOBS.makeCoverImage]: makeMakeCoverImage(
    config,
    pool,
    createImages(() => loadDrawingSettings(pool, config)),
    createTexts(config)
  ),
```

`src/config.js` — внутри `gemini: { … }` удалить блок с комментарием «Модели рисования — отдельным списком…» и полем `imageModel` целиком (строки 120–126), оставив `apiKey` и `model`. Запятую после `model: …` убрать, если поле стало последним.

`.env.example` — удалить строки 109–113, то есть ровно этот блок (строка `GEMINI_MODEL=` над ним остаётся):

```ini
# Модели для рисования обложки, тоже списком. Рисование требует включённой
# оплаты на проекте Google Cloud: на бесплатной доле квота на них нулевая, а
# подписка в приложении Gemini на API не распространяется — проверено. Без
# оплаты кнопка честно скажет об отказе, а обложкой останется кадр из записи.
GEMINI_IMAGE_MODEL=
```

`src/views/legal.js` — перед строкой, начинающейся с `    <li><strong>Модели Google Gemini</strong>`, вставить:

```html
    <li><strong>Hugging Face</strong> — рисование обложек уроков, когда автор
      просит: туда уходит английский запрос, составленный из заголовка,
      описания и тегов урока, — то, что и так будет опубликовано.</li>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app my_portal-worker node --test test/images.test.js test/cover-image.test.js test/texts.test.js`
Expected: PASS. Затем убедиться, что упоминаний не осталось:
`grep -rn "imageModel\|GEMINI_IMAGE_MODEL\|buildCoverPrompt\|extensionFor" src test .env.example` — пусто.

- [ ] **Step 5: Commit**

```bash
git add src/services/images.js src/jobs/make-cover-image.js src/worker.js src/config.js .env.example src/views/legal.js test/images.test.js test/cover-image.test.js
git commit -m "feat: обложки рисует FLUX через Hugging Face вместо Gemini"
```

---

### Task 4: Блок «Рисование (Hugging Face)» в настройках

**Files:**
- Modify: `src/routes/integrations.js` (импорты; маршруты перед комментарием `// Отключить канал: токены забываем…`)
- Modify: `src/routes/pages.js` (импорт; данные блока в `GET /settings`)
- Modify: `src/views/settings.js` (параметр `drawing`; блок перед `data-block="sources"`)
- Modify: `public/app.js` (обработчики перед `const youtubeAppForm = …`)
- Test: `test/drawing-routes.test.js` (новый), `test/html.test.js`

**Interfaces:**
- Consumes: `loadDrawingSettings`, `saveDrawingSettings`, `forgetDrawingToken`, `DEFAULT_DRAWING_MODELS` (Task 1); `checkDrawingToken` (Task 3).
- Produces:
  - `POST /api/integrations/huggingface/app` — тело `{ token, models }`, ответ `{ models: string, hasToken: boolean }`
  - `POST /api/integrations/huggingface/check` — ответ `{ ok: true, account } | { ok: false, message }`
  - `POST /api/integrations/huggingface/forget` — ответ `{ ok: true }`
  - `settingsPage({ …, drawing })`, где `drawing = { hasToken, models, defaultModels } | null`
  - разметка: `data-block="drawing"`, `data-drawing-form`, `data-drawing-check`, `data-drawing-forget`

- [ ] **Step 1: Write the failing tests**

`test/drawing-routes.test.js`:

```js
// Настройки рисования через кабинет. Главное — токен не возвращается наружу
// ни ответом API, ни страницей, а проверка токена не рисует картинку.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { loadDrawingSettings } from '../src/services/drawing-settings.js';
import { WHOAMI_URL } from '../src/services/images.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://portal.example',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', botId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: '' },
  redis: { url: 'redis://redis:6379', prefix: 'portal:' },
  yandex: { apiKey: '', folderId: '' },
  yandexOauth: { clientId: '', clientSecret: '' },
  tokenEncryptionKey: 'a'.repeat(64),
  media: { dir: '/tmp', ttlHours: 168 },
  youtube: { clientId: '', clientSecret: '', redirectUri: '', mode: 'semi' }
};

async function adminHeaders(pool) {
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'admin' }, config.jwtSecret)}`
  };
}

test('токен сохраняется, а наружу не отдаётся ни ответом, ни страницей', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const headers = await adminHeaders(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/integrations/huggingface/app`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ token: 'hf_secret_token', models: '' })
      });
      assert.equal(response.status, 200);
      const answer = await response.json();
      assert.deepEqual(answer, { models: '', hasToken: true });

      const page = await (await fetch(`${base}/settings`, { headers })).text();
      assert.match(page, /data-block="drawing"/);
      assert.match(page, /сохранён — оставьте пустым/);
      assert.ok(!page.includes('hf_secret_token'), 'токен попал в разметку');
    });
    assert.equal((await loadDrawingSettings(pool, config)).token, 'hf_secret_token');
  });
});

test('проверка токена спрашивает, чей он, и не рисует', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const headers = await adminHeaders(pool);
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, auth: options?.headers?.Authorization });
      return { ok: true, status: 200, json: async () => ({ name: 'boris' }) };
    };
    const app = finalize(createApp({ config, pool, fetchImpl }));
    await withServer(app, async (base) => {
      await fetch(`${base}/api/integrations/huggingface/app`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ token: 'hf_secret_token', models: '' })
      });
      const response = await fetch(`${base}/api/integrations/huggingface/check`, {
        method: 'POST',
        headers
      });
      assert.deepEqual(await response.json(), { ok: true, account: 'boris' });
    });
    assert.deepEqual(calls, [{ url: WHOAMI_URL, auth: 'Bearer hf_secret_token' }]);
  });
});

test('убранный токен выключает рисование', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const headers = await adminHeaders(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      await fetch(`${base}/api/integrations/huggingface/app`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ token: 'hf_secret_token', models: '' })
      });
      const response = await fetch(`${base}/api/integrations/huggingface/forget`, {
        method: 'POST',
        headers
      });
      assert.equal(response.status, 200);
    });
    assert.equal((await loadDrawingSettings(pool, config)).token, '');
  });
});

test('зрителю настройки рисования недоступны', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(
      `INSERT INTO users (display_name, role) VALUES ('Зритель', 'user') RETURNING id`
    );
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/integrations/huggingface/app`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'user' }, config.jwtSecret)}`
        },
        body: JSON.stringify({ token: 'hf_x', models: '' })
      });
      assert.equal(response.status, 403);
    });
  });
});
```

В `test/html.test.js` дописать в конец файла:

```js
test('блок рисования видит только автор, и токен в разметку не попадает', async () => {
  const { settingsPage } = await import('../src/views/settings.js');
  const drawing = {
    hasToken: true,
    models: '',
    defaultModels: 'black-forest-labs/FLUX.1-schnell'
  };
  const author = settingsPage({ config, user: { displayName: 'Автор', role: 'admin' }, drawing });
  assert.match(author, /<details class="card settings-block" data-block="drawing" open>/);
  assert.match(author, /data-drawing-check/);
  assert.match(author, /data-drawing-forget/);
  assert.match(author, /black-forest-labs\/FLUX\.1-schnell/);
  // Как получить токен — прямо в блоке: иначе автор пойдёт искать инструкцию.
  assert.match(author, /Make calls to Inference Providers/);

  const withoutToken = settingsPage({
    config,
    user: { displayName: 'Автор', role: 'admin' },
    drawing: { ...drawing, hasToken: false }
  });
  // Проверять и убирать нечего, пока токена нет.
  assert.ok(!withoutToken.includes('data-drawing-check'));

  const viewer = settingsPage({ config, user: { displayName: 'Зритель', role: 'user' }, drawing: null });
  assert.ok(!viewer.includes('data-block="drawing"'), 'зрителю показали рисование');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app my_portal-worker node --test test/drawing-routes.test.js test/html.test.js`
Expected: FAIL — маршрутов нет (404), блока `drawing` в разметке нет.

- [ ] **Step 3: Write the implementation**

`src/routes/integrations.js` — после импорта из `'../services/platforms/instagram-auth.js'` (заканчивается `} from '../services/platforms/instagram-auth.js';`) добавить:

```js
import {
  loadDrawingSettings,
  saveDrawingSettings,
  forgetDrawingToken
} from '../services/drawing-settings.js';
import { checkDrawingToken } from '../services/images.js';
```

и перед строкой `  // Отключить канал: токены забываем, ключи приложения оставляем — заводить их` вставить:

```js
  // Рисование через Hugging Face: токен и список моделей. Номера приложения у
  // Hugging Face нет — только токен, поэтому маршрут свой, а не общий с
  // площадками.
  router.post('/huggingface/app', async (req, res) => {
    await saveDrawingSettings(pool, config, {
      // Пустое поле означает «не менять»: показать сохранённый токен нельзя.
      token: String(req.body?.token ?? ''),
      models: String(req.body?.models ?? '')
    });
    const stored = await loadDrawingSettings(pool, config);
    // Сам токен наружу не отдаём — только то, что он есть.
    res.json({ models: stored.modelsText, hasToken: Boolean(stored.token) });
  });

  // Проверка токена бесплатным запросом: картинку не рисует, кредиты не тратит.
  router.post('/huggingface/check', async (req, res) => {
    const { token } = await loadDrawingSettings(pool, config);
    res.json(await checkDrawingToken(token, fetchImpl));
  });

  router.post('/huggingface/forget', async (req, res) => {
    await forgetDrawingToken(pool);
    res.json({ ok: true });
  });

```

`src/routes/pages.js`:
- после строки `import { youtubeApp, channelApp, loadPlatformApp } from '../services/platform-apps.js';` добавить
  `import { loadDrawingSettings, DEFAULT_DRAWING_MODELS } from '../services/drawing-settings.js';`
- в `router.get('/settings', …)` перед строкой `    res.type('html').send(` (та, за которой идёт `      settingsPage({`) вставить:

```js
    // Рисование: токен Hugging Face и модели. Сам токен наружу не отдаём —
    // только то, что он есть.
    const drawing =
      user?.role === 'admin'
        ? await (async () => {
            const stored = await loadDrawingSettings(pool, config);
            return {
              hasToken: Boolean(stored.token),
              models: stored.modelsText,
              defaultModels: DEFAULT_DRAWING_MODELS
            };
          })()
        : null;
```

- в вызов `settingsPage({` после строки `        shortPlatforms,` добавить строку `        drawing,`.

`src/views/settings.js`:
- в параметры `settingsPage({` после `  shortPlatforms = [],` добавить `  drawing = null,`.
- перед строкой `<details class="card settings-block" data-block="sources" open>` вставить:

```js
${
  drawing
    ? `<details class="card settings-block" data-block="drawing" open>
  <summary><h2>Рисование (Hugging Face)</h2></summary>
  <p class="hint">
    Обложки уроков рисует FLUX через Hugging Face. Токен: huggingface.co →
    Settings → Access Tokens → Create new token → тип Fine-grained → право
    «Make calls to Inference Providers». Бесплатно даётся $0.10 в месяц — это
    около тридцати обложек, карта не нужна.
  </p>
  <form data-drawing-form>
    <label>Токен Hugging Face
      <input name="token" type="password" autocomplete="off" maxlength="200"
             placeholder="${drawing.hasToken ? 'сохранён — оставьте пустым, чтобы не менять' : 'hf_…'}"
             ${drawing.hasToken ? '' : 'required'}>
    </label>
    <label>Модели через запятую — пусто означает список по умолчанию
      <input name="models" value="${escapeHtml(drawing.models)}" autocomplete="off"
             maxlength="500" placeholder="${escapeHtml(drawing.defaultModels)}">
    </label>
    <div class="form-row">
      <button class="button-brand" type="submit">Сохранить</button>
      ${
        drawing.hasToken
          ? `<button class="button" type="button" data-drawing-check>Проверить</button>
             <button class="button" type="button" data-drawing-forget>Убрать токен</button>`
          : ''
      }
    </div>
  </form>
  <p class="hint">
    ${
      drawing.hasToken
        ? 'Токен сохранён: кнопка «Нарисовать обложку» у урока работает.'
        : 'Пока токена нет, рисование выключено.'
    }
  </p>
</details>

`
    : ''
}
```

`public/app.js` — перед строкой `  const youtubeAppForm = document.querySelector('[data-youtube-app]');` вставить:

```js
  /* --- Рисование: токен Hugging Face -------------------------------------- */

  // Токен уходит через API, а не отправкой формы: иначе браузер увёз бы его
  // GET-ом в адресную строку — в историю и в журнал сервера.
  const drawingForm = document.querySelector('[data-drawing-form]');
  drawingForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = new FormData(drawingForm);
    const button = drawingForm.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      const answer = await request('/api/integrations/huggingface/app', {
        method: 'POST',
        body: JSON.stringify({ token: fields.get('token'), models: fields.get('models') })
      });
      if (!answer) return;
      toast('Настройки рисования сохранены.');
      setTimeout(() => location.reload(), 1200);
    } catch (error) {
      toast(`Не сохранилось: ${error.message}`, true);
    } finally {
      button.disabled = false;
    }
  });

  // Проверка бесплатная: Hugging Face отвечает, чей это токен, и ничего не рисует.
  const drawingCheck = document.querySelector('[data-drawing-check]');
  drawingCheck?.addEventListener('click', async () => {
    drawingCheck.disabled = true;
    try {
      const answer = await request('/api/integrations/huggingface/check', { method: 'POST' });
      if (!answer) return;
      if (answer.ok) toast(`Токен рабочий${answer.account ? `, аккаунт ${answer.account}` : ''}.`);
      else toast(answer.message, true);
    } catch (error) {
      toast(`Не проверилось: ${error.message}`, true);
    } finally {
      drawingCheck.disabled = false;
    }
  });

  const drawingForget = document.querySelector('[data-drawing-forget]');
  drawingForget?.addEventListener('click', async () => {
    drawingForget.disabled = true;
    try {
      const answer = await request('/api/integrations/huggingface/forget', { method: 'POST' });
      if (!answer) return;
      toast('Токен убран, рисование выключено.');
      setTimeout(() => location.reload(), 1200);
    } catch (error) {
      toast(`Не убралось: ${error.message}`, true);
      drawingForget.disabled = false;
    }
  });

```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app my_portal-worker node --test test/drawing-routes.test.js test/html.test.js test/platform-app-routes.test.js`
Expected: PASS, 0 пропущенных. Прежний тест порядка блоков в `html.test.js` зелёный: без `drawing` блока нет.

- [ ] **Step 5: Commit**

```bash
git add src/routes/integrations.js src/routes/pages.js src/views/settings.js public/app.js test/drawing-routes.test.js test/html.test.js
git commit -m "feat: в настройках есть блок рисования — токен Hugging Face, проверка, модели"
```

---

### Task 5: Кнопка «Нарисовать обложку» знает про токен

**Files:**
- Modify: `src/routes/admin.js` (импорт; проверка в `POST /lessons/:slug/cover-image`)
- Modify: `src/routes/pages.js` (признак `drawingReady` в вызове `adminReviewPage`)
- Modify: `src/views/admin-review.js` (параметр; кнопка; подсказка; убрать подсказку про квоту Google)
- Test: `test/cover-image.test.js`

**Interfaces:**
- Consumes: `loadDrawingSettings`, `saveDrawingSettings` (Task 1).
- Produces: `adminReviewPage({ …, drawingReady })`; маршрут без токена отвечает 409.

- [ ] **Step 1: Write the failing tests**

Дописать в конец `test/cover-image.test.js`:

```js
test('без токена рисование не ставится в очередь, а кнопка это объясняет', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { headers } = await seed(pool, config);
    const added = [];
    const app = finalize(createApp({ config, pool, queue: { add: async (name) => added.push(name) } }));
    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/admin/lessons/urok/cover-image`, {
        method: 'POST',
        headers
      });
      assert.equal(response.status, 409);
      assert.match((await response.json()).error, /токен Hugging Face/);

      const page = await (
        await fetch(`${base}/admin/lesson/urok`, { headers: { Accept: 'text/html', ...headers } })
      ).text();
      assert.match(page, /data-draw-cover="urok"\s+disabled title="Добавьте токен Hugging Face в настройках"/);
      assert.match(page, /href="\/settings"/);
    });
    assert.deepEqual(added, [], 'задача ушла в очередь без токена');
  });
});

test('с токеном кнопка активна, а про квоту Google речи нет', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    await saveDrawingSettings(pool, config, { token: 'hf_secret_token', models: '' });
    await pool.query(
      `UPDATE lessons SET generated = jsonb_set(generated, '{sideError}', $1::jsonb) WHERE id = $2`,
      [JSON.stringify({ step: 'makeCoverImage', message: 'You exceeded your current quota' }), lesson.id]
    );
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const page = await (
        await fetch(`${base}/admin/lesson/urok`, { headers: { Accept: 'text/html', ...headers } })
      ).text();
      assert.match(page, /data-draw-cover="urok"\s*>/);
      assert.ok(!page.includes('квота Google'), 'осталась подсказка про Google');
    });
  });
});
```

(Поле `error` — так `src/middleware/errors.js` отдаёт `PublicError` в JSON: `res.status(status).json({ error: message })`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app my_portal-worker node --test test/cover-image.test.js`
Expected: FAIL — маршрут отвечает 200 и ставит задачу; на странице нет подсказки про токен, а подсказка про Google есть.

- [ ] **Step 3: Write the implementation**

`src/routes/admin.js`:
- после строки `import { youtubeApp, channelApp } from '../services/platform-apps.js';` добавить
  `import { loadDrawingSettings } from '../services/drawing-settings.js';`
- в `router.post('/lessons/:slug/cover-image', …)` сразу после строки
  `    if (!lesson.title) throw new PublicError('Сначала нужен заголовок — по нему и рисуем', 409);`
  добавить:

```js
    // Без токена задача упала бы уже в очереди, и автор узнал бы об этом
    // минутой позже. Говорим сразу.
    if (!(await loadDrawingSettings(pool, config)).token) {
      throw new PublicError('Рисование не настроено — добавьте токен Hugging Face в настройках', 409);
    }
```

`src/routes/pages.js` — в вызове `adminReviewPage({` после строки `        transcript: transcript[0]?.text ?? null,` добавить:

```js
        // Без токена рисования кнопка неактивна и объясняет, где его взять.
        drawingReady: Boolean((await loadDrawingSettings(pool, config)).token),
```

(импорт `loadDrawingSettings` в `pages.js` уже добавлен в задаче 4).

`src/views/admin-review.js`:
- в параметры `adminReviewPage({` после `  sideError = null,` добавить `  drawingReady = false,`.
- заменить кнопку:

```js
    <button class="button" type="button" data-draw-cover="${escapeHtml(lesson.slug)}"
      ${lesson.title ? '' : 'disabled title="Сначала нужен заголовок"'}>
      Нарисовать обложку
    </button>
```

на

```js
    <button class="button" type="button" data-draw-cover="${escapeHtml(lesson.slug)}"
      ${
        !lesson.title
          ? 'disabled title="Сначала нужен заголовок"'
          : drawingReady
            ? ''
            : 'disabled title="Добавьте токен Hugging Face в настройках"'
      }>
      Нарисовать обложку
    </button>
```

- сразу после закрывающего `</div>` этого ряда кнопок (строка после `data-cover-upload="${escapeHtml(lesson.slug)}">`) вставить:

```js
  ${
    drawingReady
      ? ''
      : `<p class="hint">
           Рисование выключено: <a href="/settings">добавьте токен Hugging Face в настройках</a>.
         </p>`
  }
```

- в блоке `sideError && sideError.step === 'makeCoverImage'` удалить вложенное выражение целиком:

```js
           ${
             /429|quota/i.test(sideError.message)
               ? '<br>Это квота Google: рисование включается оплатой на проекте, к которому привязан ключ.'
               : ''
           }
```

(понятные тексты отказов теперь даёт сам слой рисования — `describeDrawingFailure`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app my_portal-worker node --test test/cover-image.test.js test/admin-review.test.js`
Expected: PASS, 0 пропущенных.

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.js src/routes/pages.js src/views/admin-review.js test/cover-image.test.js
git commit -m "feat: без токена Hugging Face кнопка рисования неактивна и говорит, где его взять"
```

---

### Task 6: Полная проверка, пуш, выкатка, живая проверка

**Files:** нет новых.

- [ ] **Step 1: Полный прогон и линтер**

Run: `docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app my_portal-worker sh -c 'node --test --test-concurrency=8 "test/**/*.test.js"; npm run lint'`
Expected: `fail 0`, `skipped 0`, линтер без ошибок. Пропущенные тесты — не зелёный прогон: значит, нет сети или образа.

- [ ] **Step 2: Пуш и выкатка**

```bash
git push origin main
docker compose up -d --build
docker ps --filter name=my_portal --format '{{.Names}}\t{{.Status}}'
```

Expected: `my_portal-api-1` и `my_portal-worker-1` в состоянии `Up`.

- [ ] **Step 3: Проверка живого сайта без токена**

```bash
curl -s https://soloaijourney.online/settings | grep -c 'data-block='
```

Блок рисования виден только автору, поэтому снаружи проверяется лишь то, что страница отдаётся. Сообщить заказчику в Telegram (`scripts/tg-send.sh`): выкачено; что открыть; как получить токен (шаги из блока).

- [ ] **Step 4: Живая проверка с токеном заказчика**

Заказчик вставляет токен в блок и жмёт «Проверить», затем «Нарисовать обложку» у урока. После этого по журналу воркера и базе проверить:

```bash
docker logs --since 10m my_portal-worker-1 2>&1 | grep -iE "makeCoverImage|обложк|Hugging" | tail -20
```

и что у урока появилась `cover-drawn.*` в `assets`. Открытые вопросы спеки закрываются здесь:
1. Если Nscale отказал из-за `size` (400 с упоминанием size/width/height) или картинка не 16:9 — выполнить задачу 7.
2. Если кнопка «Проверить» показала «Токен рабочий» без имени аккаунта — поле имени в ответе `whoami-v2` называется иначе: посмотреть живой ответ и поправить `checkDrawingToken` и тест.

Итог — в Telegram: что проверено живьём, что нет.

---

### Task 7 (только если задача 6 показала, что 16:9 не принимается): обрезка до 16:9

**Files:**
- Modify: `src/services/images.js` (размер по умолчанию — квадрат, обрезка после разбора ответа)
- Test: `test/images.test.js`

- [ ] **Step 1: Write the failing test**

Дописать в `test/images.test.js`:

```js
test('квадрат от поставщика обрезается до 16:9', async () => {
  const cropped = [];
  const images = createImages(
    settings(),
    async () => withImage(),
    { cropToWide: async (bytes) => { cropped.push(bytes.length); return bytes; } }
  );
  await images.generate('a lighthouse');
  assert.equal(cropped.length, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app my_portal-worker node --test test/images.test.js`
Expected: FAIL — `cropToWide` не вызывается.

- [ ] **Step 3: Implement**

В `src/services/images.js`:
- `COVER_SIZE` поменять на тот размер, который принял поставщик в задаче 6 (например, `'1024x1024'`), и поправить ожидание в тесте `'в запросе модель, размер 16:9…'`.
- добавить обрезку через ffmpeg (он есть в образе воркера):

```js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const run = promisify(execFile);

/**
 * Обрезает картинку до 16:9 по центру. Надписей на обложке нет по замыслу,
 * так что обрезка ничего не портит, а карточка урока и превью ссылки ждут
 * именно 16:9.
 */
export async function cropToWide(bytes, type) {
  const dir = await mkdtemp(path.join(tmpdir(), 'cover-crop-'));
  try {
    const input = path.join(dir, `in.${type}`);
    const output = path.join(dir, `out.${type}`);
    await writeFile(input, bytes);
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-vf', 'crop=iw:iw*9/16', output]);
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
```

- сигнатуру `createImages` расширить третьим параметром `{ cropToWide: crop = cropToWide } = {}` и в `generate` при успехе вместо `return { ...parseDrawingResponse(…), model }` делать:

```js
        if (response.ok) {
          const { bytes, type } = parseDrawingResponse(await response.json());
          return { bytes: await crop(bytes, type), type, model };
        }
```

- [ ] **Step 4: Run to verify it passes**, затем полный прогон из задачи 6, шаг 1.

- [ ] **Step 5: Commit, push, deploy**

```bash
git add src/services/images.js test/images.test.js
git commit -m "fix: обложка от Hugging Face обрезается до 16:9"
git push origin main
docker compose up -d --build
```
