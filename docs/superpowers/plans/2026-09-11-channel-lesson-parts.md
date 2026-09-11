# Урок в каналы частями видео — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** с экрана урока отдельной кнопкой отправлять урок в каналы Telegram и MAX самим видео — частями под одним сообщением со списком глав.

**Architecture:** свой сервер Telegram Bot API в общем слое ClaudeDocker снимает предел бота до 2000 МБ; все обращения бота портала идут по одной настройке адреса. Запись режется без пережатия, по размеру и главам, с примеркой каждой части; главы переводятся на шкалу смонтированной записи по сохранённым отрезкам монтажа. Пост с частями — отдельные «площадки» `telegram_parts` и `max_parts` со своими кнопками, состояниями и шагом очереди.

**Tech Stack:** Node 24 (`fs.openAsBlob`), Express, PostgreSQL, BullMQ, ffmpeg/ffprobe, `node:test`; образ `aiogram/telegram-bot-api:10.3`.

**Spec:** `docs/superpowers/specs/2026-09-11-channel-lesson-parts-design.md`

## Global Constraints

- Имена — только латиницей; комментарии и тексты для человека — по-русски. Новый файл начинается с русского комментария: задача, зачем так, откуда вызывается.
- Образ сервера Bot API — ровно `aiogram/telegram-bot-api:10.3`; внутри общей сети адрес — `http://shared-telegram-bot-api-1:8081`.
- Пределы частей: Telegram (свой сервер) — 2000 МБ, MAX — 250 МБ; запас — 5% (`SIZE_MARGIN = 0.95`).
- Альбом Telegram — не больше 10 видео; подпись — не больше 1024 знаков. Текст MAX — не больше 4000 знаков.
- Резка — без пережатия (`-c copy`). Видео в `FormData` — только через `fs.openAsBlob` (файл не читается в память целиком: на сервере 3,8 ГБ на всё).
- Ключи `api_id`/`api_hash` в репозитории и в переписке не появляются — только в `.env` на сервере.
- Отдельный тест: `docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app my_portal-worker node --test test/<файл>.test.js`
- Полная проверка перед фиксацией (по `CLAUDE.md`, в несколько потоков): `docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app my_portal-worker sh -c 'node --test --test-concurrency=8 "test/**/*.test.js"; npm run lint'`
- После каждой задачи: полная проверка → коммит → `git push` → `docker compose up -d --build` (правило выкатки после коммита). До задачи 12 `TELEGRAM_API_URL` пуст — бот работает через облако, поведение сайта не меняется.

---

### Task 1: Адрес Bot API в портале и проверка связи

**Files:**
- Modify: `src/config.js` (раздел `telegram`)
- Modify: `src/services/notify/telegram.js`
- Modify: `src/services/platforms/telegram-channel.js`
- Modify: `src/worker.js` (адаптер Telegram)
- Modify: `src/routes/integrations.js` (вызовы `checkTelegramChannel`, новый маршрут)
- Modify: `src/views/settings.js` (кнопка в блоке канала Telegram), `public/app.js`
- Modify: `.env.example`
- Test: `test/telegram-api-url.test.js` (новый)

**Interfaces:**
- Produces:
  - `config.telegram.apiUrl: string` — без хвостового `/`, по умолчанию `https://api.telegram.org`.
  - `DEFAULT_API_URL = 'https://api.telegram.org'` и `botMethod(apiUrl, token, name) → string` из `telegram-channel.js`.
  - У `checkTelegramChannel`, `postToTelegram`, `postVideoToTelegram`, `editTelegramPost` — параметр `apiUrl = DEFAULT_API_URL`.
  - `checkBotApi({ apiUrl, token, fetchImpl }) → Promise<{ ok: true, username } | { ok: false, message }>`.
  - `POST /api/integrations/telegram/check-api` → ответ `checkBotApi`.
  - Разметка: `data-telegram-check-api` в блоке канала Telegram.

- [ ] **Step 1: Write the failing test**

`test/telegram-api-url.test.js`:

```js
// Адрес сервера Telegram Bot API. Главное — все обращения бота портала идут по
// одной настройке: бот, переехавший на свой сервер, в облако ходить не должен.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { createTelegramChannel } from '../src/services/notify/telegram.js';
import {
  postToTelegram,
  checkTelegramChannel,
  checkBotApi,
  DEFAULT_API_URL
} from '../src/services/platforms/telegram-channel.js';

const ok = (result) => ({ ok: true, status: 200, json: async () => ({ ok: true, result }) });

test('без настройки адрес — облако Telegram, со своим — свой и без хвостового слэша', () => {
  const base = { ...process.env, JWT_SECRET: 'x'.repeat(32), PUBLIC_BASE_URL: 'https://p.example' };
  assert.equal(loadConfig({ ...base, TELEGRAM_API_URL: '' }).telegram.apiUrl, DEFAULT_API_URL);
  assert.equal(
    loadConfig({ ...base, TELEGRAM_API_URL: 'http://shared-telegram-bot-api-1:8081/' }).telegram.apiUrl,
    'http://shared-telegram-bot-api-1:8081'
  );
});

test('посты в канал идут по настроенному адресу', async () => {
  const urls = [];
  await postToTelegram({
    apiUrl: 'http://bot-api:8081',
    token: 't',
    channel: '@kanal',
    photoUrl: null,
    caption: 'текст',
    fetchImpl: async (url) => (urls.push(url), ok({ message_id: 1 }))
  });
  await checkTelegramChannel({
    apiUrl: 'http://bot-api:8081',
    token: 't',
    channel: '@kanal',
    fetchImpl: async (url) => (urls.push(url), ok({ username: 'bot' }))
  });
  assert.ok(urls.every((url) => url.startsWith('http://bot-api:8081/bott/')), urls.join('\n'));
});

test('уведомления идут по тому же адресу', async () => {
  let seen = null;
  const send = createTelegramChannel(
    { publicBaseUrl: 'https://p.example', telegram: { botToken: 't', apiUrl: 'http://bot-api:8081' } },
    async (url) => ((seen = url), { ok: true })
  );
  await send(1, { title: 'Т', body: 'б', url: '/' });
  assert.equal(seen, 'http://bot-api:8081/bott/sendMessage');
});

test('проверка связи отвечает именем бота или причиной', async () => {
  const good = await checkBotApi({ apiUrl: 'http://bot-api:8081', token: 't', fetchImpl: async () => ok({ username: 'solo_bot' }) });
  assert.deepEqual(good, { ok: true, username: 'solo_bot' });

  const down = await checkBotApi({
    apiUrl: 'http://bot-api:8081',
    token: 't',
    fetchImpl: async () => {
      throw new Error('connect ECONNREFUSED');
    }
  });
  assert.equal(down.ok, false);
  assert.match(down.message, /сервер Telegram Bot API недоступен/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app my_portal-worker node --test test/telegram-api-url.test.js`
Expected: FAIL — `checkBotApi`/`DEFAULT_API_URL` не экспортируются.

- [ ] **Step 3: Write the implementation**

`src/config.js` — в `telegram: { … }` после `channelId` добавить:

```js
      // Адрес сервера Telegram Bot API. Пусто — облако Telegram. Свой сервер
      // (общий слой ClaudeDocker) снимает предел бота с 50 МБ до 2000 МБ на
      // файл; бот, переехавший на него, в облако ходить не должен — поэтому
      // адрес один на все обращения бота портала.
      apiUrl: (env.TELEGRAM_API_URL ?? '').replace(/\/+$/, '') || 'https://api.telegram.org'
```

(поставить запятую после `channelId: env.TELEGRAM_CHANNEL_ID ?? ''`).

`src/services/notify/telegram.js` — строку запроса заменить на:

```js
    const apiUrl = config.telegram.apiUrl ?? 'https://api.telegram.org';
    const res = await fetchImpl(`${apiUrl}/bot${config.telegram.botToken}/sendMessage`, {
```

`src/services/platforms/telegram-channel.js`:
- `const API = 'https://api.telegram.org/bot';` заменить на:

```js
export const DEFAULT_API_URL = 'https://api.telegram.org';

/**
 * Адрес метода Bot API. Сервер — облако Telegram или свой (общий слой):
 * свой принимает от бота файлы до 2000 МБ вместо 50.
 */
export function botMethod(apiUrl, token, name) {
  return `${apiUrl || DEFAULT_API_URL}/bot${token}/${name}`;
}
```

- во всех четырёх функциях добавить параметр `apiUrl = DEFAULT_API_URL` и заменить `` `${API}${token}/getMe` `` → `botMethod(apiUrl, token, 'getMe')`, `` `${API}${token}/getChat?chat_id=…` `` → `` `${botMethod(apiUrl, token, 'getChat')}?chat_id=${encodeURIComponent(channel)}` ``, `` `${API}${token}/${method}` `` → `botMethod(apiUrl, token, method)`, `` `${API}${token}/sendVideo` `` → `botMethod(apiUrl, token, 'sendVideo')`.
- добавить в конец:

```js
/**
 * Проверка связи с сервером Bot API: getMe по настроенному адресу.
 * Нужна после переезда бота на свой сервер: упавший сервер — это бот, который
 * молчит, и узнать об этом лучше кнопкой в настройках, чем по пропавшим постам.
 * Вызывается из src/routes/integrations.js.
 */
export async function checkBotApi({ apiUrl = DEFAULT_API_URL, token, fetchImpl = fetch }) {
  let response;
  try {
    response = await fetchImpl(botMethod(apiUrl, token, 'getMe'), {
      signal: AbortSignal.timeout(10_000)
    });
  } catch (error) {
    return { ok: false, message: `сервер Telegram Bot API недоступен: ${error.message}` };
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    return { ok: false, message: `Сервер ответил ${response.status}: ${body.description ?? 'без объяснения'}` };
  }
  const body = await response.json().catch(() => ({}));
  return { ok: true, username: body.result?.username ?? '' };
}
```

`src/worker.js` — адаптер Telegram заменить на:

```js
// Адрес Bot API один на все обращения бота портала: облако или свой сервер.
const telegramApi = { apiUrl: config.telegram.apiUrl };
const telegramAdapter = {
  app: channelApp,
  post: (args) => postToTelegram({ ...args, ...telegramApi }),
  postVideo: (args) => postVideoToTelegram({ ...args, ...telegramApi }),
  edit: (args) => editTelegramPost({ ...args, ...telegramApi })
};
```

`src/routes/integrations.js`:
- оба вызова `checkTelegramChannel({ token, channel })` → `checkTelegramChannel({ token, channel, apiUrl: config.telegram.apiUrl, fetchImpl })`;
- импорт: добавить `checkBotApi` к импорту из `'../services/platforms/telegram-channel.js'`;
- перед комментарием `// Отключить канал: токены забываем…` добавить:

```js
  // Проверка связи с сервером Bot API — тем ботом, который постит в канал.
  router.post('/telegram/check-api', async (req, res) => {
    const app = await channelApp(pool, config, 'telegram');
    const token = app.token || config.telegram.botToken;
    if (!token) throw new PublicError('Бот Telegram не настроен', 400);
    res.json(await checkBotApi({ apiUrl: config.telegram.apiUrl, token, fetchImpl }));
  });
```

`src/views/settings.js` — в разметке канала (`data-channel-app`), в `<div class="form-row">` после вставки с кнопкой `data-channel-reset`:

```js
      ${
        channel.name === 'telegram'
          ? '<button class="button" type="button" data-telegram-check-api>Проверить связь</button>'
          : ''
      }
```

`public/app.js` — перед `/* --- Рисование картинки к новости` вставить:

```js
  // Проверка связи с сервером Bot API: после переезда бота на свой сервер
  // упавший сервер — это бот, который молчит.
  const telegramCheckApi = document.querySelector('[data-telegram-check-api]');
  telegramCheckApi?.addEventListener('click', async () => {
    telegramCheckApi.disabled = true;
    try {
      const answer = await request('/api/integrations/telegram/check-api', { method: 'POST' });
      if (!answer) return;
      if (answer.ok) toast(`На связи: бот @${answer.username}.`);
      else toast(answer.message, true);
    } catch (error) {
      toast(`Не проверилось: ${error.message}`, true);
    } finally {
      telegramCheckApi.disabled = false;
    }
  });

```

`.env.example` — рядом с `TELEGRAM_CHANNEL_ID=` добавить:

```ini
# Адрес сервера Telegram Bot API. Пусто — облако Telegram (предел бота 50 МБ).
# Свой сервер из общего слоя: http://shared-telegram-bot-api-1:8081 — до 2000 МБ.
TELEGRAM_API_URL=
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app my_portal-worker node --test test/telegram-api-url.test.js test/publish-channel.test.js test/channels-api.test.js`
Expected: PASS, 0 пропущенных.

- [ ] **Step 5: Commit, push, deploy**

```bash
git add src/config.js src/services/notify/telegram.js src/services/platforms/telegram-channel.js src/worker.js src/routes/integrations.js src/views/settings.js public/app.js .env.example test/telegram-api-url.test.js
git commit -m "feat: адрес сервера Telegram Bot API — одна настройка на все обращения бота"
git push origin main && docker compose up -d --build
```

---

### Task 2: Сервер Bot API в общем слое и в standalone

**Files:**
- Modify: `/home/boris/projects/ClaudeDocker/docker-compose.yml`, `/home/boris/projects/ClaudeDocker/.env.example`, `/home/boris/projects/ClaudeDocker/README.md`
- Modify: `docker-compose.yml` (портал), `.env.example` (портал)

**Interfaces:** Produces: сервис `telegram-bot-api` (контейнер `shared-telegram-bot-api-1`), переменные `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`.

- [ ] **Step 1: Сервис в общем слое**

`ClaudeDocker/docker-compose.yml` — перед `  portainer:` вставить:

```yaml
  # Свой сервер Telegram Bot API. Нужен тем, кому мало 50 МБ на файл от бота:
  # в локальном режиме (TELEGRAM_LOCAL) он принимает файлы до 2000 МБ. Общий,
  # потому что ботов на сервере несколько, а сервер Bot API может быть один.
  # Проекты обращаются по полному имени: http://shared-telegram-bot-api-1:8081
  # (короткие имена в общих сетях однажды указали на два разных сервера).
  # Бот переезжает на него после logOut у облачного Bot API — см. README.
  telegram-bot-api:
    image: aiogram/telegram-bot-api:10.3
    environment:
      - TELEGRAM_API_ID=${TELEGRAM_API_ID}
      - TELEGRAM_API_HASH=${TELEGRAM_API_HASH}
      - TELEGRAM_LOCAL=1
    volumes:
      - telegram_bot_api_data:/var/lib/telegram-bot-api
    networks: [data]
    restart: unless-stopped

```

и в `volumes:` после `  redis_data:` — строку `  telegram_bot_api_data:`.

`ClaudeDocker/.env.example` — в конец:

```ini

# Свой сервер Telegram Bot API: ключи приложения с my.telegram.org →
# API development tools. Реальные значения только в .env: в git и в переписку
# они не попадают.
TELEGRAM_API_ID=
TELEGRAM_API_HASH=
```

`ClaudeDocker/README.md` — в таблицу «Что здесь» после строки `redis`:

```markdown
| `telegram-bot-api` | aiogram 10.3 | свой сервер Telegram Bot API: файлы от бота до 2000 МБ |
```

и в конец раздела «Подводные камни» пункт:

```markdown
- **Бот на своём сервере Bot API.** Перед переездом — `logOut` у облака:
  `curl -s https://api.telegram.org/bot<токен>/logOut`. После него бот сразу
  работает на своём сервере, а в облако вернуться может только через 10 минут.
  Смешивать облако и свой сервер для одного бота нельзя.
```

- [ ] **Step 2: Сервис в standalone портала**

`docker-compose.yml` портала — после сервиса `redis` (перед `volumes:`):

```yaml
  # Свой сервер Telegram Bot API для чистой машины. На VPS его даёт общий слой,
  # и профиль standalone там не включается.
  telegram-bot-api:
    image: aiogram/telegram-bot-api:10.3
    profiles: [standalone]
    environment:
      TELEGRAM_API_ID: ${TELEGRAM_API_ID:-}
      TELEGRAM_API_HASH: ${TELEGRAM_API_HASH:-}
      TELEGRAM_LOCAL: 1
    volumes:
      - portal_telegram_bot_api:/var/lib/telegram-bot-api
    restart: unless-stopped
```

и том `  portal_telegram_bot_api:` в `volumes:`.

`.env.example` портала — под `TELEGRAM_API_URL=`:

```ini
# Только для standalone (своя машина без общего слоя): ключи для своего
# сервера Bot API с my.telegram.org. На VPS они лежат в .env общего слоя.
TELEGRAM_API_ID=
TELEGRAM_API_HASH=
```

- [ ] **Step 3: Проверить конфигурацию**

Run: `docker compose -f /home/boris/projects/ClaudeDocker/docker-compose.yml config -q && docker compose config -q && echo ok`
Expected: `ok`. Сервис общего слоя **не поднимать** до задачи 12: без ключей он уходит в перезапуски.

- [ ] **Step 4: Commit**

```bash
git -C /home/boris/projects/ClaudeDocker add docker-compose.yml .env.example README.md
git -C /home/boris/projects/ClaudeDocker commit -m "feat: общий сервер Telegram Bot API — файлы от бота до 2000 МБ"
git -C /home/boris/projects/ClaudeDocker push
git add docker-compose.yml .env.example
git commit -m "chore: свой сервер Telegram Bot API под профилем standalone"
git push origin main
```

(В ClaudeDocker есть чужая незакоммиченная правка `projects/my_portal/docker-compose.yml` — не добавлять её.)

---

### Task 3: Отрезки монтажа сохраняются, монтаж ставит опорный кадр каждые 2 секунды

**Files:**
- Create: `src/services/trim-ranges.js`
- Modify: `src/jobs/trim-pauses.js`, `src/services/lessons.js` (`toLesson`), `src/lib/ffmpeg.js` (`ffmpegArgsForTrim`)
- Test: `test/trim-ranges.test.js` (новый), `test/trim-pauses-real.test.js`

**Interfaces:**
- Produces:
  - `lesson.trimRanges: Array<{ startedMs, endedMs }> | null`
  - `saveTrimRanges(pool, lessonId, ranges) → Promise<void>`
  - `ensureTrimRanges(config, pool, lesson, { detect = detectSilence }) → Promise<ranges>`

- [ ] **Step 1: Write the failing tests**

`test/trim-ranges.test.js`:

```js
// Отрезки монтажа. Без них главы нельзя перевести на смонтированную запись:
// монтаж их вычислял и выбрасывал, а по звуковой дорожке пересчитать можно не
// всегда — она живёт в буфере 3,5 дня.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { saveLesson, getLessonById } from '../src/services/lessons.js';
import { registerAsset } from '../src/services/media.js';
import { saveTrimRanges, ensureTrimRanges } from '../src/services/trim-ranges.js';
import { ffmpegArgsForTrim } from '../src/lib/ffmpeg.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

async function makeConfig() {
  return { media: { dir: await mkdtemp(path.join(tmpdir(), 'portal-ranges-')), ttlHours: 168 } };
}

test('сохранённые отрезки читаются у урока', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await saveTrimRanges(pool, lesson.id, [{ startedMs: 0, endedMs: 10_000 }]);
    assert.deepEqual((await getLessonById(pool, lesson.id)).trimRanges, [{ startedMs: 0, endedMs: 10_000 }]);
  });
});

test('отрезков нет — считаются по звуку один раз и запоминаются', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок', durationSeconds: 60 });
    await mkdir(path.join(config.media.dir, `lesson-${lesson.id}`), { recursive: true });
    await writeFile(path.join(config.media.dir, `lesson-${lesson.id}/audio.m4a`), 'звук');
    await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'audio',
      relativePath: `lesson-${lesson.id}/audio.m4a`,
      bytes: 4
    });
    let calls = 0;
    const detect = async () => (calls++, [{ startMs: 10_000, endMs: 30_000 }]);

    const first = await ensureTrimRanges(config, pool, await getLessonById(pool, lesson.id), { detect });
    assert.ok(first.length >= 2, 'пауза должна была разделить запись');
    const again = await ensureTrimRanges(config, pool, await getLessonById(pool, lesson.id), { detect });
    assert.deepEqual(again, first);
    assert.equal(calls, 1, 'второй раз считать незачем — отрезки уже сохранены');
  });
});

test('монтаж ставит опорный кадр каждые 2 секунды', () => {
  // Иначе граница части при резке без пережатия уезжает к редкому опорному
  // кадру кодировщика — до 8–10 секунд.
  const args = ffmpegArgsForTrim({ listPath: 'list.txt', output: 'out.mp4' });
  const at = args.indexOf('-force_key_frames');
  assert.ok(at >= 0);
  assert.equal(args[at + 1], 'expr:gte(t,n_forced*2)');
});
```

В `test/trim-pauses-real.test.js`, в конец теста `'запись становится короче, а субтитры к ней — свои'`, после проверок добавить:

```js
    // Отрезки монтажа запоминаются: по ним главы переводятся на смонтированную
    // запись — для нарезки и для описания YouTube.
    const { rows: saved } = await pool.query(
      `SELECT generated->'trimRanges' AS ranges FROM lessons WHERE id = $1`,
      [lesson.id]
    );
    assert.ok(Array.isArray(saved[0].ranges) && saved[0].ranges.length > 0, 'отрезки не сохранены');
```

(имя переменной урока в тесте сверить — `lesson` или иное).

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app my_portal-worker node --test test/trim-ranges.test.js test/trim-pauses-real.test.js`
Expected: FAIL — нет модуля `trim-ranges.js`, нет `-force_key_frames`.

- [ ] **Step 3: Write the implementation**

`src/services/trim-ranges.js`:

```js
// Отрезки записи, которые оставил монтаж.
//
// Задача — переводить время со шкалы исходной записи на смонтированную: главы
// считаются по исходной, а в каналы и на YouTube уезжает смонтированная — без
// пауз. Монтаж отрезки вычислял и выбрасывал, поэтому главы на YouTube «убегали»
// вперёд на сумму вырезанных пауз. Теперь шаг монтажа их сохраняет, а для
// уроков, смонтированных раньше, они считаются один раз заново и тоже
// сохраняются.
// Вызывается из src/jobs/trim-pauses.js, src/jobs/publish-youtube.js и
// src/jobs/publish-lesson-parts.js.
import { access } from 'node:fs/promises';
import { detectSilence } from '../lib/ffmpeg.js';
import { keepRanges } from '../lib/trim.js';
import { readSettings } from '../lib/settings.js';
import { assetsOfLesson, mediaPath } from './media.js';

/** Запоминает отрезки монтажа у урока. */
export async function saveTrimRanges(pool, lessonId, ranges) {
  await pool.query(
    `UPDATE lessons SET generated = generated || jsonb_build_object('trimRanges', $2::jsonb)
      WHERE id = $1`,
    [lessonId, JSON.stringify(ranges)]
  );
}

/**
 * Отрезки монтажа урока: сохранённые, а если их нет — посчитанные тем же
 * путём, что у монтажа. Звуковая дорожка живёт в буфере 3,5 дня, запись —
 * неделю: если дорожки нет, тишина ищется по самой записи.
 */
export async function ensureTrimRanges(config, pool, lesson, { detect = detectSilence } = {}) {
  if (lesson.trimRanges?.length) return lesson.trimRanges;

  const assets = await assetsOfLesson(pool, lesson.id);
  const candidates = [
    ...assets.filter((asset) => asset.kind === 'audio').reverse(),
    ...assets.filter((asset) => asset.kind === 'source')
  ];
  let soundPath = null;
  for (const asset of candidates) {
    try {
      await access(mediaPath(config, asset.path));
      soundPath = mediaPath(config, asset.path);
      break;
    } catch {
      // Файл удалён по сроку — пробуем следующий.
    }
  }
  if (!soundPath) throw new Error('ни звуковой дорожки, ни записи урока в буфере нет');

  const silences = await detect(soundPath, {
    minPauseSeconds: readSettings(lesson.settings).minPauseSeconds
  });
  const ranges = keepRanges(silences, { durationSeconds: lesson.durationSeconds });
  await saveTrimRanges(pool, lesson.id, ranges);
  return ranges;
}
```

`src/jobs/trim-pauses.js`:
- импорт: `import { saveTrimRanges } from '../services/trim-ranges.js';`
- после блока `if (!ranges.length) { … }` добавить:

```js
    // Отрезки запоминаются: по ним главы переводятся на смонтированную запись
    // — для нарезки частями и для описания YouTube.
    await saveTrimRanges(pool, lessonId, ranges);
```

`src/services/lessons.js` — в `toLesson` после `sideError: …`:

```js
    // Отрезки, оставленные монтажом: по ним время переводится на смонтированную
    // запись — см. src/services/trim-ranges.js.
    trimRanges: row.generated?.trimRanges ?? null,
```

`src/lib/ffmpeg.js` — в `ffmpegArgsForTrim` после `'-crf', '23',`:

```js
    // Опорный кадр каждые 2 секунды: смонтированную запись потом режут на
    // части без пережатия, а такая резка встаёт только на опорный кадр. По
    // умолчанию кодировщик ставит их раз в 8–10 секунд — граница части уехала
    // бы на столько же.
    '-force_key_frames', 'expr:gte(t,n_forced*2)',
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app my_portal-worker node --test test/trim-ranges.test.js test/trim-pauses-real.test.js test/trim-pauses.test.js`
Expected: PASS, 0 пропущенных.

- [ ] **Step 5: Полная проверка, commit, push, deploy** — как в Global Constraints; сообщение: `feat: монтаж запоминает оставленные отрезки и ставит опорный кадр каждые 2 секунды`.

---

### Task 4: Главы на шкале уезжающего файла — и на YouTube

**Files:**
- Modify: `src/lib/chapters.js`, `src/services/platforms/youtube-fields.js`, `src/jobs/publish-youtube.js`
- Test: `test/chapters-video.test.js` (новый), `test/youtube-fields.test.js`

**Interfaces:**
- Consumes: `mapTime`, `trimmedDurationMs` из `src/lib/trim.js`; `ensureTrimRanges` (Task 3).
- Produces: `chaptersForVideo({ chapters, durationSeconds, trimRanges }, videoKind) → Array<{ atMs, title }>`; `buildVideoBody({ …, chapters = null })`.

- [ ] **Step 1: Write the failing tests**

`test/chapters-video.test.js`:

```js
// Главы на шкале уезжающего файла. Главы считаются по исходной записи, а
// уезжает смонтированная — без пауз: без перевода главы «убегают» вперёд на
// сумму вырезанных до них пауз.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chaptersForVideo } from '../src/lib/chapters.js';
import { buildVideoBody } from '../src/services/platforms/youtube-fields.js';

// Минута записи, из неё вырезана пауза с 10-й по 30-ю секунду.
const trimRanges = [
  { startedMs: 0, endedMs: 10_000 },
  { startedMs: 30_000, endedMs: 60_000 }
];
const lesson = {
  slug: 'urok',
  title: 'Урок',
  description: 'Описание',
  tags: [],
  durationSeconds: 60,
  chapters: [
    { atMs: 0, title: 'Начало' },
    { atMs: 35_000, title: 'Середина' },
    { atMs: 50_000, title: 'Конец' }
  ]
};

test('у смонтированной записи главы переводятся на её шкалу', () => {
  const chapters = chaptersForVideo({ ...lesson, trimRanges }, 'trimmed');
  // 35-я секунда исходной — это 15-я смонтированной: вырезано 20 секунд.
  assert.deepEqual(chapters.map((chapter) => chapter.atMs), [0, 15_000, 30_000]);
});

test('у исходника главы остаются как есть', () => {
  assert.deepEqual(
    chaptersForVideo({ ...lesson, trimRanges }, 'source').map((chapter) => chapter.atMs),
    [0, 35_000, 50_000]
  );
});

test('описание YouTube берёт главы, переданные доводом', () => {
  const body = buildVideoBody({
    lesson,
    publicBaseUrl: 'https://p.example',
    privacy: 'private',
    chapters: chaptersForVideo({ ...lesson, trimRanges }, 'trimmed')
  });
  assert.match(body.snippet.description, /0:15 Середина/);
  assert.doesNotMatch(body.snippet.description, /0:35 Середина/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app my_portal-worker node --test test/chapters-video.test.js`
Expected: FAIL — `chaptersForVideo` не экспортируется.

- [ ] **Step 3: Write the implementation**

`src/lib/chapters.js` — импорт `import { mapTime, trimmedDurationMs } from './trim.js';` и в конец:

```js
/**
 * Главы на шкале файла, который уезжает.
 * У смонтированной записи время переводится по отрезкам монтажа: главы
 * считаются по исходной записи, а на площадки идёт смонтированная, и без
 * перевода главы «убегают» вперёд на сумму вырезанных пауз. Отрезков нет —
 * главы у смонтированной записи не показываем: неверные хуже никаких.
 */
export function chaptersForVideo({ chapters, durationSeconds, trimRanges = null }, videoKind) {
  if (videoKind !== 'trimmed') {
    return validChapters(chapters, (durationSeconds ?? 0) * 1000 || Infinity);
  }
  if (!trimRanges?.length) return [];
  const moved = (chapters ?? []).map((chapter) => ({
    ...chapter,
    atMs: mapTime(Number(chapter?.atMs ?? chapter?.at ?? -1), trimRanges)
  }));
  return validChapters(moved, trimmedDurationMs(trimRanges));
}
```

(Если `src/lib/trim.js` импортирует что-то из `chapters.js` — цикла нет: проверить `grep -n "import" src/lib/trim.js`.)

`src/services/platforms/youtube-fields.js` — сигнатура `buildVideoBody({ lesson, publicBaseUrl, privacy, chapters: given = null })`, а строку с `chaptersBlock(validChapters(…))` заменить на:

```js
  const chapters = chaptersBlock(
    given ?? validChapters(lesson.chapters, (lesson.durationSeconds ?? 0) * 1000 || Infinity)
  );
```

`src/jobs/publish-youtube.js`:
- импорты: `import { chaptersForVideo } from '../lib/chapters.js';` и `import { ensureTrimRanges } from '../services/trim-ranges.js';`
- перед `const body = buildVideoBody(…)`:

```js
    // Главы — на шкале уезжающего файла: у смонтированной записи время
    // переводится по отрезкам монтажа. Не посчитались — глав не будет: неверные
    // главы хуже никаких.
    const trimRanges =
      video.kind === 'trimmed' ? await ensureTrimRanges(config, pool, lesson).catch(() => null) : null;
    const chapters = chaptersForVideo({ ...lesson, trimRanges }, video.kind);
```

- `buildVideoBody({ lesson, publicBaseUrl: config.publicBaseUrl, privacy })` → `buildVideoBody({ lesson, publicBaseUrl: config.publicBaseUrl, privacy, chapters })`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app my_portal-worker node --test test/chapters-video.test.js test/youtube-fields.test.js test/publish-youtube.test.js`
Expected: PASS.

- [ ] **Step 5: Полная проверка, commit, push, deploy** — сообщение: `fix: главы на YouTube — на шкале смонтированной записи, а не исходной`.

---

### Task 5: Нарезка по размеру и главам

**Files:**
- Create: `src/lib/video-parts.js`
- Modify: `src/lib/ffmpeg.js` (`ffmpegArgsForPart`)
- Test: `test/video-parts.test.js` (новый)

**Interfaces:**
- Produces:
  - `SIZE_MARGIN = 0.95`, `GROW_BELOW = 0.85`
  - `splitIntoParts({ durationMs, totalBytes, chapters, limitBytes, cut, discard }) → Promise<Part[]>`, где `Part = { startMs, endMs, chapters: Array<{ atMs, title, number }>, piece: null | { n, of }, path: string | null, bytes }`; `path === null` — часть совпадает с файлом целиком.
  - `cut({ startMs, endMs }) → Promise<{ path, bytes }>`, `discard({ path }) → Promise<void>`.
  - `ffmpegArgsForPart({ input, output, startMs, endMs }) → string[]`.

- [ ] **Step 1: Write the failing test**

`test/video-parts.test.js`:

```js
// Нарезка записи на части. Цель — как можно меньше частей, каждая не тяжелее
// предела площадки; резка по главам, размер не угадывается, а меряется.
// Настоящий ffmpeg здесь не нужен: резка подставляется.
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitIntoParts, SIZE_MARGIN } from '../src/lib/video-parts.js';
import { ffmpegArgsForPart } from '../src/lib/ffmpeg.js';

const MB = 1024 * 1024;
const min = (m) => m * 60_000;

/** Подставная резка: вес куска — по заданной «плотности» записи. */
function fakeCutter(bytesFor) {
  const cuts = [];
  const discarded = [];
  return {
    cuts,
    discarded,
    cut: async ({ startMs, endMs }) => {
      const piece = { path: `part-${cuts.length + 1}.mp4`, bytes: bytesFor(startMs, endMs) };
      cuts.push({ startMs, endMs, ...piece });
      return piece;
    },
    discard: async (piece) => discarded.push(piece.path)
  };
}

const chapters = [
  { atMs: 0, title: 'Введение', number: 1 },
  { atMs: min(10), title: 'Nginx', number: 2 },
  { atMs: min(20), title: 'Бот', number: 3 },
  { atMs: min(30), title: 'Итоги', number: 4 }
];

test('запись целиком влезает — не режем вовсе', async () => {
  const cutter = fakeCutter(() => 0);
  const parts = await splitIntoParts({
    durationMs: min(40),
    totalBytes: 600 * MB,
    chapters,
    limitBytes: 2000 * MB,
    ...cutter
  });
  assert.equal(parts.length, 1);
  assert.equal(parts[0].path, null, 'часть — сам файл, резать незачем');
  assert.equal(cutter.cuts.length, 0);
});

test('главы набиваются в часть до предела — частей как можно меньше', async () => {
  // Ровно 10 МБ в минуту: 40 минут — 400 МБ, предел 250 МБ.
  const cutter = fakeCutter((start, end) => ((end - start) / 60_000) * 10 * MB);
  const parts = await splitIntoParts({
    durationMs: min(40),
    totalBytes: 400 * MB,
    chapters,
    limitBytes: 250 * MB,
    ...cutter
  });
  // В 250·0,95 МБ влезают две главы по 100 МБ, три — уже нет.
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map((part) => part.chapters.map((chapter) => chapter.number)), [[1, 2], [3, 4]]);
  assert.ok(parts.every((part) => part.bytes <= 250 * MB * SIZE_MARGIN));
});

test('часть не влезла по весу — убираем последнюю главу и режем снова', async () => {
  // Средняя плотность врёт: вторая глава тяжелее остальных вчетверо.
  const heavy = (start, end) => {
    let bytes = 0;
    for (let t = start; t < end; t += 60_000) bytes += (t >= min(10) && t < min(20) ? 30 : 6) * MB;
    return bytes;
  };
  const cutter = fakeCutter(heavy);
  const parts = await splitIntoParts({
    durationMs: min(40),
    totalBytes: heavy(0, min(40)),
    chapters,
    limitBytes: 250 * MB,
    ...cutter
  });
  assert.ok(parts.every((part) => part.bytes <= 250 * MB * SIZE_MARGIN), 'часть тяжелее предела');
  assert.ok(cutter.discarded.length > 0, 'перевес должен был отбросить пробную часть');
});

test('одна глава тяжелее предела — делится на наименьшее число кусков', async () => {
  const cutter = fakeCutter((start, end) => ((end - start) / 60_000) * 10 * MB);
  const parts = await splitIntoParts({
    durationMs: min(60),
    totalBytes: 600 * MB,
    chapters: [
      { atMs: 0, title: 'Всё сразу', number: 1 },
      { atMs: min(50), title: 'Итоги', number: 2 },
      { atMs: min(55), title: 'Вопросы', number: 3 }
    ],
    limitBytes: 250 * MB,
    ...cutter
  });
  const pieces = parts.filter((part) => part.piece);
  // 500 МБ главы в куски до 237,5 МБ — три куска.
  assert.equal(pieces.length, 3);
  assert.deepEqual(pieces.map((part) => part.piece), [{ n: 1, of: 3 }, { n: 2, of: 3 }, { n: 3, of: 3 }]);
});

test('глав нет — делим запись на наименьшее число частей', async () => {
  const cutter = fakeCutter((start, end) => ((end - start) / 60_000) * 10 * MB);
  const parts = await splitIntoParts({
    durationMs: min(40),
    totalBytes: 400 * MB,
    chapters: [],
    limitBytes: 250 * MB,
    ...cutter
  });
  assert.equal(parts.length, 2);
  assert.ok(parts.every((part) => part.chapters.length === 0));
});

test('резка без пережатия, с перемоткой до входа', () => {
  const args = ffmpegArgsForPart({ input: 'in.mp4', output: 'out.mp4', startMs: 90_000, endMs: 150_000 });
  assert.ok(args.indexOf('-ss') < args.indexOf('-i'), 'перемотка до -i — по опорному кадру и быстро');
  assert.equal(args[args.indexOf('-c') + 1], 'copy');
  assert.equal(args[args.indexOf('-t') + 1], '60');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app my_portal-worker node --test test/video-parts.test.js`
Expected: FAIL — нет модуля `video-parts.js`.

- [ ] **Step 3: Write the implementation**

`src/lib/ffmpeg.js` — после `ffmpegArgsForTrim`:

```js
/**
 * Аргументы для части записи — без пережатия.
 * Резка без пережатия встаёт только на опорный кадр, поэтому часть начинается
 * чуть раньше заказанного — до интервала опорных кадров (у записей заказчика
 * 5 секунд, у смонтированных — 2). Зато часовой урок режется за секунды, а не за
 * полчаса, и качество исходное.
 */
export function ffmpegArgsForPart({ input, output, startMs, endMs = null }) {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-ss', String(startMs / 1000),
    '-i', input,
    ...(endMs === null ? [] : ['-t', String((endMs - startMs) / 1000)]),
    '-map', '0:v:0',
    '-map', '0:a?',
    '-c', 'copy',
    '-avoid_negative_ts', 'make_zero',
    '-movflags', '+faststart',
    '-y',
    output
  ];
}
```

`src/lib/video-parts.js`:

```js
// Нарезка записи урока на части для каналов.
//
// Задача — как можно меньше частей, каждая не тяжелее предела площадки.
// Режем по главам: часть набирает главы подряд, пока помещается. Вес не
// угадываем по средней плотности, а меряем: у записи экрана он «плавает» —
// неподвижный экран лёгкий, движение тяжёлое. Резка без пережатия идёт секунды,
// поэтому примерка дешёвая. Жадная набивка глав подряд даёт наименьшее число
// частей при резке по порядку.
// Резка и удаление подставляются доводом: так алгоритм проверяется без ffmpeg.
// Вызывается из src/jobs/publish-lesson-parts.js.

// Запас от предела площадки: вес контейнера и округления не должны
// перевалить часть через предел на последнем мегабайте.
export const SIZE_MARGIN = 0.95;
// Часть легче этой доли предела — пробуем добавить следующую главу.
export const GROW_BELOW = 0.85;

/** Единицы резки: главы с границами. Без глав — одна единица на всю запись. */
function unitsOf(chapters, durationMs) {
  if (!chapters.length) return [{ startMs: 0, endMs: durationMs, chapters: [] }];
  return chapters.map((chapter, index) => ({
    startMs: chapter.atMs,
    endMs: chapters[index + 1]?.atMs ?? durationMs,
    chapters: [chapter]
  }));
}

/** Делит одну единицу на наименьшее число равных кусков, каждый не тяжелее предела. */
async function splitEvenly(unit, { limit, perMs, cut, discard }) {
  let count = Math.max(2, Math.ceil(((unit.endMs - unit.startMs) * perMs) / limit));
  for (;;) {
    const step = (unit.endMs - unit.startMs) / count;
    const pieces = [];
    for (let n = 0; n < count; n += 1) {
      const startMs = Math.round(unit.startMs + step * n);
      const endMs = n === count - 1 ? unit.endMs : Math.round(unit.startMs + step * (n + 1));
      pieces.push({ startMs, endMs, ...(await cut({ startMs, endMs })) });
    }
    if (pieces.every((piece) => piece.bytes <= limit)) {
      return pieces.map((piece, n) => ({
        startMs: piece.startMs,
        endMs: piece.endMs,
        chapters: unit.chapters,
        piece: unit.chapters.length ? { n: n + 1, of: count } : null,
        path: piece.path,
        bytes: piece.bytes
      }));
    }
    for (const piece of pieces) await discard(piece);
    count += 1;
  }
}

export async function splitIntoParts({ durationMs, totalBytes, chapters = [], limitBytes, cut, discard = async () => {} }) {
  const limit = Math.floor(limitBytes * SIZE_MARGIN);
  if (totalBytes <= limit) {
    return [{ startMs: 0, endMs: durationMs, chapters, piece: null, path: null, bytes: totalBytes }];
  }

  const units = unitsOf(chapters, durationMs);
  const perMs = totalBytes / durationMs;
  const parts = [];
  let first = 0;

  while (first < units.length) {
    // Оценка по средней плотности — только отправная точка.
    let last = first;
    while (last + 1 < units.length && (units[last + 1].endMs - units[first].startMs) * perMs <= limit) last += 1;

    const range = (to) => ({ startMs: units[first].startMs, endMs: units[to].endMs });
    let piece = await cut(range(last));

    // Не влезла — убираем последнюю главу и режем снова.
    while (piece.bytes > limit && last > first) {
      await discard(piece);
      last -= 1;
      piece = await cut(range(last));
    }

    // Одна глава (или запись без глав) сама тяжелее предела — делится на куски.
    if (piece.bytes > limit) {
      await discard(piece);
      parts.push(...(await splitEvenly(units[first], { limit, perMs, cut, discard })));
      first += 1;
      continue;
    }

    // Влезла с большим запасом — пробуем добавить следующую главу.
    while (last + 1 < units.length && piece.bytes < limit * GROW_BELOW) {
      const bigger = await cut(range(last + 1));
      if (bigger.bytes > limit) {
        await discard(bigger);
        break;
      }
      await discard(piece);
      piece = bigger;
      last += 1;
    }

    parts.push({
      ...range(last),
      chapters: units.slice(first, last + 1).flatMap((unit) => unit.chapters),
      piece: null,
      path: piece.path,
      bytes: piece.bytes
    });
    first = last + 1;
  }
  return parts;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app my_portal-worker node --test test/video-parts.test.js`
Expected: PASS, 6 тестов.

- [ ] **Step 5: Полная проверка, commit, push, deploy** — сообщение: `feat: нарезка записи на наименьшее число частей по размеру и главам`.

---

### Task 6: Данные — площадки частей и ход отправки

**Files:**
- Create: `migrations/026_publication_parts.sql`
- Modify: `src/services/publications.js`
- Test: `test/publication-parts.test.js` (новый)

**Interfaces:**
- Produces: площадки `telegram_parts`, `max_parts`; `publicationById(…).details: object`; `markPublicationDetails(pool, id, details) → Promise<void>`.

- [ ] **Step 1: Write the failing test**

`test/publication-parts.test.js`:

```js
// Публикации частей видео: своя «площадка» рядом с анонсом и ход отправки
// постами подряд — чтобы повтор продолжал, а не дублировал.
import test from 'node:test';
import assert from 'node:assert/strict';
import { saveLesson } from '../src/services/lessons.js';
import {
  startPublication,
  publicationById,
  markPublicationDetails
} from '../src/services/publications.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

test('части видео — отдельная публикация рядом с анонсом', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    const announcement = await startPublication(pool, { lessonId: lesson.id, platform: 'telegram', mode: 'auto' });
    const parts = await startPublication(pool, { lessonId: lesson.id, platform: 'telegram_parts', mode: 'auto' });
    await startPublication(pool, { lessonId: lesson.id, platform: 'max_parts', mode: 'auto' });
    assert.notEqual(parts.id, announcement.id);
  });
});

test('ход отправки запоминается', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    const { id } = await startPublication(pool, { lessonId: lesson.id, platform: 'max_parts', mode: 'auto' });
    assert.deepEqual((await publicationById(pool, id)).details, {});
    await markPublicationDetails(pool, id, { sent: ['mid.1', 'mid.2'] });
    assert.deepEqual((await publicationById(pool, id)).details, { sent: ['mid.1', 'mid.2'] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app my_portal-worker node --test test/publication-parts.test.js`
Expected: FAIL — нарушение `publications_platform_check`, `markPublicationDetails` не экспортируется.

- [ ] **Step 3: Write the implementation**

`migrations/026_publication_parts.sql`:

```sql
-- Урок в каналы частями видео — отдельной публикацией рядом с анонсом.
--
-- Своя «площадка», а не вторая строка той же: экран урока и правка анонсов
-- ищут публикацию по площадке, и вторая строка «telegram» у урока их запутала
-- бы. details — ход отправки постами подряд (у MAX, если он не примет
-- несколько видео в одном сообщении): какие части ушли и номера их постов,
-- чтобы повтор продолжил, а не задублировал.
-- Читается из src/services/publications.js.
ALTER TABLE publications DROP CONSTRAINT publications_platform_check;
ALTER TABLE publications ADD CONSTRAINT publications_platform_check CHECK (platform IN
  ('youtube', 'vk', 'telegram', 'rutube', 'tiktok', 'instagram', 'dzen', 'max',
   'telegram_parts', 'max_parts'));
ALTER TABLE publications ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb;
```

`src/services/publications.js`:
- в `publicationById` в `SELECT` добавить `details`, в объект — `details: rows[0].details ?? {}`;
- добавить:

```js
/**
 * Записывает ход отправки частей постами подряд.
 * Повтор после сбоя читает его и продолжает с части, которая не ушла.
 * Вызывается из src/jobs/publish-lesson-parts.js.
 */
export async function markPublicationDetails(pool, id, details) {
  await pool.query('UPDATE publications SET details = $2::jsonb, updated_at = now() WHERE id = $1', [
    id,
    JSON.stringify(details)
  ]);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: тот же файл + `test/publish-channel.test.js test/publish-routes.test.js`. Expected: PASS.

- [ ] **Step 5: Полная проверка, commit, push, deploy** — сообщение: `feat: публикации частей видео — своя площадка и ход отправки`. После выкатки убедиться: `docker logs --since 3m my_portal-api-1 | grep 026`.

---

### Task 7: Подписи к частям

**Files:**
- Modify: `src/services/platforms/announcement.js`
- Test: `test/parts-caption.test.js` (новый)

**Interfaces:**
- Consumes: `formatTimecode` из `src/lib/chapters.js`; `TELEGRAM_CAPTION_LIMIT`.
- Produces: `partTitle(part, n, total) → string`; `buildPartsCaption({ lesson, parts, publicBaseUrl, limit }) → string`; `MAX_TEXT_LIMIT = 4000`.

- [ ] **Step 1: Write the failing test**

`test/parts-caption.test.js`:

```js
// Подписи к частям: у каждой — её глава, у первой — заголовок, главы с
// номерами частей и ссылка. Предел Telegram — 1024 знака, ссылка остаётся всегда.
import test from 'node:test';
import assert from 'node:assert/strict';
import { partTitle, buildPartsCaption } from '../src/services/platforms/announcement.js';

const chapter = (number, title, atMs = 0) => ({ number, title, atMs });
const lesson = { slug: 'urok', title: 'Урок про портал' };

test('названия частей — по главам', () => {
  assert.equal(partTitle({ chapters: [], piece: null }, 1, 4), 'Часть 1 из 4');
  assert.equal(partTitle({ chapters: [chapter(2, 'Настройка nginx')], piece: null }, 2, 3), 'Часть 2 из 3 · Настройка nginx');
  assert.equal(partTitle({ chapters: [chapter(3, 'А'), chapter(4, 'Б')], piece: null }, 2, 3), 'Часть 2 из 3 · Главы 3–4');
  assert.equal(partTitle({ chapters: [chapter(2, 'Длинная')], piece: { n: 1, of: 2 } }, 2, 4), 'Глава 2 · 1 из 2 · Длинная');
});

test('подпись — заголовок, главы с номерами частей и ссылка', () => {
  const parts = [
    { chapters: [chapter(1, 'Введение', 0), chapter(2, 'Nginx', 600_000)], piece: null },
    { chapters: [chapter(3, 'Бот', 1_200_000)], piece: null }
  ];
  const caption = buildPartsCaption({ lesson, parts, publicBaseUrl: 'https://p.example', limit: 1024 });
  assert.match(caption, /^Урок про портал/);
  assert.match(caption, /0:00 Введение — часть 1/);
  assert.match(caption, /20:00 Бот — часть 2/);
  assert.match(caption, /https:\/\/p\.example\/lesson\/urok$/);
});

test('подпись влезает в предел, а ссылка остаётся', () => {
  const many = Array.from({ length: 40 }, (_, i) => chapter(i + 1, `Очень длинное название главы номер ${i + 1}`, i * 60_000));
  const caption = buildPartsCaption({
    lesson,
    parts: [{ chapters: many, piece: null }],
    publicBaseUrl: 'https://p.example',
    limit: 1024
  });
  assert.ok(caption.length <= 1024, `длина ${caption.length}`);
  assert.match(caption, /https:\/\/p\.example\/lesson\/urok$/);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test test/parts-caption.test.js` в образе. Expected: FAIL — нет экспорта.

- [ ] **Step 3: Write the implementation**

`src/services/platforms/announcement.js` — импорт `import { formatTimecode } from '../../lib/chapters.js';` и в конец:

```js
// Предел текста сообщения у MAX. У Telegram свой — TELEGRAM_CAPTION_LIMIT.
export const MAX_TEXT_LIMIT = 4000;

/** Название части: по главам, а без глав — просто номер. */
export function partTitle(part, n, total) {
  const head = `Часть ${n} из ${total}`;
  const [firstChapter] = part.chapters;
  if (!firstChapter) return head;
  if (part.piece) return `Глава ${firstChapter.number} · ${part.piece.n} из ${part.piece.of} · ${firstChapter.title}`;
  if (part.chapters.length === 1) return `${head} · ${firstChapter.title}`;
  return `${head} · Главы ${firstChapter.number}–${part.chapters.at(-1).number}`;
}

/**
 * Подпись поста с частями: заголовок, главы с номерами частей, ссылка на урок.
 * Не влезает в предел — сперва укорачиваются названия глав, потом отпадают
 * последние строки; ссылка остаётся всегда: ради неё зритель и дочитывает.
 */
export function buildPartsCaption({ lesson, parts, publicBaseUrl, limit = TELEGRAM_CAPTION_LIMIT }) {
  const link = `${publicBaseUrl}/lesson/${lesson.slug}`;
  const seen = new Set();
  const lines = [];
  parts.forEach((part, index) => {
    for (const chapter of part.chapters) {
      if (seen.has(chapter.number)) continue;
      seen.add(chapter.number);
      lines.push({ time: formatTimecode(chapter.atMs), title: chapter.title, part: index + 1 });
    }
  });

  const compose = (titleLimit, count) => {
    const body = lines.slice(0, count).map((line) => {
      const title = line.title.length > titleLimit ? `${line.title.slice(0, titleLimit - 1).trim()}…` : line.title;
      return `${line.time} ${title} — часть ${line.part}`;
    });
    if (count < lines.length) body.push('…');
    return [lesson.title, '', ...(body.length ? ['Главы:', ...body, ''] : []), link].join('\n');
  };

  for (const titleLimit of [80, 50, 30, 20]) {
    const text = compose(titleLimit, lines.length);
    if (text.length <= limit) return text;
  }
  for (let count = lines.length - 1; count >= 0; count -= 1) {
    const text = compose(20, count);
    if (text.length <= limit) return text;
  }
  return `${lesson.title.slice(0, Math.max(0, limit - link.length - 2))}\n\n${link}`;
}
```

- [ ] **Step 4: Run to verify it passes**; **Step 5:** полная проверка, commit (`feat: подписи к частям видео урока`), push, deploy.

---

### Task 8: Отправка частей в Telegram

**Files:**
- Modify: `src/services/platforms/telegram-channel.js`
- Test: `test/telegram-parts.test.js` (новый)

**Interfaces:**
- Consumes: `botMethod`, `DEFAULT_API_URL` (Task 1).
- Produces: `postPartsToTelegram({ apiUrl, token, channel, parts: Array<{ path, caption }>, coverPath, fetchImpl }) → Promise<{ messageId, url }>`.

- [ ] **Step 1: Write the failing test**

`test/telegram-parts.test.js`:

```js
// Отправка частей в Telegram: одна часть — обычный пост с видео, от двух —
// альбом одним запросом. Файлы идут с диска, не читаясь в память целиком.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { postPartsToTelegram } from '../src/services/platforms/telegram-channel.js';

async function files(count) {
  const dir = await mkdtemp(path.join(tmpdir(), 'tg-parts-'));
  const list = [];
  for (let i = 0; i < count; i += 1) {
    const file = path.join(dir, `part-${i + 1}.mp4`);
    await writeFile(file, `видео ${i + 1}`);
    list.push({ path: file, caption: `Часть ${i + 1}` });
  }
  const cover = path.join(dir, 'cover.jpg');
  await writeFile(cover, 'обложка');
  return { parts: list, cover };
}

test('одна часть — обычный пост с видео и обложкой', async () => {
  const { parts, cover } = await files(1);
  let seen = null;
  const result = await postPartsToTelegram({
    apiUrl: 'http://bot-api:8081',
    token: 't',
    channel: '@kanal',
    parts,
    coverPath: cover,
    fetchImpl: async (url, options) => {
      seen = { url, form: options.body };
      return { ok: true, json: async () => ({ ok: true, result: { message_id: 7 } }) };
    }
  });
  assert.equal(seen.url, 'http://bot-api:8081/bott/sendVideo');
  assert.equal(seen.form.get('supports_streaming'), 'true');
  assert.ok(seen.form.get('video'), 'видео не приложено');
  assert.ok(seen.form.get('cover'), 'обложка не приложена');
  assert.deepEqual(result, { messageId: '7', url: 'https://t.me/kanal/7' });
});

test('несколько частей — альбом одним запросом, подпись у каждой', async () => {
  const { parts, cover } = await files(3);
  let seen = null;
  const result = await postPartsToTelegram({
    token: 't',
    channel: '@kanal',
    parts,
    coverPath: cover,
    fetchImpl: async (url, options) => {
      seen = { url, form: options.body };
      return {
        ok: true,
        json: async () => ({ ok: true, result: [{ message_id: 10 }, { message_id: 11 }, { message_id: 12 }] })
      };
    }
  });
  assert.match(seen.url, /\/sendMediaGroup$/);
  const media = JSON.parse(seen.form.get('media'));
  assert.equal(media.length, 3);
  assert.deepEqual(media.map((item) => item.caption), ['Часть 1', 'Часть 2', 'Часть 3']);
  assert.ok(media.every((item) => item.type === 'video' && item.supports_streaming));
  assert.equal(media[0].cover, 'attach://cover');
  assert.ok(seen.form.get('part0') && seen.form.get('part2'));
  assert.equal(result.messageId, '10');
});

test('больше десяти частей в альбом не уходит', async () => {
  const { parts } = await files(11);
  await assert.rejects(
    postPartsToTelegram({ token: 't', channel: '@kanal', parts, fetchImpl: async () => ({ ok: true }) }),
    /не больше 10/
  );
});
```

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL, нет экспорта.

- [ ] **Step 3: Write the implementation**

`src/services/platforms/telegram-channel.js` — импорт `import { openAsBlob } from 'node:fs';` и в конец:

```js
// Сколько видео Telegram кладёт в один альбом.
const ALBUM_LIMIT = 10;

/** Файл для отправки — с диска потоком: часть весит до 2000 МБ, а память на сервере общая. */
async function fileBlob(filePath, type) {
  return openAsBlob(filePath, { type });
}

/**
 * Отправляет урок частями видео.
 * Одна часть — обычный пост с видео; от двух до десяти — альбом одним запросом:
 * одно сообщение, одно уведомление, и половины поста при сбое не бывает.
 * Первая часть несёт подпись со списком глав и ссылкой, остальные — свою главу.
 * Превью первой — обложка урока. Предел файла — у сервера Bot API: у своего
 * 2000 МБ, у облака 50 МБ.
 * Вызывается из src/jobs/publish-lesson-parts.js через адаптер воркера.
 */
export async function postPartsToTelegram({
  apiUrl = DEFAULT_API_URL,
  token,
  channel,
  parts,
  coverPath = null,
  fetchImpl = fetch
}) {
  if (!parts.length) throw new Error('частей для отправки нет');
  if (parts.length > ALBUM_LIMIT) {
    throw new Error(`Telegram кладёт в альбом не больше ${ALBUM_LIMIT} видео, а частей ${parts.length}`);
  }
  const coverType = coverPath && /\.png$/i.test(coverPath) ? 'image/png' : 'image/jpeg';
  const form = new FormData();
  form.append('chat_id', channel);

  let method;
  if (parts.length === 1) {
    method = 'sendVideo';
    form.append('caption', parts[0].caption);
    form.append('supports_streaming', 'true');
    form.append('video', await fileBlob(parts[0].path, 'video/mp4'), 'part-1.mp4');
    if (coverPath) form.append('cover', await fileBlob(coverPath, coverType), 'cover.jpg');
  } else {
    method = 'sendMediaGroup';
    const media = parts.map((part, index) => ({
      type: 'video',
      media: `attach://part${index}`,
      caption: part.caption,
      supports_streaming: true,
      ...(index === 0 && coverPath ? { cover: 'attach://cover' } : {})
    }));
    form.append('media', JSON.stringify(media));
    for (const [index, part] of parts.entries()) {
      form.append(`part${index}`, await fileBlob(part.path, 'video/mp4'), `part-${index + 1}.mp4`);
    }
    if (coverPath) form.append('cover', await fileBlob(coverPath, coverType), 'cover.jpg');
  }

  const response = await fetchImpl(botMethod(apiUrl, token, method), { method: 'POST', body: form });
  if (!response.ok) await failure(response);
  const body = await response.json();
  const first = Array.isArray(body.result) ? body.result[0] : body.result;
  const messageId = String(first?.message_id ?? '');
  return { messageId, url: postUrl(channel, messageId) };
}
```

- [ ] **Step 4–5:** тесты зелёные; полная проверка; commit (`feat: отправка урока частями в Telegram — видео или альбом`), push, deploy.

---

### Task 9: Отправка частей в MAX — одним сообщением или постами подряд

**Files:**
- Modify: `src/services/platforms/max-channel.js`
- Test: `test/max-parts.test.js` (новый)

**Interfaces:**
- Produces:
  - `uploadVideo({ token, filePath, fetchImpl, uploadFetch }) → Promise<string>` (токен вложения; `postVideoToMax` переходит на неё).
  - `postPartsToMax({ token, channel, parts, text, multiVideo, progress, onProgress, fetchImpl, uploadFetch }) → Promise<{ messageId, url: null, multiVideo: boolean }>`; `progress = { sent: string[] }`.

- [ ] **Step 1: Write the failing test**

`test/max-parts.test.js`:

```js
// Отправка частей в MAX. Документация молчит, примет ли MAX несколько видео в
// одном сообщении: пробуем, а при отказе шлём постами подряд — и повтор после
// сбоя продолжает с непришедшей части.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { postPartsToMax } from '../src/services/platforms/max-channel.js';

async function parts(count) {
  const dir = await mkdtemp(path.join(tmpdir(), 'max-parts-'));
  const list = [];
  for (let i = 0; i < count; i += 1) {
    const file = path.join(dir, `part-${i + 1}.mp4`);
    await writeFile(file, `видео ${i + 1}`);
    list.push({ path: file, caption: `Часть ${i + 1} из ${count}` });
  }
  return list;
}

/** Подставной MAX: загрузки отвечают токенами, сообщения — по правилу. */
function fakeMax({ acceptMulti = true, failAt = null } = {}) {
  const messages = [];
  let uploads = 0;
  let sentCount = 0;
  return {
    messages,
    fetchImpl: async (url, options = {}) => {
      if (String(url).includes('/uploads?type=video')) {
        uploads += 1;
        return { ok: true, json: async () => ({ url: `https://upload.example/${uploads}`, token: `v${uploads}` }) };
      }
      const body = JSON.parse(options.body);
      if (body.attachments.length > 1 && !acceptMulti) {
        return { ok: false, status: 400, text: async () => 'too many attachments' };
      }
      sentCount += 1;
      if (failAt === sentCount) return { ok: false, status: 502, text: async () => 'bad gateway' };
      messages.push(body);
      return { ok: true, json: async () => ({ message: { body: { mid: `mid.${sentCount}` } } }) };
    },
    uploadFetch: async () => ({ ok: true, json: async () => ({}) })
  };
}

test('MAX принял все части одним сообщением', async () => {
  const max = fakeMax();
  const result = await postPartsToMax({ token: 't', channel: '-1', parts: await parts(3), text: 'Главы…', ...max });
  assert.equal(max.messages.length, 1);
  assert.equal(max.messages[0].attachments.length, 3);
  assert.equal(max.messages[0].text, 'Главы…');
  assert.deepEqual(result, { messageId: 'mid.1', url: null, multiVideo: true });
});

test('не принял несколько видео — постами подряд, первый с текстом', async () => {
  const max = fakeMax({ acceptMulti: false });
  const saved = [];
  const result = await postPartsToMax({
    token: 't',
    channel: '-1',
    parts: await parts(3),
    text: 'Главы…',
    onProgress: async (progress) => saved.push([...progress.sent]),
    ...max
  });
  assert.equal(max.messages.length, 3);
  assert.equal(max.messages[0].text, 'Главы…');
  assert.equal(max.messages[1].text, 'Часть 2 из 3');
  assert.equal(result.multiVideo, false);
  assert.deepEqual(saved.at(-1), ['mid.1', 'mid.2', 'mid.3']);
});

test('повтор после сбоя продолжает с непришедшей части', async () => {
  const list = await parts(3);
  const max = fakeMax({ acceptMulti: false });
  const result = await postPartsToMax({
    token: 't',
    channel: '-1',
    parts: list,
    text: 'Главы…',
    multiVideo: false,
    progress: { sent: ['mid.old1', 'mid.old2'] },
    ...max
  });
  // Две части уже в канале — уходит только третья.
  assert.equal(max.messages.length, 1);
  assert.equal(max.messages[0].text, 'Часть 3 из 3');
  assert.equal(result.messageId, 'mid.old1');
});
```

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL, нет экспорта.

- [ ] **Step 3: Write the implementation**

`src/services/platforms/max-channel.js`:
- импорт `import { openAsBlob } from 'node:fs';`
- выделить из `postVideoToMax` загрузку:

```js
/**
 * Загружает видео в MAX и отдаёт токен вложения. Файл идёт с диска потоком:
 * часть урока весит до 250 МБ.
 */
export async function uploadVideo({ token, filePath, fetchImpl = maxFetch, uploadFetch = fetch }) {
  const asked = await fetchImpl(`${API}/uploads?type=video`, {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: '{}'
  });
  if (!asked.ok) await failure(asked, token);

  const { url, token: videoToken } = await asked.json();
  if (!url) throw new Error('MAX не дал адрес для загрузки ролика');

  const form = new FormData();
  form.append('data', await openAsBlob(filePath, { type: 'video/mp4' }), 'video.mp4');
  const sent = await uploadFetch(url, { method: 'POST', body: form });
  if (!sent.ok) throw new Error(`MAX не принял ролик (${sent.status})`);

  const uploaded = await sent.json().catch(() => ({}));
  const attachment = videoToken ?? uploaded.token ?? uploaded.video?.token;
  if (!attachment) {
    throw new Error(`MAX принял ролик, но не дал его токен: ${JSON.stringify(uploaded).slice(0, 200)}`);
  }
  return attachment;
}
```

- в `postVideoToMax` заменить всё от `const asked = …` до вычисления `attachment` на `const attachment = await uploadVideo({ token, filePath, fetchImpl, uploadFetch });`.
- добавить:

```js
/** Сообщение с видео в канал. */
async function sendVideoMessage({ token, channel, text, attachments, fetchImpl }) {
  return fetchImpl(`${API}/messages?chat_id=${encodeURIComponent(channel)}`, {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      attachments: attachments.map((attachment) => ({ type: 'video', payload: { token: attachment } }))
    })
  });
}

/**
 * Отправляет урок частями видео.
 * Сперва — всё одним сообщением. Документация MAX не говорит, принимает ли он
 * несколько видео в одном сообщении; отказал (4xx) — части уходят постами
 * подряд: первый с текстом, дальше — название части. Ход записывается через
 * onProgress, и повтор после сбоя продолжает с непришедшей части.
 * Вызывается из src/jobs/publish-lesson-parts.js через адаптер воркера.
 */
export async function postPartsToMax({
  token,
  channel,
  parts,
  text,
  multiVideo = true,
  progress = { sent: [] },
  onProgress = async () => {},
  fetchImpl = maxFetch,
  uploadFetch = fetch
}) {
  const alreadySent = progress.sent ?? [];

  if (multiVideo && !alreadySent.length) {
    const attachments = [];
    for (const part of parts) {
      attachments.push(await uploadVideo({ token, filePath: part.path, fetchImpl, uploadFetch }));
    }
    const response = await sendVideoMessage({ token, channel, text, attachments, fetchImpl });
    if (response.ok) {
      return { messageId: readMessageId(await response.json()), url: null, multiVideo: true };
    }
    // Одна часть или сбой самой площадки — это отказ, а не «много видео».
    if (parts.length === 1 || response.status >= 500) await failure(response, token);
  }

  // Части загружаются заново: живёт ли токен вложения после отказа в сообщении
  // и можно ли его приложить второй раз, MAX не пишет. Лишняя загрузка дешевле
  // поста с «битым» видео; после первого отказа способ запомнится, и дальше
  // загрузка будет одна.
  const sent = [...alreadySent];
  for (let index = sent.length; index < parts.length; index += 1) {
    const attachment = await uploadVideo({ token, filePath: parts[index].path, fetchImpl, uploadFetch });
    const response = await sendVideoMessage({
      token,
      channel,
      text: index === 0 ? text : parts[index].caption,
      attachments: [attachment],
      fetchImpl
    });
    if (!response.ok) await failure(response, token);
    sent.push(readMessageId(await response.json()));
    await onProgress({ sent });
  }
  return { messageId: sent[0], url: null, multiVideo: false };
}
```

- [ ] **Step 4–5:** тесты (`test/max-parts.test.js` и прежние тесты MAX) зелёные; полная проверка; commit (`feat: отправка урока частями в MAX — одним сообщением или постами подряд`), push, deploy.

---

### Task 10: Шаг очереди «урок частями»

**Files:**
- Create: `src/jobs/publish-lesson-parts.js`
- Modify: `src/queue.js`, `src/worker.js`
- Test: `test/publish-lesson-parts.test.js` (новый)

**Interfaces:**
- Consumes: `splitIntoParts` (T5), `ffmpegArgsForPart`, `runFfmpeg`, `probeDuration`; `chaptersForVideo` (T4); `ensureTrimRanges` (T3); `partTitle`, `buildPartsCaption`, `MAX_TEXT_LIMIT`, `TELEGRAM_CAPTION_LIMIT` (T7); `markPublicationDetails`, `publicationById`, `publicationsFor`, `markPublicationState` (T6); `pickVideoAsset`; адаптер `{ app, postParts }`.
- Produces: `PARTS_LIMITS`, `makePublishLessonParts(config, pool, platform, adapter, { cutter, probe, ensureRanges }) → job`; `JOBS.publishTelegramParts`, `JOBS.publishMaxParts`.

- [ ] **Step 1: Write the failing test**

`test/publish-lesson-parts.test.js`:

```js
// Шаг «урок частями». Площадка, резка и замер подменяются: проверяется порядок
// работы — анонс уже ушёл, запись на месте, части собраны и отправлены, ход
// записан, временные файлы убраны.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makePublishLessonParts } from '../src/jobs/publish-lesson-parts.js';
import { saveLesson } from '../src/services/lessons.js';
import { registerAsset } from '../src/services/media.js';
import { savePlatformApp } from '../src/services/platform-apps.js';
import {
  startPublication,
  markPublicationState,
  publicationById
} from '../src/services/publications.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const MB = 1024 * 1024;

async function setup(pool, { announced = true, bytes = 600 * MB } = {}) {
  const config = {
    publicBaseUrl: 'https://p.example',
    media: { dir: await mkdtemp(path.join(tmpdir(), 'parts-job-')), ttlHours: 168 }
  };
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок про портал' });
  await mkdir(path.join(config.media.dir, `lesson-${lesson.id}`), { recursive: true });
  await writeFile(path.join(config.media.dir, `lesson-${lesson.id}/source.mp4`), 'запись');
  await registerAsset(pool, config, {
    lessonId: lesson.id,
    kind: 'source',
    relativePath: `lesson-${lesson.id}/source.mp4`,
    bytes
  });
  const announcement = await startPublication(pool, { lessonId: lesson.id, platform: 'max', mode: 'auto' });
  if (announced) await markPublicationState(pool, announcement.id, { state: 'published', externalId: 'mid.a' });
  const { id: publicationId } = await startPublication(pool, { lessonId: lesson.id, platform: 'max_parts', mode: 'auto' });
  return { config, lesson, publicationId };
}

function adapterStub(result = { messageId: 'mid.1', url: null, multiVideo: true }) {
  const calls = [];
  return {
    calls,
    app: async () => ({ configured: true, token: 't', channel: '-1', link: 'https://max.ru/kanal' }),
    postParts: async (args) => (calls.push(args), result)
  };
}

const fakeCutter = async ({ output, startMs, endMs }) => {
  await writeFile(output, 'часть');
  return { path: output, bytes: ((endMs - startMs) / 60_000) * 10 * MB };
};

test('урок уходит в MAX частями не тяжелее предела, временные файлы убраны', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { config, lesson, publicationId } = await setup(pool);
    const adapter = adapterStub();
    const result = await makePublishLessonParts(config, pool, 'max_parts', adapter, {
      cutter: fakeCutter,
      probe: async () => 3600
    })({ lessonId: lesson.id, publicationId });

    // 600 МБ при пределе 250·0,95 — три части.
    assert.equal(result.parts, 3);
    const sent = adapter.calls[0];
    assert.equal(sent.parts.length, 3);
    assert.match(sent.text, /^Урок про портал/);
    assert.match(sent.text, /https:\/\/p\.example\/lesson\/urok$/);
    assert.equal(sent.parts[1].caption, 'Часть 2 из 3');

    const publication = await publicationById(pool, publicationId);
    assert.equal(publication.state, 'published');
    assert.equal(publication.externalId, 'mid.1');
    const left = await readdir(path.join(config.media.dir, `lesson-${lesson.id}`));
    assert.ok(!left.includes('parts'), 'временные части остались на диске');
  });
});

test('без анонса части не уходят, и сказано почему', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { config, lesson, publicationId } = await setup(pool, { announced: false });
    await assert.rejects(
      makePublishLessonParts(config, pool, 'max_parts', adapterStub(), { cutter: fakeCutter, probe: async () => 3600 })({
        lessonId: lesson.id,
        publicationId
      }),
      /Сначала отправьте анонс/
    );
    const publication = await publicationById(pool, publicationId);
    assert.equal(publication.state, 'failed');
  });
});

test('MAX не принял несколько видео — запоминается у канала', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { config, lesson, publicationId } = await setup(pool);
    await savePlatformApp(pool, { tokenEncryptionKey: 'a'.repeat(64) }, {
      name: 'max',
      clientId: '',
      clientSecret: '',
      mode: 'semi',
      settings: { channel: '-1' }
    });
    await makePublishLessonParts(config, pool, 'max_parts', adapterStub({ messageId: 'mid.1', url: null, multiVideo: false }), {
      cutter: fakeCutter,
      probe: async () => 3600
    })({ lessonId: lesson.id, publicationId });
    const { rows } = await pool.query(`SELECT settings->>'multiVideo' AS multi FROM platform_apps WHERE name = 'max'`);
    assert.equal(rows[0].multi, 'false');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL, нет модуля.

- [ ] **Step 3: Write the implementation**

`src/jobs/publish-lesson-parts.js`:

```js
// Шаг очереди: урок в канал частями видео.
//
// Задача — нарезать запись урока на как можно меньше частей в пределе площадки
// и отправить их одним постом со списком глав. Идёт следом за анонсом: анонс
// остаётся, пост с частями — для просмотра прямо в ленте канала.
// Площадка приходит набором функций (app, postParts): так шаг проверяется
// тестом без сети; резка и замер — тоже доводом, чтобы тест обходился без ffmpeg.
// Вызывается воркером по именам JOBS.publishTelegramParts и JOBS.publishMaxParts.
import { access, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { getLessonById } from '../services/lessons.js';
import { assetsOfLesson, mediaPath } from '../services/media.js';
import {
  markPublicationState,
  markPublicationDetails,
  publicationById,
  publicationsFor
} from '../services/publications.js';
import { pickVideoAsset } from '../services/platforms/youtube-fields.js';
import {
  partTitle,
  buildPartsCaption,
  MAX_TEXT_LIMIT,
  TELEGRAM_CAPTION_LIMIT
} from '../services/platforms/announcement.js';
import { chaptersForVideo } from '../lib/chapters.js';
import { splitIntoParts } from '../lib/video-parts.js';
import { runFfmpeg, ffmpegArgsForPart, probeDuration } from '../lib/ffmpeg.js';
import { ensureTrimRanges } from '../services/trim-ranges.js';

const MB = 1024 * 1024;

// Предел части у площадки: Telegram через свой сервер Bot API — 2000 МБ, MAX —
// 250 МБ (своего сервера у MAX нет).
export const PARTS_LIMITS = { telegram_parts: 2000 * MB, max_parts: 250 * MB };

// Какой анонс должен уйти раньше частей.
const ANNOUNCEMENT_OF = { telegram_parts: 'telegram', max_parts: 'max' };

/** Резка без пережатия и замер части. */
async function ffmpegCutter({ input, output, startMs, endMs }) {
  await runFfmpeg(ffmpegArgsForPart({ input, output, startMs, endMs }));
  const { size } = await stat(output);
  return { path: output, bytes: size };
}

export function makePublishLessonParts(
  config,
  pool,
  platform,
  adapter,
  { cutter = ffmpegCutter, probe = probeDuration, ensureRanges = ensureTrimRanges } = {}
) {
  return async ({ lessonId, publicationId }) => {
    const partsDir = mediaPath(config, `lesson-${lessonId}/parts`);
    try {
      const base = ANNOUNCEMENT_OF[platform];
      const app = await adapter.app(pool, config, base);
      if (!app.configured) throw new Error(`Канал ${base} не настроен — заполните его в настройках`);

      const lesson = await getLessonById(pool, lessonId);
      if (!lesson) throw new Error('Урок не найден');
      const announced = (await publicationsFor(pool, lessonId)).some(
        (item) => item.platform === base && item.state === 'published'
      );
      if (!announced) throw new Error('Сначала отправьте анонс урока в этот канал');

      const assets = await assetsOfLesson(pool, lessonId);
      const video = pickVideoAsset(assets);
      const gone = 'Записи урока нет в буфере — вероятно, она удалена по сроку; загрузите её заново';
      if (!video) throw new Error(gone);
      const input = mediaPath(config, video.path);
      try {
        await access(input);
      } catch {
        throw new Error(gone);
      }
      const durationSeconds = await probe(input);
      if (!durationSeconds) throw new Error('Запись урока не читается — загрузите её заново');

      // Главы — на шкале уезжающего файла. Отрезков монтажа не посчитать —
      // глав не будет: неверные хуже никаких.
      const trimRanges = video.kind === 'trimmed' ? await ensureRanges(config, pool, lesson).catch(() => null) : null;
      const chapters = chaptersForVideo({ ...lesson, trimRanges }, video.kind).map((chapter, index) => ({
        ...chapter,
        number: index + 1
      }));

      await markPublicationState(pool, publicationId, { state: 'uploading' });
      await mkdir(partsDir, { recursive: true });
      let attempt = 0;
      const parts = await splitIntoParts({
        durationMs: Math.round(durationSeconds * 1000),
        totalBytes: video.bytes,
        chapters,
        limitBytes: PARTS_LIMITS[platform],
        cut: ({ startMs, endMs }) =>
          cutter({ input, output: path.join(partsDir, `${platform}-${(attempt += 1)}.mp4`), startMs, endMs }),
        discard: (piece) => rm(piece.path, { force: true })
      });

      const limit = platform === 'telegram_parts' ? TELEGRAM_CAPTION_LIMIT : MAX_TEXT_LIMIT;
      const text = buildPartsCaption({ lesson, parts, publicBaseUrl: config.publicBaseUrl, limit });
      const files = parts.map((part, index) => ({
        path: part.path ?? input,
        caption: index === 0 && platform === 'telegram_parts' ? text : partTitle(part, index + 1, parts.length)
      }));

      const cover = lesson.coverUrl
        ? assets.find((asset) => `/media/asset/${asset.id}` === lesson.coverUrl)
        : null;
      const { rows: maxRows } = await pool.query(`SELECT settings FROM platform_apps WHERE name = 'max'`);
      const publication = await publicationById(pool, publicationId);

      const result = await adapter.postParts({
        token: app.token,
        channel: app.channel,
        parts: files,
        text,
        coverPath: cover ? mediaPath(config, cover.path) : null,
        multiVideo: maxRows[0]?.settings?.multiVideo !== false,
        progress: publication?.details?.sent ? publication.details : { sent: [] },
        onProgress: (details) => markPublicationDetails(pool, publicationId, details)
      });

      // MAX не принял несколько видео — дальше сразу постами подряд.
      if (platform === 'max_parts' && result.multiVideo === false) {
        await pool.query(
          `UPDATE platform_apps SET settings = settings || '{"multiVideo": false}'::jsonb WHERE name = 'max'`
        );
      }
      await markPublicationState(pool, publicationId, {
        state: 'published',
        externalId: result.messageId,
        url: result.url ?? app.link ?? null
      });
      return { parts: parts.length };
    } catch (error) {
      await markPublicationState(pool, publicationId, { state: 'failed', error: error.message.slice(0, 500) });
      throw error;
    } finally {
      // Части временные: уходят и после отправки, и после отказа.
      await rm(partsDir, { recursive: true, force: true });
    }
  };
}
```

(Колонка `platform_apps.settings` существует с миграции 016; если строки `max` нет, `UPDATE` ничего не делает — это нормально: канал без настроек до отправки не дойдёт. `assetsOfLesson` уже отдаёт `bytes` числом.)

`src/queue.js`:
- в `JOBS` после `makeNewsImage`:

```js
  // Урок в канал частями видео — следом за анонсом, своей кнопкой.
  publishTelegramParts: 'publishTelegramParts',
  publishMaxParts: 'publishMaxParts'
```

- в `NO_RETRY_JOBS` после `JOBS.makeNewsImage`:

```js
  // Части урока — как анонсы: повтор после неясного отказа — второй пост.
  JOBS.publishTelegramParts,
  JOBS.publishMaxParts
```

`src/worker.js`:
- импорты: `postPartsToTelegram` (к импорту из `telegram-channel.js`), `postPartsToMax` (к импорту из `max-channel.js`), `import { makePublishLessonParts } from './jobs/publish-lesson-parts.js';`
- в `telegramAdapter`: `postParts: (args) => postPartsToTelegram({ ...args, ...telegramApi })`; в `maxAdapter`: `postParts: postPartsToMax`.
- в `handlers` после `publishMax`:

```js
  [JOBS.publishTelegramParts]: makePublishLessonParts(config, pool, 'telegram_parts', telegramAdapter),
  [JOBS.publishMaxParts]: makePublishLessonParts(config, pool, 'max_parts', maxAdapter),
```

- [ ] **Step 4–5:** тесты зелёные; полная проверка; commit (`feat: шаг очереди — урок в канал частями видео`), push, deploy; в журнале воркера — `publishTelegramParts, publishMaxParts` среди известных шагов.

---

### Task 11: Кнопки на экране урока

**Files:**
- Modify: `src/routes/admin.js`, `src/routes/pages.js` (список площадок), `src/views/admin-review.js`, `public/admin.js` (текст после нажатия)
- Test: `test/lesson-parts-routes.test.js` (новый)

**Interfaces:**
- Produces: `POST /api/admin/lessons/:slug/publish/telegram_parts|max_parts`; строки «Telegram — видео урока», «MAX — видео урока» (`needsAnnouncement`).

- [ ] **Step 1: Текст после нажатия**

Обработчик `[data-publish]` в `public/admin.js` уже собирает адрес из имени площадки, но после нажатия говорит «Анонс поехал в канал.». Заменить выбор текста на:

```js
          toast(
            platform === 'youtube'
              ? 'Ролик поехал на YouTube. Уведомление придёт, когда закончится.'
              : platform.endsWith('_parts')
              ? 'Видео урока режется на части и поедет в канал. Это займёт несколько минут.'
              : 'Анонс поехал в канал.'
          );
```

- [ ] **Step 2: Write the failing test**

`test/lesson-parts-routes.test.js` (config и `asAdmin` — как в `test/publish-routes.test.js`):

```js
// Кнопки «видео урока»: встают в очередь только после анонса и при записи в
// буфере; на экране — своя строка рядом с анонсом.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveLesson } from '../src/services/lessons.js';
import { startPublication, markPublicationState } from '../src/services/publications.js';
import { savePlatformApp } from '../src/services/platform-apps.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://portal.example',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: 'portal-bot', botId: '', botUsername: '', apiUrl: 'https://api.telegram.org' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: '' },
  redis: { url: 'redis://redis:6379', prefix: 'portal:' },
  yandex: { apiKey: '', folderId: '' },
  yandexOauth: { clientId: '', clientSecret: '' },
  tokenEncryptionKey: 'a'.repeat(64),
  media: { dir: '/tmp', ttlHours: 168 },
  youtube: { clientId: '', clientSecret: '', redirectUri: '', mode: 'semi' }
};

async function seed(pool) {
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
  await pool.query(
    `INSERT INTO assets (lesson_id, kind, path, bytes, expires_at)
     VALUES ($1, 'source', 'lesson-1/urok.mp4', 1024, now() + interval '7 days')`,
    [lesson.id]
  );
  await savePlatformApp(pool, config, { name: 'telegram', clientId: '', clientSecret: '', mode: 'semi', settings: { channel: '@kanal' } });
  const { rows } = await pool.query(`INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`);
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'admin' }, config.jwtSecret)}`
  };
  return { lesson, headers };
}

test('без анонса кнопка отказывает, после — ставит задачу', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool);
    const queued = [];
    const app = finalize(createApp({ config, pool, queue: { add: async (name, data) => queued.push({ name, data }) } }));
    await withServer(app, async (base) => {
      const early = await fetch(`${base}/api/admin/lessons/urok/publish/telegram_parts`, { method: 'POST', headers });
      assert.equal(early.status, 409);
      assert.match((await early.json()).error, /анонс/);

      const announcement = await startPublication(pool, { lessonId: lesson.id, platform: 'telegram', mode: 'auto' });
      await markPublicationState(pool, announcement.id, { state: 'published', externalId: '1' });
      const later = await fetch(`${base}/api/admin/lessons/urok/publish/telegram_parts`, { method: 'POST', headers });
      assert.equal(later.status, 200);
    });
    assert.equal(queued.length, 1);
    assert.equal(queued[0].name, 'publishTelegramParts');
  });
});

test('на экране урока — своя строка «видео урока»', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { headers } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const page = await (await fetch(`${base}/admin/lesson/urok`, { headers: { ...headers, Accept: 'text/html' } })).text();
      assert.match(page, /Telegram — видео урока/);
      assert.match(page, /data-publish="telegram_parts"[\s\S]*?disabled title="Сначала отправьте анонс в этот канал"/);
    });
  });
});
```

(Как `channelApp` понимает, что канал Telegram настроен, — сверить с `src/services/platform-apps.js` и при необходимости поправить `seed`, например задать `TELEGRAM_CHANNEL_ID` в `config.telegram.channelId`.)

- [ ] **Step 3: Run to verify it fails** — Expected: FAIL (404 на маршрут, нет строки).

- [ ] **Step 4: Write the implementation**

`src/routes/admin.js` — импорт `publicationsFor` к импорту из `../services/publications.js` (если его там нет) и после цикла анонсов:

```js
  // Урок частями видео — отдельной кнопкой, следом за анонсом: анонс остаётся,
  // пост с частями — для просмотра прямо в ленте канала.
  for (const [platform, base, job] of [
    ['telegram_parts', 'telegram', JOBS.publishTelegramParts],
    ['max_parts', 'max', JOBS.publishMaxParts]
  ]) {
    router.post(`/lessons/:slug/publish/${platform}`, async (req, res) => {
      const lesson = await getLessonBySlug(pool, req.params.slug, { includeDrafts: true });
      if (!lesson) throw new PublicError('Урок не найден', 404);
      if (!req.app.locals.queue) throw new PublicError('Очередь недоступна', 503);

      const app = await channelApp(pool, config, base);
      if (!app.configured) throw new PublicError(`Канал ${base} не настроен — заполните его в настройках`, 400);

      const announced = (await publicationsFor(pool, lesson.id)).some(
        (item) => item.platform === base && item.state === 'published'
      );
      if (!announced) throw new PublicError('Сначала отправьте анонс урока в этот канал', 409);

      const video = pickVideoAsset(await assetsOfLesson(pool, lesson.id));
      if (!video) throw new PublicError('Записи урока нет в буфере — загрузите её заново', 409);

      const publication = await startPublication(pool, {
        lessonId: lesson.id,
        platform,
        assetId: video.id,
        mode: 'auto'
      });
      await addJob(req.app.locals.queue, job, { lessonId: lesson.id, publicationId: publication.id });
      res.json({ publicationId: publication.id, state: 'queued' });
    });
  }
```

`src/routes/pages.js` — в список площадок экрана урока после строки `max`:

```js
            channelApp(pool, config, 'telegram').then((app) => ({
              name: 'telegram_parts',
              title: 'Telegram — видео урока',
              action: 'Отправить видео урока',
              needsCover: false,
              needsAnnouncement: 'telegram',
              configured: app.configured
            })),
            channelApp(pool, config, 'max').then((app) => ({
              name: 'max_parts',
              title: 'MAX — видео урока',
              action: 'Отправить видео урока',
              needsCover: false,
              needsAnnouncement: 'max',
              configured: app.configured
            }))
```

`src/views/admin-review.js` — в цикле площадок перед `return \`<div class="platform-row">`:

```js
            // Части видео идут следом за анонсом: без него пост с частями
            // оказался бы в канале без представления урока.
            const announced =
              !platform.needsAnnouncement ||
              publications.some(
                (item) => item.platform === platform.needsAnnouncement && item.state === 'published'
              );
```

и в условии атрибутов кнопки первой веткой:

```js
                         ${
                           !announced
                             ? 'disabled title="Сначала отправьте анонс в этот канал"'
                             : platform.needsCover && !lesson.coverUrl
```

(оставшиеся ветки — как были).

- [ ] **Step 5:** тесты зелёные (+ `test/publish-routes.test.js`, `test/admin-review.test.js`, `test/client-contract.test.js`); полная проверка; commit (`feat: кнопки «видео урока» для Telegram и MAX на экране урока`), push, deploy.

---

### Task 12: Переезд бота на свой сервер и живая проверка

**Files:** нет новых (настройки на сервере; правка спеки).

- [ ] **Step 1: Ключи.** Попросить заказчика (в Telegram, словами — без самих ключей): my.telegram.org → API development tools → создать приложение → вписать `TELEGRAM_API_ID` и `TELEGRAM_API_HASH` в `/home/boris/projects/ClaudeDocker/.env` на сервере самому.

- [ ] **Step 2: Поднять сервер Bot API**

```bash
cd /home/boris/projects/ClaudeDocker && docker compose up -d telegram-bot-api
docker logs --since 2m shared-telegram-bot-api-1 | tail -20
docker stats --no-stream shared-telegram-bot-api-1
```

Expected: контейнер `Up`, в журнале нет ошибок про ключи; память — десятки МБ.

- [ ] **Step 3: Спросить про отдельного бота канала.** Если в настройках канала Telegram задан свой токен бота — спросить заказчика, используется ли этот бот где-то вне портала (переезд его там сломает). Без ответа — не переносить.

- [ ] **Step 4: logOut и переключение портала**

```bash
docker exec my_portal-api-1 node -e "fetch('https://api.telegram.org/bot'+process.env.TELEGRAM_BOT_TOKEN+'/logOut').then(r=>r.json()).then(b=>console.log(b.ok, b.description ?? ''))"
```

Expected: `true`. Затем в `.env` портала `TELEGRAM_API_URL=http://shared-telegram-bot-api-1:8081` и `docker compose up -d` (перечитать окружение). Для отдельного бота канала (если подтверждено) — тот же `logOut` с его токеном.

- [ ] **Step 5: Проверка связи.** Настройки → канал Telegram → «Проверить связь» → «На связи: бот @…». Уведомление в Telegram приходит (любое тестовое событие или `docker exec` отправкой `sendMessage` админу через свой адрес).

- [ ] **Step 6: Живая отправка.** Заказчик (или по его слову) на экране урока: «Telegram — видео урока» → «Отправить видео урока», затем «MAX — видео урока». Проверить журнал воркера, состояние публикаций, посты в обоих каналах; выяснить, принял ли MAX несколько видео в одном сообщении (`platform_apps.settings.multiVideo`).

- [ ] **Step 7: Закрыть открытые вопросы спеки.** Дописать в раздел 12 спеки итоги живой проверки (MAX: несколько видео — да/нет; предел; память), закоммитить и запушить документ.

- [ ] **Step 8: Итог заказчику** — что проверено вживую, что нет; как откатиться (`TELEGRAM_API_URL=` пусто, через 10 минут после `logOut`).
