# Публикация на YouTube — план работ

> **Исполнителю:** ОБЯЗАТЕЛЬНЫЙ ПОДСКИЛЛ: superpowers:subagent-driven-development
> (рекомендуется) или superpowers:executing-plans — задача за задачей. Шаги
> отмечаются галочками (`- [ ]`).

**Цель:** автор нажимает на экране урока «Отправить на YouTube» — запись,
субтитры и обложка уезжают на его канал, а ссылка встаёт в карточку урока после
того, как автор откроет ролик.

**Устройство.** Выкладка — шаг существующей очереди рядом с расшифровкой.
Состояние живёт в таблице `publications`, по строке на файл и площадку. Работа с
площадкой разложена на три файла: обмен токенами, сборка полей ролика (чистые
функции) и сами запросы к API. Загрузка идёт возобновляемым протоколом потоком с
диска — иначе семисотмегабайтный файл убьёт воркер, у которого потолок памяти
1.4 ГБ.

**Технологии:** Node 24, Express 5, PostgreSQL 18, BullMQ, `node:test`, ffmpeg.
Без пакета `googleapis` — портал ходит в чужие API голым `fetch`.

**Спека:** `docs/superpowers/specs/2026-09-08-youtube-publishing-design.md`.

**Отношение к плану 7а** (`2026-09-04-portal-stage-7a.md`, не исполнен). Заказчик
решил: площадок будет много, но сейчас у каждой свой обработчик и свой запуск, а
объединение — потом. Поэтому из 7а берётся одно решение — публикация привязана к
файлу, а не только к уроку (его задача 1): оно ничего не стоит сегодня и снимает
миграцию завтра, когда на площадку коротких видео поедут три вертикальных
ролика. Остальное из 7а (реестр площадок, страница настроек, пакет для ручных
площадок, общий шаг конвейера) откладывается до объединения запуска.

## Общие ограничения

- **Имена — только латиницей**, комментарии и тексты для человека — на русском.
  Правило проверяется линтером (`no-restricted-syntax` в `eslint.config.js`).
- **Секретов в репозитории нет.** Каждая новая переменная окружения добавляется в
  `.env.example` пустой, с объяснением, тем же коммитом, что и код, который её
  читает.
- **Чужие токены лежат в базе зашифрованными** — `saveIntegration` /
  `loadIntegration` из `src/services/disk.js`, ключ в `TOKEN_ENCRYPTION_KEY`.
- **Проверка перед фиксацией — обе команды, в образе проекта:**
  ```bash
  docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app \
    my_portal-worker sh -c 'node --test --test-concurrency=8 "test/**/*.test.js"; npm run lint'
  ```
- **Пределы площадки** (проверено по документации 2026-09-08): заголовок 100
  знаков, описание 5000, теги 500 знаков суммарно, обложка 2 МБ. Область доступа
  одна — `https://www.googleapis.com/auth/youtube.force-ssl`. Обязательные поля
  ролика: `categoryId: '27'`, `defaultLanguage: 'ru'`,
  `selfDeclaredMadeForKids: false`.
- **Ролик уезжает приватным** — до аудита Google иначе нельзя. Состояние `ready`
  значит «лежит на канале, ещё не публичен»; ссылка на площадку в карточке урока
  показывается только в состоянии `published`.

## Состав файлов

| Файл | За что отвечает |
|---|---|
| `migrations/014_publications_youtube.sql` | публикация привязана к файлу; состояние `ready` |
| `src/services/publications.js` | чтение и смена состояний публикации — один вход для всех площадок |
| `src/services/platforms/youtube-auth.js` | адрес согласия, обмен кода, обновление токена |
| `src/services/platforms/youtube-fields.js` | выбор файла и субтитров, сборка полей ролика — чистые функции |
| `src/services/platforms/youtube.js` | запросы к API: загрузка, субтитры, обложка, приватность |
| `src/jobs/publish-youtube.js` | шаг очереди: связывает всё перечисленное |
| `src/routes/integrations.js` | +2 маршрута: увести на согласие, принять возврат |
| `src/routes/admin.js` | +2 маршрута: поставить выкладку, проверить приватность |
| `src/views/admin-review.js` | раздел «Площадки» на экране урока |
| `src/views/lesson.js` | правило «ссылка только у публичного ролика» — уже написано, закрепляется тестом |
| `public/admin.js` | кнопки «Отправить на YouTube» и «Проверить» |
| `src/lib/ffmpeg.js` | +`ffmpegArgsForThumbnail` — пережать тяжёлую обложку |

Почему три файла на площадку, а не один: обмен токенами и сборка полей
проверяются тестами без сети и без базы, а запросы к API — с подменённым
`fetch`. В одном файле эти три вида кода перемешались бы, и первый же тест
потребовал бы поднимать всё сразу.

---

## Задача 1: Публикация привязана к файлу и умеет состояние «лежит, но не публичен»

**Файлы:**
- Создать: `migrations/014_publications_youtube.sql`, `test/publications-schema.test.js`

**Интерфейсы:**
- Отдаёт дальше: колонку `publications.asset_id`, уникальность
  `(lesson_id, platform, asset_id)` с `NULLS NOT DISTINCT`, состояние `ready`.

- [ ] **Шаг 1: Написать падающий тест**

`test/publications-schema.test.js`:

```js
// Публикация привязана к файлу, а не только к уроку: на площадку коротких видео
// поедут все три вертикальных ролика урока, и прежнее ограничение «одна строка
// на площадку и урок» вторую вставить не давало.
//
// Состояние ready — «ролик на канале, но приватный». Без него пришлось бы либо
// врать словом published, либо держать урок в uploading после конца загрузки.
import test from 'node:test';
import assert from 'node:assert/strict';
import { saveLesson } from '../src/services/lessons.js';
import { registerAsset } from '../src/services/media.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = { media: { dir: '/tmp', ttlHours: 168 } };

test('на одну площадку помещается несколько файлов урока', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    const first = await registerAsset(pool, config, {
      lessonId: lesson.id, kind: 'clip', relativePath: 'lesson-1/clip-1.mp4', bytes: 10
    });
    const second = await registerAsset(pool, config, {
      lessonId: lesson.id, kind: 'clip', relativePath: 'lesson-1/clip-2.mp4', bytes: 10
    });

    await pool.query(
      `INSERT INTO publications (lesson_id, platform, asset_id) VALUES ($1, 'youtube', $2)`,
      [lesson.id, first.id]
    );
    await pool.query(
      `INSERT INTO publications (lesson_id, platform, asset_id) VALUES ($1, 'youtube', $2)`,
      [lesson.id, second.id]
    );

    const { rows } = await pool.query(
      'SELECT count(*)::int AS count FROM publications WHERE lesson_id = $1',
      [lesson.id]
    );
    assert.equal(rows[0].count, 2);
  });
});

test('один и тот же файл на площадку дважды не встаёт', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    const asset = await registerAsset(pool, config, {
      lessonId: lesson.id, kind: 'source', relativePath: 'lesson-1/urok.mp4', bytes: 10
    });
    await pool.query(
      `INSERT INTO publications (lesson_id, platform, asset_id) VALUES ($1, 'youtube', $2)`,
      [lesson.id, asset.id]
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO publications (lesson_id, platform, asset_id) VALUES ($1, 'youtube', $2)`,
        [lesson.id, asset.id]
      ),
      /duplicate key/
    );
  });
});

test('состояние ready допустимо', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await pool.query(
      `INSERT INTO publications (lesson_id, platform, state) VALUES ($1, 'youtube', 'ready')`,
      [lesson.id]
    );
    const { rows } = await pool.query(
      'SELECT state FROM publications WHERE lesson_id = $1',
      [lesson.id]
    );
    assert.equal(rows[0].state, 'ready');
  });
});
```

- [ ] **Шаг 2: Прогнать тест и убедиться, что он падает**

```bash
docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app \
  my_portal-worker sh -c 'node --test test/publications-schema.test.js'
```

Ожидание: падение на первом же тесте — `column "asset_id" of relation
"publications" does not exist`.

- [ ] **Шаг 3: Написать миграцию**

`migrations/014_publications_youtube.sql`:

```sql
-- Публикация привязана к файлу, а не только к уроку.
--
-- Горизонтальная запись у урока одна, а вертикальных роликов три, и на площадку
-- коротких видео поедут все. Прежнее ограничение «одна строка на площадку и
-- урок» вторую строку вставить не давало — а узнали бы мы об этом на первой же
-- площадке коротких видео, уже написав адаптер.
ALTER TABLE publications ADD COLUMN asset_id bigint REFERENCES assets(id) ON DELETE CASCADE;

ALTER TABLE publications DROP CONSTRAINT publications_lesson_id_platform_key;

-- NULLS NOT DISTINCT обязателен: без него postgres считает две строки с пустым
-- файлом разными, и защита от двойной публикации молча перестаёт работать
-- ровно там, где файл не указан.
CREATE UNIQUE INDEX publications_lesson_platform_asset_key
  ON publications (lesson_id, platform, asset_id) NULLS NOT DISTINCT;

-- «Лежит на канале, но приватный» — не published и не uploading.
--
-- До аудита Google ролик, залитый через API, принудительно остаётся приватным:
-- открыть его должен человек. Называть это published значит показать зрителю
-- ссылку в никуда, а оставить uploading — врать, что файл ещё едет.
ALTER TABLE publications DROP CONSTRAINT publications_state_check;
ALTER TABLE publications ADD CONSTRAINT publications_state_check
  CHECK (state IN ('planned', 'queued', 'uploading', 'ready', 'published', 'failed'));
```

- [ ] **Шаг 4: Прогнать тест и убедиться, что он проходит**

```bash
docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app \
  my_portal-worker sh -c 'node --test test/publications-schema.test.js'
```

Ожидание: три теста зелёные.

- [ ] **Шаг 5: Зафиксировать**

```bash
git add migrations/014_publications_youtube.sql test/publications-schema.test.js
git commit -m "feat: публикация привязана к файлу и знает состояние «лежит, но не публичен»"
```

---

## Задача 2: Состояния публикации — один вход вместо запросов по коду

**Файлы:**
- Создать: `src/services/publications.js`, `test/publications-service.test.js`

**Интерфейсы:**
- Потребляет: пул из `src/db.js`.
- Отдаёт дальше:
  - `startPublication(pool, { lessonId, platform, assetId, mode })` → `{ id }`,
    ставит `state: 'queued'`, стирает прежнюю ошибку;
  - `markPublicationState(pool, id, { state, externalId, url, error })`;
  - `publicationsFor(pool, lessonId)` → массив
    `{ id, platform, assetId, state, mode, externalId, url, error }`.

- [ ] **Шаг 1: Написать падающий тест**

`test/publications-service.test.js`:

```js
// Состояния публикации меняются из трёх мест: маршрут ставит задачу, шаг
// очереди её ведёт, кнопка «Проверить» дожимает. Держать SQL в каждом значило бы
// однажды забыть стереть прежнюю ошибку — и урок остался бы красным после
// удачного повтора.
import test from 'node:test';
import assert from 'node:assert/strict';
import { saveLesson } from '../src/services/lessons.js';
import {
  startPublication,
  markPublicationState,
  publicationsFor
} from '../src/services/publications.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

test('повтор переписывает строку, а не заводит вторую', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });

    const first = await startPublication(pool, {
      lessonId: lesson.id, platform: 'youtube', assetId: null, mode: 'semi'
    });
    await markPublicationState(pool, first.id, { state: 'failed', error: 'квота кончилась' });

    const second = await startPublication(pool, {
      lessonId: lesson.id, platform: 'youtube', assetId: null, mode: 'semi'
    });

    assert.equal(second.id, first.id, 'строка должна быть та же');
    const [publication] = await publicationsFor(pool, lesson.id);
    assert.equal(publication.state, 'queued');
    assert.equal(publication.error, null, 'прежняя ошибка обязана стереться');
  });
});

test('ссылка и внешний номер сохраняются', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    const { id } = await startPublication(pool, {
      lessonId: lesson.id, platform: 'youtube', assetId: null, mode: 'semi'
    });

    await markPublicationState(pool, id, {
      state: 'ready',
      externalId: 'abc123',
      url: 'https://youtu.be/abc123'
    });

    const [publication] = await publicationsFor(pool, lesson.id);
    assert.equal(publication.state, 'ready');
    assert.equal(publication.externalId, 'abc123');
    assert.equal(publication.url, 'https://youtu.be/abc123');
  });
});
```

- [ ] **Шаг 2: Прогнать тест и убедиться, что он падает**

```bash
docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app \
  my_portal-worker sh -c 'node --test test/publications-service.test.js'
```

Ожидание: `Cannot find module '../src/services/publications.js'`.

- [ ] **Шаг 3: Написать сервис**

`src/services/publications.js`:

```js
// Состояния публикации урока на площадке.
//
// Задача — держать в одном месте смену состояний: их меняют маршрут (поставил
// задачу), шаг очереди (веду, кончил, упал) и кнопка «Проверить» (автор открыл
// ролик). Зачем сервисом, а не запросами по месту: строку публикации надо не
// заводить заново, а переписывать, и прежнюю ошибку при повторе стирать —
// забыть это в одном из трёх мест значит оставить урок красным после удачного
// повтора.
// Вызывается из src/routes/admin.js и src/jobs/publish-youtube.js.

/**
 * Ставит публикацию в очередь. Повтор переписывает ту же строку.
 * assetId — файл, который уезжает: у урока их несколько, и публикация привязана
 * к файлу, а не к уроку.
 */
export async function startPublication(pool, { lessonId, platform, assetId = null, mode }) {
  const { rows } = await pool.query(
    `INSERT INTO publications (lesson_id, platform, asset_id, state, mode, error, updated_at)
     VALUES ($1, $2, $3, 'queued', $4, NULL, now())
     ON CONFLICT (lesson_id, platform, asset_id)
       DO UPDATE SET state = 'queued', mode = EXCLUDED.mode, error = NULL, updated_at = now()
     RETURNING id`,
    [lessonId, platform, assetId, mode]
  );
  return { id: Number(rows[0].id) };
}

/** Записывает новое состояние. Поля, которых нет, не затираются. */
export async function markPublicationState(
  pool,
  id,
  { state, externalId = null, url = null, error = null }
) {
  await pool.query(
    `UPDATE publications
        SET state = $2,
            external_id = COALESCE($3, external_id),
            url = COALESCE($4, url),
            error = $5,
            updated_at = now()
      WHERE id = $1`,
    [id, state, externalId, url, error]
  );
}

/** Публикации урока — для кабинета и для карточки. */
export async function publicationsFor(pool, lessonId) {
  const { rows } = await pool.query(
    `SELECT id, platform, asset_id, state, mode, external_id, url, error
       FROM publications WHERE lesson_id = $1 ORDER BY platform, id`,
    [lessonId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    platform: row.platform,
    assetId: row.asset_id === null ? null : Number(row.asset_id),
    state: row.state,
    mode: row.mode,
    externalId: row.external_id,
    url: row.url,
    error: row.error
  }));
}
```

- [ ] **Шаг 4: Прогнать тест и убедиться, что он проходит**

```bash
docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app \
  my_portal-worker sh -c 'node --test test/publications-service.test.js'
```

Ожидание: два теста зелёные.

- [ ] **Шаг 5: Зафиксировать**

```bash
git add src/services/publications.js test/publications-service.test.js
git commit -m "feat: состояния публикации живут в одном месте"
```

---

## Задача 3: Подключение канала

**Файлы:**
- Создать: `src/services/platforms/youtube-auth.js`, `test/youtube-auth.test.js`
- Изменить: `src/config.js` (секция `youtube`), `.env.example`,
  `src/routes/integrations.js`, `src/views/admin-upload.js` (кнопка рядом с Диском)

**Интерфейсы:**
- Потребляет: `saveIntegration` / `loadIntegration` из `src/services/disk.js`.
- Отдаёт дальше:
  - `youtubeConsentUrl(config)` → строка;
  - `exchangeYoutubeCode(config, code, fetchImpl)` → `{ token, refreshToken, expiresAt }`;
  - `youtubeAccessToken(pool, config, fetchImpl)` → строка или `null`, сама
    обновляет протухший токен;
  - конфиг `config.youtube = { clientId, clientSecret, redirectUri, mode }`.

- [ ] **Шаг 1: Написать падающий тест**

`test/youtube-auth.test.js`:

```js
// Обмен токенами с Google. В сеть не ходим: fetch подставляется.
//
// Проверяем три вещи, каждая из которых уже ломала подключения в этом проекте:
// адрес согласия просит offline-доступ (без него refresh-токена не будет вовсе,
// и подключение перестанет работать через час), протухший токен обновляется
// сам, и секрет не утекает в текст ошибки — он уходит и в журнал, и на экран.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  youtubeConsentUrl,
  exchangeYoutubeCode,
  youtubeAccessToken
} from '../src/services/platforms/youtube-auth.js';
import { saveIntegration } from '../src/services/disk.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  tokenEncryptionKey: 'a'.repeat(64),
  youtube: {
    clientId: 'client-id',
    clientSecret: 'secret-value',
    redirectUri: 'https://portal.example/api/integrations/youtube/callback',
    mode: 'semi'
  }
};

test('адрес согласия просит offline-доступ и одну область', () => {
  const url = new URL(youtubeConsentUrl(config));
  assert.equal(url.searchParams.get('access_type'), 'offline');
  // Без prompt=consent Google не выдаёт refresh-токен на повторном
  // подключении — молча, и подключение живёт ровно час.
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(
    url.searchParams.get('scope'),
    'https://www.googleapis.com/auth/youtube.force-ssl'
  );
  assert.equal(url.searchParams.get('redirect_uri'), config.youtube.redirectUri);
});

test('код меняется на пару токенов', async () => {
  const fetchStub = async (url, options) => {
    assert.equal(String(url), 'https://oauth2.googleapis.com/token');
    assert.match(options.body, /grant_type=authorization_code/);
    return {
      ok: true,
      json: async () => ({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 3599
      })
    };
  };

  const result = await exchangeYoutubeCode(config, 'code-from-google', fetchStub);
  assert.equal(result.token, 'access-1');
  assert.equal(result.refreshToken, 'refresh-1');
  assert.ok(result.expiresAt > new Date(), 'срок годности должен быть в будущем');
});

test('секрет не попадает в текст ошибки', async () => {
  const fetchStub = async () => ({
    ok: false,
    status: 400,
    text: async () => 'invalid_grant'
  });

  await assert.rejects(exchangeYoutubeCode(config, 'stale', fetchStub), (error) => {
    assert.doesNotMatch(error.message, /secret-value/);
    assert.match(error.message, /invalid_grant/);
    return true;
  });
});

test('протухший токен обновляется сам', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveIntegration(pool, config, {
      name: 'youtube',
      token: 'stale-access',
      refreshToken: 'refresh-1',
      expiresAt: new Date(Date.now() - 60_000)
    });

    let asked = 0;
    const fetchStub = async (url, options) => {
      asked += 1;
      assert.match(options.body, /grant_type=refresh_token/);
      return { ok: true, json: async () => ({ access_token: 'access-2', expires_in: 3599 }) };
    };

    const token = await youtubeAccessToken(pool, config, fetchStub);
    assert.equal(token, 'access-2');
    assert.equal(asked, 1);

    // Свежий токен обновлять незачем: второй вызов в сеть не идёт.
    const again = await youtubeAccessToken(pool, config, fetchStub);
    assert.equal(again, 'access-2');
    assert.equal(asked, 1);
  });
});

test('без подключения токена нет, и это не ошибка', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    assert.equal(await youtubeAccessToken(pool, config, async () => {}), null);
  });
});
```

- [ ] **Шаг 2: Прогнать тест и убедиться, что он падает**

```bash
docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app \
  my_portal-worker sh -c 'node --test test/youtube-auth.test.js'
```

Ожидание: `Cannot find module '../src/services/platforms/youtube-auth.js'`.

- [ ] **Шаг 3: Написать обмен токенами**

`src/services/platforms/youtube-auth.js`:

```js
// Подключение канала YouTube.
//
// Задача — увести автора на экран согласия Google, принять возврат и держать
// живой access-токен. Зачем отдельным файлом от запросов к API: обмен токенами
// проверяется тестами без сети и без файлов, а загрузка ролика — нет.
//
// Область доступа одна: youtube.force-ssl покрывает и загрузку ролика, и
// субтитры, и обложку. Просить сверх неё вредно — заявку на аудит Google
// рассматривает человек, и лишние права в ней объясняются отдельно.
// Вызывается из src/routes/integrations.js и src/jobs/publish-youtube.js.
import { saveIntegration, loadIntegration } from '../disk.js';

const CONSENT_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

// За минуту до конца токен считаем протухшим: загрузка длинная, и обновить
// заранее дешевле, чем ловить 401 в середине файла.
const EXPIRY_MARGIN_MS = 60_000;

/** Адрес экрана согласия. */
export function youtubeConsentUrl(config) {
  const url = new URL(CONSENT_URL);
  url.searchParams.set('client_id', config.youtube.clientId);
  url.searchParams.set('redirect_uri', config.youtube.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPE);
  // Без offline и consent Google не выдаёт refresh-токен: подключение выглядит
  // удачным и перестаёт работать через час, когда истечёт первый access-токен.
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

/** Прячет секрет в тексте ответа: он уходит и в журнал, и на экран человеку. */
function hideSecret(text, secret) {
  return secret ? String(text).replaceAll(secret, '…') : String(text);
}

async function askForTokens(config, params, fetchImpl) {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Google отказал (${response.status}): ${hideSecret(text, config.youtube.clientSecret)}`
    );
  }
  return response.json();
}

/** Меняет код с экрана согласия на пару токенов. */
export async function exchangeYoutubeCode(config, code, fetchImpl = fetch) {
  const body = await askForTokens(
    config,
    {
      code,
      client_id: config.youtube.clientId,
      client_secret: config.youtube.clientSecret,
      redirect_uri: config.youtube.redirectUri,
      grant_type: 'authorization_code'
    },
    fetchImpl
  );
  return {
    token: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: new Date(Date.now() + Number(body.expires_in ?? 0) * 1000)
  };
}

/**
 * Живой access-токен. null — канал не подключён.
 * Протухший обновляет сам и сохраняет обновлённый: иначе каждая выкладка
 * начиналась бы с лишнего запроса к Google.
 */
export async function youtubeAccessToken(pool, config, fetchImpl = fetch) {
  const stored = await loadIntegration(pool, config, 'youtube');
  if (!stored) return null;

  const alive =
    stored.expiresAt && stored.expiresAt.getTime() - EXPIRY_MARGIN_MS > Date.now();
  if (alive) return stored.token;
  if (!stored.refreshToken) return null;

  const body = await askForTokens(
    config,
    {
      refresh_token: stored.refreshToken,
      client_id: config.youtube.clientId,
      client_secret: config.youtube.clientSecret,
      grant_type: 'refresh_token'
    },
    fetchImpl
  );

  const expiresAt = new Date(Date.now() + Number(body.expires_in ?? 0) * 1000);
  await saveIntegration(pool, config, {
    name: 'youtube',
    token: body.access_token,
    // Google при обновлении refresh-токен не присылает: сохраняем прежний,
    // иначе следующее обновление станет невозможным.
    refreshToken: stored.refreshToken,
    expiresAt
  });
  return body.access_token;
}
```

- [ ] **Шаг 4: Добавить настройки в конфиг и `.env.example`**

`src/config.js` — рядом с секцией `gemini`:

```js
    // Площадка YouTube. Без ключей портал работает: кнопка подключения не
    // показывается, выкладка не предлагается.
    //
    // mode — зрелость адаптера. semi: ролик уезжает приватным, публикует
    // человек. Это не наш выбор: ролики от приложения, не прошедшего аудит
    // Google, принудительно остаются приватными. После аудита сюда ставится
    // auto — и это единственное, что меняется.
    youtube: {
      clientId: env.YOUTUBE_CLIENT_ID ?? '',
      clientSecret: env.YOUTUBE_CLIENT_SECRET ?? '',
      redirectUri: env.YOUTUBE_REDIRECT_URI ?? '',
      mode: env.YOUTUBE_MODE === 'auto' ? 'auto' : 'semi'
    },
```

`.env.example` — дописать к строкам `YOUTUBE_*`:

```bash
# Площадка YouTube. Отдельный проект Google Cloud, не тот, где живёт вход через
# Google: аудит идёт по проекту, и мешать в одном экране согласия вход на сайт и
# доступ к каналу не стоит. Адрес возврата должен совпадать с тем, что записан в
# проекте Google Cloud, до последнего знака.
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REDIRECT_URI=https://example.com/api/integrations/youtube/callback
# semi — ролик уезжает приватным, публикует человек (иначе Google не даёт).
# auto — ставится после того, как приложение прошло аудит Google.
YOUTUBE_MODE=semi
```

- [ ] **Шаг 5: Написать маршруты подключения**

`src/routes/integrations.js` — добавить в `integrationRoutes`:

```js
  // Увести на экран согласия Google. Отдельным маршрутом, а не ссылкой в
  // разметке: адрес собирается из настроек, и держать его в двух местах значит
  // однажды поменять в одном.
  router.get('/youtube/connect', (req, res) => {
    if (!config.youtube.clientId) throw new PublicError('YouTube не настроен', 400);
    res.redirect(youtubeConsentUrl(config));
  });

  // Возврат с экрана согласия. Google приводит человека сюда браузером, поэтому
  // отвечаем страницей-перенаправлением, а не json.
  router.get('/youtube/callback', async (req, res) => {
    if (req.query.error) throw new PublicError(`Google отказал: ${req.query.error}`, 400);
    const code = String(req.query.code ?? '');
    if (!code) throw new PublicError('Google не прислал код', 400);

    const tokens = await exchangeYoutubeCode(config, code, fetchImpl);
    await saveIntegration(pool, config, { name: 'youtube', ...tokens });
    res.redirect('/admin/upload?youtube=connected');
  });
```

- [ ] **Шаг 6: Показать кнопку подключения**

`src/views/admin-upload.js` — рядом с блоком Яндекс Диска:

```js
${
  config.youtube?.clientId
    ? `<p class="form-row">
         ${
           youtubeConnected
             ? '<span class="hint">YouTube подключён — выкладка доступна на экране урока.</span>'
             : '<a class="button" href="/api/integrations/youtube/connect">Подключить YouTube</a>'
         }
       </p>`
    : '<p class="hint">YouTube не настроен: нет ключей приложения в окружении.</p>'
}
```

- [ ] **Шаг 7: Прогнать тест и убедиться, что он проходит**

```bash
docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app \
  my_portal-worker sh -c 'node --test test/youtube-auth.test.js test/config.test.js'
```

Ожидание: все тесты зелёные.

- [ ] **Шаг 8: Зафиксировать**

```bash
git add src/services/platforms/youtube-auth.js test/youtube-auth.test.js \
        src/config.js .env.example src/routes/integrations.js src/views/admin-upload.js
git commit -m "feat: канал YouTube подключается из кабинета"
```

---

## Задача 4: Что уезжает — выбор файла, субтитров и полей ролика

**Файлы:**
- Создать: `src/services/platforms/youtube-fields.js`, `test/youtube-fields.test.js`

**Интерфейсы:**
- Отдаёт дальше:
  - `pickVideoAsset(assets)` → файл `trimmed`, иначе `source`, иначе `null`;
  - `pickSubtitlesAsset(assets, videoAsset, settings)` → `.srt` в пару к видео
    или `null`;
  - `buildVideoBody({ lesson, publicBaseUrl, privacy })` → тело запроса к API.

- [ ] **Шаг 1: Написать падающий тест**

`test/youtube-fields.test.js`:

```js
// Что именно уезжает на площадку. Чистые функции, ни сети, ни базы.
//
// Главная проверка здесь — пара «видео и его субтитры». Монтаж сдвигает
// времена, и шаг вырезания пауз кладёт рядом СВОИ субтитры. Взять к монтажу
// субтитры исходника значит получить подписи, которые к концу урока опаздывают
// на суммарную длину вырезанных пауз — на минуты. Заметно это только на самом
// ролике, ближе к концу, и уже после выкладки.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickVideoAsset,
  pickSubtitlesAsset,
  buildVideoBody
} from '../src/services/platforms/youtube-fields.js';

const assets = [
  { id: 1, kind: 'source', path: 'lesson-15/L2-2.mp4' },
  { id: 2, kind: 'subtitles', path: 'lesson-15/subtitles.srt' },
  { id: 3, kind: 'subtitles', path: 'lesson-15/subtitles.vtt' },
  { id: 4, kind: 'trimmed', path: 'lesson-15/trimmed.mp4' },
  { id: 5, kind: 'subtitles', path: 'lesson-15/trimmed.srt' },
  { id: 6, kind: 'subtitles', path: 'lesson-15/trimmed.vtt' }
];

test('монтаж предпочитается исходнику', () => {
  assert.equal(pickVideoAsset(assets).id, 4);
});

test('без монтажа уезжает исходник', () => {
  const onlySource = assets.filter((asset) => asset.kind !== 'trimmed');
  assert.equal(pickVideoAsset(onlySource).id, 1);
});

test('видео нет вовсе — не выдумываем', () => {
  assert.equal(pickVideoAsset([{ id: 2, kind: 'subtitles', path: 'a.srt' }]), null);
});

test('субтитры берутся в пару именно к тому файлу, который уезжает', () => {
  const video = pickVideoAsset(assets);
  assert.equal(pickSubtitlesAsset(assets, video, {}).id, 5, 'к монтажу — trimmed.srt');

  const source = assets.find((asset) => asset.kind === 'source');
  assert.equal(pickSubtitlesAsset(assets, source, {}).id, 2, 'к исходнику — subtitles.srt');
});

test('vtt на площадку не уезжает — там нужен srt', () => {
  const video = assets.find((asset) => asset.kind === 'trimmed');
  assert.notEqual(pickSubtitlesAsset(assets, video, {}).id, 6);
});

test('подписи уже на записи — отдельный трек не грузим', () => {
  const video = pickVideoAsset(assets);
  // Иначе на экране две строки подписей друг под другом: одна вшитая, одна от
  // площадки. Та же галка уже гасит вшивание подписей в вертикальные ролики.
  assert.equal(pickSubtitlesAsset(assets, video, { burnedSubtitles: true }), null);
});

test('заголовок обрезается по словам, а не по знакам', () => {
  const long = 'Планирование '.repeat(20).trim();
  const body = buildVideoBody({
    lesson: { title: long, description: 'Описание', tags: [], slug: 'urok' },
    publicBaseUrl: 'https://portal.example',
    privacy: 'private'
  });
  assert.ok(body.snippet.title.length <= 100);
  assert.doesNotMatch(body.snippet.title, /Планиров$/, 'слово не должно рваться посередине');
});

test('в описании есть ссылка на страницу урока', () => {
  const body = buildVideoBody({
    lesson: { title: 'Урок', description: 'Про портал', tags: ['vps'], slug: 'urok-15' },
    publicBaseUrl: 'https://portal.example',
    privacy: 'private'
  });
  assert.match(body.snippet.description, /Про портал/);
  assert.match(body.snippet.description, /https:\/\/portal\.example\/lesson\/urok-15/);
});

test('обязательные поля площадки на месте', () => {
  const body = buildVideoBody({
    lesson: { title: 'Урок', description: '', tags: [], slug: 'urok' },
    publicBaseUrl: 'https://portal.example',
    privacy: 'private'
  });
  // Без этих трёх YouTube не принимает загрузку вовсе.
  assert.equal(body.snippet.categoryId, '27');
  assert.equal(body.snippet.defaultLanguage, 'ru');
  assert.equal(body.status.selfDeclaredMadeForKids, false);
  assert.equal(body.status.privacyStatus, 'private');
});

test('теги не длиннее пятисот знаков суммарно', () => {
  const tags = Array.from({ length: 100 }, (_, index) => `тег-номер-${index}`);
  const body = buildVideoBody({
    lesson: { title: 'Урок', description: '', tags, slug: 'urok' },
    publicBaseUrl: 'https://portal.example',
    privacy: 'private'
  });
  const total = body.snippet.tags.join('').length;
  assert.ok(total <= 500, `суммарная длина тегов ${total}`);
  assert.ok(body.snippet.tags.length > 0, 'хоть сколько-то тегов должно остаться');
});
```

- [ ] **Шаг 2: Прогнать тест и убедиться, что он падает**

```bash
docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app \
  my_portal-worker sh -c 'node --test test/youtube-fields.test.js'
```

Ожидание: `Cannot find module '../src/services/platforms/youtube-fields.js'`.

- [ ] **Шаг 3: Написать сборку полей**

`src/services/platforms/youtube-fields.js`:

```js
// Что уезжает на YouTube: какой файл, какие субтитры, какие поля.
//
// Отдельным файлом от запросов к API, потому что это чистые решения: их можно
// проверить целиком, не поднимая ни сети, ни базы, ни файлов. Ошибка здесь
// стоит дорого — заметить перепутанные субтитры можно только на готовом ролике,
// ближе к концу, и уже после выкладки.
// Вызывается из src/jobs/publish-youtube.js.

// Пределы площадки. Проверено по документации 2026-09-08.
const TITLE_LIMIT = 100;
const DESCRIPTION_LIMIT = 5000;
const TAGS_TOTAL_LIMIT = 500;

// Образование. Числом, потому что площадка требует строку с номером категории.
const CATEGORY_EDUCATION = '27';

/** Смонтированная запись, если она собрана; иначе исходник. */
export function pickVideoAsset(assets) {
  return (
    assets.find((asset) => asset.kind === 'trimmed') ??
    assets.find((asset) => asset.kind === 'source') ??
    null
  );
}

/**
 * Субтитры в пару к тому файлу, который уезжает.
 *
 * Монтаж сдвигает времена, и рядом с ним лежат собственные субтитры
 * (`trimmed.srt`). В базе оба набора помечены одним kind и различаются только
 * именем файла — поэтому ищем по имени, а не по виду.
 */
export function pickSubtitlesAsset(assets, videoAsset, settings = {}) {
  // Подписи уже вшиты автором — свой трек дал бы две строки на экране.
  if (settings.burnedSubtitles) return null;
  if (!videoAsset) return null;

  const base = videoAsset.path.replace(/\.[^.]+$/, '');
  return (
    assets.find((asset) => asset.kind === 'subtitles' && asset.path === `${base}.srt`) ?? null
  );
}

/** Обрезает по границе слова: рваное слово в заголовке читается как опечатка. */
function trimWords(text, limit) {
  const value = String(text ?? '').trim();
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > limit / 2 ? cut.slice(0, lastSpace) : cut).trim();
}

/** Теги, пока не кончился общий предел площадки. */
function fitTags(tags, limit) {
  const kept = [];
  let total = 0;
  for (const tag of tags ?? []) {
    if (total + tag.length > limit) break;
    kept.push(tag);
    total += tag.length;
  }
  return kept;
}

/** Тело запроса на создание ролика. */
export function buildVideoBody({ lesson, publicBaseUrl, privacy }) {
  const link = `${publicBaseUrl}/lesson/${lesson.slug}`;
  const description = trimWords(
    `${lesson.description ?? ''}\n\nУрок на портале: ${link}`.trim(),
    DESCRIPTION_LIMIT
  );

  return {
    snippet: {
      title: trimWords(lesson.title, TITLE_LIMIT),
      description,
      tags: fitTags(lesson.tags, TAGS_TOTAL_LIMIT),
      categoryId: CATEGORY_EDUCATION,
      defaultLanguage: 'ru'
    },
    status: {
      privacyStatus: privacy,
      // Обязательное поле: без него площадка отказывает в загрузке целиком.
      selfDeclaredMadeForKids: false
    }
  };
}
```

- [ ] **Шаг 4: Прогнать тест и убедиться, что он проходит**

```bash
docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app \
  my_portal-worker sh -c 'node --test test/youtube-fields.test.js'
```

Ожидание: десять тестов зелёные.

- [ ] **Шаг 5: Зафиксировать**

```bash
git add src/services/platforms/youtube-fields.js test/youtube-fields.test.js
git commit -m "feat: поля ролика и пара «видео — его субтитры»"
```

---

## Задача 5: Обложка не тяжелее предела площадки

**Файлы:**
- Изменить: `src/lib/ffmpeg.js` (+`ffmpegArgsForThumbnail`), `test/ffmpeg.test.js`

**Интерфейсы:**
- Отдаёт дальше: `ffmpegArgsForThumbnail({ input, output })` → массив аргументов.

- [ ] **Шаг 1: Написать падающий тест**

Дописать в `test/ffmpeg.test.js`:

```js
test('обложка пережимается в пределы площадки', () => {
  // Предел YouTube — 2 МБ. Обложка, выбранная заказчиком для первого же урока,
  // весит 2 040 881 байт: с какой стороны предела она окажется, зависит от
  // того, считает площадка мегабайт как 1 000 000 или 1 048 576. Гадать не
  // будем — тяжёлое пережимаем.
  const args = ffmpegArgsForThumbnail({ input: '/media/cover.jpg', output: '/media/thumb.jpg' });
  assert.ok(args.includes('/media/cover.jpg'));
  assert.ok(args.includes('/media/thumb.jpg'));
  // Ширина ролика на площадке — 1280; больше отдавать незачем.
  assert.ok(args.some((arg) => /scale=.*1280/.test(String(arg))));
  assert.ok(args.includes('-q:v'), 'без пережатия качеством размер не упадёт');
});
```

- [ ] **Шаг 2: Прогнать тест и убедиться, что он падает**

```bash
docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app \
  my_portal-worker sh -c 'node --test test/ffmpeg.test.js'
```

Ожидание: `ffmpegArgsForThumbnail is not a function`.

- [ ] **Шаг 3: Написать аргументы**

`src/lib/ffmpeg.js` — рядом с `ffmpegArgsForCover`:

```js
/**
 * Аргументы для обложки под предел площадки.
 * Ширина 1280 — та, что показывает YouTube; отдавать больше значит платить
 * мегабайтами за пиксели, которых никто не увидит.
 */
export function ffmpegArgsForThumbnail({ input, output }) {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', input,
    // min() держит меньшие картинки нетронутыми: растягивать обложку вверх
    // незачем, от этого она только тяжелеет.
    '-vf', "scale='min(1280,iw)':-2",
    '-q:v', '4',
    '-y',
    output
  ];
}
```

- [ ] **Шаг 4: Прогнать тест и убедиться, что он проходит**

```bash
docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app \
  my_portal-worker sh -c 'node --test test/ffmpeg.test.js'
```

Ожидание: все тесты файла зелёные.

- [ ] **Шаг 5: Зафиксировать**

```bash
git add src/lib/ffmpeg.js test/ffmpeg.test.js
git commit -m "feat: обложка пережимается под предел площадки"
```

---

## Задача 6: Запросы к площадке

**Файлы:**
- Создать: `src/services/platforms/youtube.js`, `test/youtube-api.test.js`

**Интерфейсы:**
- Потребляет: `buildVideoBody` из `youtube-fields.js`.
- Отдаёт дальше:
  - `startUploadSession({ token, body, fileBytes, fetchImpl })` → адрес сессии;
  - `uploadVideoFile({ sessionUrl, filePath, fileBytes, fetchImpl })` → `{ videoId }`;
  - `insertCaptions({ token, videoId, filePath, fetchImpl })`;
  - `setThumbnail({ token, videoId, filePath, fetchImpl })`;
  - `readVideoPrivacy({ token, videoId, fetchImpl })` → `'private' | 'unlisted' | 'public'`;
  - `describeYoutubeFailure(status, body)` → строка для человека.

- [ ] **Шаг 1: Написать падающий тест**

`test/youtube-api.test.js`:

```js
// Запросы к YouTube. В сеть не ходим: fetch подставляется.
//
// Проверяем то, что нельзя увидеть глазами на готовом ролике: что загрузка
// открывает возобновляемую сессию и шлёт тело потоком, а не целиком в памяти
// (у воркера потолок 1.4 ГБ, и файл на 700 МБ его убьёт), и что чужие ошибки
// переводятся человеку — исчерпанная квота это не поломка.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  startUploadSession,
  uploadVideoFile,
  insertCaptions,
  readVideoPrivacy,
  describeYoutubeFailure
} from '../src/services/platforms/youtube.js';

test('сессия загрузки открывается с размером файла и типом', async () => {
  const fetchStub = async (url, options) => {
    assert.match(String(url), /uploadType=resumable/);
    assert.equal(options.headers['X-Upload-Content-Length'], '700');
    assert.equal(options.headers.Authorization, 'Bearer access-1');
    return { ok: true, headers: new Headers({ location: 'https://upload.example/session-1' }) };
  };

  const sessionUrl = await startUploadSession({
    token: 'access-1',
    body: { snippet: {}, status: {} },
    fileBytes: 700,
    fetchImpl: fetchStub
  });
  assert.equal(sessionUrl, 'https://upload.example/session-1');
});

test('файл уходит потоком, а не строкой в памяти', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'youtube-'));
  const file = path.join(dir, 'urok.mp4');
  await writeFile(file, 'x'.repeat(1024));

  const fetchStub = async (url, options) => {
    assert.equal(String(url), 'https://upload.example/session-1');
    assert.equal(options.method, 'PUT');
    // Строка или буфер здесь означали бы весь файл в памяти.
    assert.ok(
      typeof options.body === 'object' && typeof options.body.pipe === 'function',
      'тело обязано быть потоком'
    );
    assert.equal(options.duplex, 'half', 'без duplex Node не отправляет поток');
    return { ok: true, json: async () => ({ id: 'video-1' }) };
  };

  const result = await uploadVideoFile({
    sessionUrl: 'https://upload.example/session-1',
    filePath: file,
    fileBytes: 1024,
    fetchImpl: fetchStub
  });
  assert.equal(result.videoId, 'video-1');
});

test('субтитры уходят отдельным запросом', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'youtube-'));
  const file = path.join(dir, 'subtitles.srt');
  await writeFile(file, '1\n00:00:01,000 --> 00:00:02,000\nречь\n');

  let asked = null;
  const fetchStub = async (url, options) => {
    asked = { url: String(url), options };
    return { ok: true, json: async () => ({ id: 'caption-1' }) };
  };

  await insertCaptions({
    token: 'access-1',
    videoId: 'video-1',
    filePath: file,
    fetchImpl: fetchStub
  });
  assert.match(asked.url, /captions/);
  assert.match(asked.url, /part=snippet/);
});

test('приватность ролика читается', async () => {
  const fetchStub = async (url) => {
    assert.match(String(url), /videos\?part=status&id=video-1/);
    return { ok: true, json: async () => ({ items: [{ status: { privacyStatus: 'public' } }] }) };
  };
  assert.equal(
    await readVideoPrivacy({ token: 'access-1', videoId: 'video-1', fetchImpl: fetchStub }),
    'public'
  );
});

test('удалённый ролик не выдаёт себя за приватный', async () => {
  const fetchStub = async () => ({ ok: true, json: async () => ({ items: [] }) });
  assert.equal(
    await readVideoPrivacy({ token: 'access-1', videoId: 'gone', fetchImpl: fetchStub }),
    null
  );
});

test('исчерпанная квота называется квотой, а не поломкой', () => {
  const text = describeYoutubeFailure(403, {
    error: { errors: [{ reason: 'quotaExceeded' }], message: 'The request cannot be completed…' }
  });
  assert.match(text, /квота/i);
  assert.doesNotMatch(text, /The request cannot be completed/);
});

test('незнакомый отказ показывается как есть, а не проглатывается', () => {
  const text = describeYoutubeFailure(400, { error: { message: 'Invalid video metadata' } });
  assert.match(text, /Invalid video metadata/);
  assert.match(text, /400/);
});
```

- [ ] **Шаг 2: Прогнать тест и убедиться, что он падает**

```bash
docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app \
  my_portal-worker sh -c 'node --test test/youtube-api.test.js'
```

Ожидание: `Cannot find module '../src/services/platforms/youtube.js'`.

- [ ] **Шаг 3: Написать запросы**

`src/services/platforms/youtube.js`:

```js
// Запросы к YouTube Data API.
//
// Задача — залить ролик, субтитры и обложку и уметь спросить, публичен ли
// ролик. Зачем возобновляемая загрузка: файл урока — сотни мегабайт, обычная
// загрузка одним куском теряет всё при обрыве связи, а тело в памяти убило бы
// воркер с его потолком в 1.4 ГБ. Поэтому сессия и поток с диска.
// Вызывается из src/jobs/publish-youtube.js.
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';

const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';
const CAPTIONS_URL = 'https://www.googleapis.com/upload/youtube/v3/captions';
const THUMBNAIL_URL = 'https://www.googleapis.com/upload/youtube/v3/thumbnails/set';
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';

/** Переводит отказ площадки человеку. */
export function describeYoutubeFailure(status, body) {
  const reason = body?.error?.errors?.[0]?.reason ?? '';
  if (reason === 'quotaExceeded' || reason === 'uploadLimitExceeded') {
    return 'Суточная норма загрузок YouTube исчерпана. Это не поломка — попробуйте завтра.';
  }
  if (reason === 'forbidden' || status === 401) {
    return 'YouTube не принял доступ: подключите канал заново на странице загрузки.';
  }
  const message = body?.error?.message ?? '';
  return `YouTube отказал (${status})${message ? `: ${message}` : ''}`;
}

async function failure(response) {
  const body = await response.json().catch(() => ({}));
  throw new Error(describeYoutubeFailure(response.status, body));
}

/** Открывает возобновляемую сессию и возвращает её адрес. */
export async function startUploadSession({ token, body, fileBytes, fetchImpl = fetch }) {
  const response = await fetchImpl(
    `${UPLOAD_URL}?uploadType=resumable&part=snippet,status`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': 'video/*',
        'X-Upload-Content-Length': String(fileBytes)
      },
      body: JSON.stringify(body)
    }
  );
  if (!response.ok) await failure(response);

  const sessionUrl = response.headers.get('location');
  if (!sessionUrl) throw new Error('YouTube не дал адрес сессии загрузки');
  return sessionUrl;
}

/**
 * Шлёт файл в открытую сессию потоком.
 * duplex: 'half' обязателен — без него Node отказывается отправлять поток телом
 * запроса, и ошибка выглядит как «body is not supported».
 */
export async function uploadVideoFile({ sessionUrl, filePath, fileBytes, fetchImpl = fetch }) {
  const response = await fetchImpl(sessionUrl, {
    method: 'PUT',
    headers: { 'Content-Length': String(fileBytes), 'Content-Type': 'video/*' },
    body: createReadStream(filePath),
    duplex: 'half'
  });
  if (!response.ok) await failure(response);

  const body = await response.json();
  return { videoId: body.id };
}

/** Кладёт субтитры отдельным треком. */
export async function insertCaptions({ token, videoId, filePath, fetchImpl = fetch }) {
  const metadata = {
    snippet: { videoId, language: 'ru', name: 'Русские субтитры', isDraft: false }
  };
  const form = new FormData();
  form.append(
    'snippet',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  // Субтитры — десятки килобайт, их чтение целиком памяти не стоит.
  form.append('file', new Blob([await readFile(filePath)], { type: 'application/octet-stream' }));

  const response = await fetchImpl(`${CAPTIONS_URL}?part=snippet&uploadType=multipart`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  if (!response.ok) await failure(response);
}

/** Ставит обложку. Файл обязан быть не тяжелее двух мегабайт. */
export async function setThumbnail({ token, videoId, filePath, fetchImpl = fetch }) {
  const response = await fetchImpl(`${THUMBNAIL_URL}?videoId=${encodeURIComponent(videoId)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' },
    body: await readFile(filePath)
  });
  if (!response.ok) await failure(response);
}

/** Приватность ролика. null — ролика больше нет. */
export async function readVideoPrivacy({ token, videoId, fetchImpl = fetch }) {
  const response = await fetchImpl(
    `${VIDEOS_URL}?part=status&id=${encodeURIComponent(videoId)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!response.ok) await failure(response);

  const body = await response.json();
  return body.items?.[0]?.status?.privacyStatus ?? null;
}
```

- [ ] **Шаг 4: Прогнать тест и убедиться, что он проходит**

```bash
docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app \
  my_portal-worker sh -c 'node --test test/youtube-api.test.js'
```

Ожидание: семь тестов зелёные.

- [ ] **Шаг 5: Зафиксировать**

```bash
git add src/services/platforms/youtube.js test/youtube-api.test.js
git commit -m "feat: запросы к YouTube — загрузка потоком, субтитры, обложка"
```

---

## Задача 7: Шаг очереди — выкладка целиком

**Файлы:**
- Создать: `src/jobs/publish-youtube.js`, `test/publish-youtube.test.js`
- Изменить: `src/queue.js` (`JOBS.publishYoutube`, `NO_RETRY_JOBS`),
  `src/worker.js` (обработчик и сообщение об окончании)

**Интерфейсы:**
- Потребляет: всё из задач 2–6.
- Отдаёт дальше: `makePublishYoutube(config, pool, deps)` — обработчик задачи
  `publishYoutube` с данными `{ lessonId, publicationId }`.

- [ ] **Шаг 1: Написать падающий тест**

`test/publish-youtube.test.js`:

```js
// Шаг выкладки целиком. Сеть и ffmpeg подменяются: проверяется порядок работы и
// то, как шаг ведёт состояния.
//
// Отдельно проверяется мягкость необязательных частей: ролик уже на канале, и
// ронять выкладку из-за обложки значило бы показать автору «упало» там, где всё
// главное удалось.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makePublishYoutube } from '../src/jobs/publish-youtube.js';
import { saveLesson } from '../src/services/lessons.js';
import { registerAsset } from '../src/services/media.js';
import { startPublication, publicationsFor } from '../src/services/publications.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  media: { dir: '/tmp', ttlHours: 168 },
  publicBaseUrl: 'https://portal.example',
  youtube: { mode: 'semi' }
};

/** Заглушки площадки: считают вызовы и отдают заранее известные ответы. */
function platformStub(overrides = {}) {
  const calls = [];
  return {
    calls,
    accessToken: async () => 'access-1',
    startUploadSession: async () => (calls.push('session'), 'https://upload.example/1'),
    uploadVideoFile: async () => (calls.push('upload'), { videoId: 'video-1' }),
    insertCaptions: async () => calls.push('captions'),
    setThumbnail: async () => calls.push('thumbnail'),
    shrinkThumbnail: async (path) => path,
    ...overrides
  };
}

test('удачная выкладка доводит публикацию до «лежит, но не публичен»', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    const video = await registerAsset(pool, config, {
      lessonId: lesson.id, kind: 'source', relativePath: 'lesson-1/urok.mp4', bytes: 1024
    });
    await registerAsset(pool, config, {
      lessonId: lesson.id, kind: 'subtitles', relativePath: 'lesson-1/urok.srt', bytes: 10
    });
    const { id } = await startPublication(pool, {
      lessonId: lesson.id, platform: 'youtube', assetId: video.id, mode: 'semi'
    });

    const platform = platformStub();
    const handler = makePublishYoutube(config, pool, platform);
    await handler({ lessonId: lesson.id, publicationId: id });

    const [publication] = await publicationsFor(pool, lesson.id);
    assert.equal(publication.state, 'ready');
    assert.equal(publication.externalId, 'video-1');
    assert.match(publication.url, /video-1/);
    assert.deepEqual(platform.calls, ['session', 'upload', 'captions', 'thumbnail']);
  });
});

test('отказ обложки не роняет выкладку', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    const video = await registerAsset(pool, config, {
      lessonId: lesson.id, kind: 'source', relativePath: 'lesson-1/urok.mp4', bytes: 1024
    });
    const { id } = await startPublication(pool, {
      lessonId: lesson.id, platform: 'youtube', assetId: video.id, mode: 'semi'
    });

    const platform = platformStub({
      setThumbnail: async () => {
        throw new Error('канал не подтверждён');
      }
    });
    const handler = makePublishYoutube(config, pool, platform);
    await handler({ lessonId: lesson.id, publicationId: id });

    const [publication] = await publicationsFor(pool, lesson.id);
    assert.equal(publication.state, 'ready', 'ролик уже на канале — это не провал');
    assert.match(publication.error, /обложк/i, 'но сказать об этом надо');
  });
});

test('отказ загрузки записывается причиной, а не молчанием', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    const video = await registerAsset(pool, config, {
      lessonId: lesson.id, kind: 'source', relativePath: 'lesson-1/urok.mp4', bytes: 1024
    });
    const { id } = await startPublication(pool, {
      lessonId: lesson.id, platform: 'youtube', assetId: video.id, mode: 'semi'
    });

    const platform = platformStub({
      uploadVideoFile: async () => {
        throw new Error('Суточная норма загрузок YouTube исчерпана.');
      }
    });
    const handler = makePublishYoutube(config, pool, platform);

    await assert.rejects(handler({ lessonId: lesson.id, publicationId: id }), /норма/);
    const [publication] = await publicationsFor(pool, lesson.id);
    assert.equal(publication.state, 'failed');
    assert.match(publication.error, /норма/);
  });
});

test('без подключённого канала шаг говорит это словами', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    const video = await registerAsset(pool, config, {
      lessonId: lesson.id, kind: 'source', relativePath: 'lesson-1/urok.mp4', bytes: 1024
    });
    const { id } = await startPublication(pool, {
      lessonId: lesson.id, platform: 'youtube', assetId: video.id, mode: 'semi'
    });

    const handler = makePublishYoutube(config, pool, platformStub({ accessToken: async () => null }));
    await assert.rejects(
      handler({ lessonId: lesson.id, publicationId: id }),
      /канал .* не подключ/i
    );
  });
});
```

- [ ] **Шаг 2: Прогнать тест и убедиться, что он падает**

```bash
docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app \
  my_portal-worker sh -c 'node --test test/publish-youtube.test.js'
```

Ожидание: `Cannot find module '../src/jobs/publish-youtube.js'`.

- [ ] **Шаг 3: Написать шаг**

`src/jobs/publish-youtube.js`:

```js
// Шаг конвейера: выкладка урока на YouTube.
//
// Задача — связать выбор файлов, обмен токенами и запросы к площадке, ведя
// состояние публикации. Зачем шагом очереди, а не в запросе: файл — сотни
// мегабайт, заливка идёт минутами, а HTTP-запрос столько не живёт.
//
// Площадка приходит зависимостью (deps), а не импортом: так шаг проверяется
// тестом без сети, и так же в него однажды встанет вторая площадка.
// Вызывается воркером по имени JOBS.publishYoutube.
import { assetsOfLesson, mediaPath } from '../services/media.js';
import { getLessonById } from '../services/lessons.js';
import { readSettings } from '../lib/settings.js';
import { markPublicationState } from '../services/publications.js';
import {
  pickVideoAsset,
  pickSubtitlesAsset,
  buildVideoBody
} from '../services/platforms/youtube-fields.js';

// Предел площадки — 2 МБ. Порог ниже предела: обложка ровно на границе уже
// встречалась, и гадать, считает YouTube мегабайт как 1 000 000 или
// 1 048 576, мы не будем.
const THUMBNAIL_LIMIT_BYTES = 1_900_000;

export function makePublishYoutube(config, pool, platform) {
  return async ({ lessonId, publicationId }) => {
    const token = await platform.accessToken(pool, config);
    if (!token) throw new Error('Канал YouTube не подключён — подключите его на странице загрузки');

    const lesson = await getLessonById(pool, lessonId);
    if (!lesson) throw new Error('Урок не найден');

    const assets = await assetsOfLesson(pool, lessonId);
    const video = pickVideoAsset(assets);
    if (!video) throw new Error('Записи нет в буфере — загрузите её заново');

    const settings = readSettings(lesson.settings);
    const subtitles = pickSubtitlesAsset(assets, video, settings);

    await markPublicationState(pool, publicationId, { state: 'uploading' });

    // Приватность решает режим: до аудита Google публичным ролик не сделать,
    // и просить об этом бессмысленно — площадка молча оставит приватным.
    const privacy = config.youtube.mode === 'auto' ? 'public' : 'private';
    const body = buildVideoBody({ lesson, publicBaseUrl: config.publicBaseUrl, privacy });

    const filePath = mediaPath(config, video.path);
    const sessionUrl = await platform.startUploadSession({
      token,
      body,
      fileBytes: Number(video.bytes)
    });

    let videoId;
    try {
      ({ videoId } = await platform.uploadVideoFile({
        sessionUrl,
        filePath,
        fileBytes: Number(video.bytes)
      }));
    } catch (error) {
      await markPublicationState(pool, publicationId, {
        state: 'failed',
        error: error.message.slice(0, 500)
      });
      throw error;
    }

    // Ролик на канале. Дальше необязательное: его отказ — повод сказать, а не
    // объявить выкладку провалившейся.
    const complaints = [];

    if (subtitles) {
      try {
        await platform.insertCaptions({
          token,
          videoId,
          filePath: mediaPath(config, subtitles.path)
        });
      } catch (error) {
        complaints.push(`субтитры не встали: ${error.message}`);
      }
    }

    const cover = assets.find((asset) => `/media/asset/${asset.id}` === lesson.coverUrl);
    if (cover) {
      try {
        const ready =
          Number(cover.bytes) > THUMBNAIL_LIMIT_BYTES
            ? await platform.shrinkThumbnail(mediaPath(config, cover.path))
            : mediaPath(config, cover.path);
        await platform.setThumbnail({ token, videoId, filePath: ready });
      } catch (error) {
        complaints.push(`обложка не встала: ${error.message}`);
      }
    }

    await markPublicationState(pool, publicationId, {
      // auto ставится только после аудита Google; до него ролик приватный, и
      // published означало бы ссылку в никуда на карточке урока.
      state: config.youtube.mode === 'auto' ? 'published' : 'ready',
      externalId: videoId,
      url: `https://youtu.be/${videoId}`,
      error: complaints.length ? complaints.join('; ').slice(0, 500) : null
    });

    return { videoId, complaints: complaints.length };
  };
}
```

- [ ] **Шаг 4: Добавить недостающие чтения в сервисы**

`src/services/media.js` — если `assetsOfLesson` ещё нет:

```js
/** Все файлы урока: шагам нужен выбор, а не один известный заранее. */
export async function assetsOfLesson(pool, lessonId) {
  const { rows } = await pool.query(
    'SELECT id, kind, path, bytes FROM assets WHERE lesson_id = $1 ORDER BY id',
    [lessonId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    kind: row.kind,
    path: row.path,
    bytes: Number(row.bytes)
  }));
}
```

`src/services/lessons.js` — если `getLessonById` ещё нет, добавить рядом с
`getLessonBySlug`, возвращая те же поля плюс `settings`.

- [ ] **Шаг 5: Подключить шаг к очереди и воркеру**

`src/queue.js`:

```js
  // Выкладка на площадку: своё имя у каждой площадки, потому что у каждой свой
  // запуск. Общий шаг появится, когда площадок станет несколько и станет видно,
  // что у них правда общего.
  publishYoutube: 'publishYoutube'
```

и в `NO_RETRY_JOBS`:

```js
// publishYoutube в повторах: автоматический повтор после наполовину прошедшей
// загрузки рискует вторым роликом на канале — а удалять его придётся руками.
// Решение о повторе тут за человеком, в кабинете для этого есть кнопка.
const NO_RETRY_JOBS = new Set([JOBS.transcribe, JOBS.makeClips, JOBS.trimPauses, JOBS.publishYoutube]);
```

`src/worker.js` — обработчик и сообщение:

```js
  [JOBS.publishYoutube]: makePublishYoutube(config, pool, {
    accessToken: youtubeAccessToken,
    startUploadSession,
    uploadVideoFile,
    insertCaptions,
    setThumbnail,
    shrinkThumbnail: (filePath) => shrinkThumbnail(config, filePath)
  }),
```

```js
  [JOBS.publishYoutube]: {
    title: 'Ролик на YouTube',
    body: 'Лежит приватным — откройте его в студии'
  },
```

`publishYoutube` в `PIPELINE_JOBS` **не добавляется**: выкладка не ведёт урок по
конвейеру, и её отказ не должен помечать готовый урок словом «обработка упала».

- [ ] **Шаг 6: Прогнать тесты и убедиться, что они проходят**

```bash
docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app \
  my_portal-worker sh -c 'node --test --test-concurrency=8 "test/**/*.test.js"'
```

Ожидание: все тесты зелёные, включая четыре новых.

- [ ] **Шаг 7: Зафиксировать**

```bash
git add src/jobs/publish-youtube.js test/publish-youtube.test.js \
        src/queue.js src/worker.js src/services/media.js src/services/lessons.js
git commit -m "feat: шаг выкладки на YouTube"
```

---

## Задача 8: Кнопка, состояние и честная ссылка

**Файлы:**
- Изменить: `src/routes/admin.js`, `src/views/admin-review.js`, `src/views/lesson.js`,
  `public/admin.js`
- Создать: `test/publish-routes.test.js`
- Изменить: `test/html.test.js` (ссылка на площадку только для `published`)

**Интерфейсы:**
- Потребляет: `startPublication`, `publicationsFor`, `readVideoPrivacy`.
- Отдаёт дальше: `POST /api/admin/lessons/:slug/publish/youtube` →
  `{ publicationId, state }`; `POST /api/admin/lessons/:slug/publish/youtube/check` →
  `{ state }`.

- [ ] **Шаг 1: Написать падающий тест**

`test/publish-routes.test.js`:

```js
// Кнопка выкладки и кнопка «Проверить». Очередь и площадка подменяются: в тесте
// незачем ни Redis, ни сеть.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveLesson } from '../src/services/lessons.js';
import { publicationsFor, startPublication } from '../src/services/publications.js';
import { saveIntegration } from '../src/services/disk.js';
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
  youtube: { clientId: 'id', clientSecret: 'secret', redirectUri: '/back', mode: 'semi' }
};

function asAdmin(adminId) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${signSession({ userId: adminId, role: 'admin' }, config.jwtSecret)}`
  };
}

/** Урок с записью в буфере и админ, от чьего имени идут запросы. */
async function seed(pool, { withSource = true } = {}) {
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  if (withSource) {
    await pool.query(
      `INSERT INTO assets (lesson_id, kind, path, bytes, expires_at)
       VALUES ($1, 'source', 'lesson-1/urok.mp4', 1024, now() + interval '7 days')`,
      [lesson.id]
    );
  }
  return { lesson, adminId: Number(rows[0].id) };
}

test('кнопка ставит выкладку в очередь', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, adminId } = await seed(pool);
    const queued = [];
    const app = createApp({
      config,
      pool,
      queue: { add: async (name, data) => queued.push({ name, data }) }
    });

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/admin/lessons/urok/publish/youtube`, {
        method: 'POST',
        headers: asAdmin(adminId)
      });
      assert.equal(response.status, 200);
    });

    const [publication] = await publicationsFor(pool, lesson.id);
    assert.equal(publication.state, 'queued');
    assert.equal(publication.mode, 'semi');
    assert.equal(queued.length, 1, 'задача обязана уйти в очередь');
    assert.equal(queued[0].name, 'publishYoutube');
  });
});

test('без записи выкладку не ставим и говорим почему', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { adminId } = await seed(pool, { withSource: false });
    const app = createApp({ config, pool, queue: { add: async () => {} } });

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/admin/lessons/urok/publish/youtube`, {
        method: 'POST',
        headers: asAdmin(adminId)
      });
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.match(body.error, /запис/i);
    });
  });
});

test('«Проверить» переводит открытый ролик в published', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, adminId } = await seed(pool);
    const { id } = await startPublication(pool, {
      lessonId: lesson.id, platform: 'youtube', assetId: null, mode: 'semi'
    });
    await pool.query(
      `UPDATE publications SET state = 'ready', external_id = 'video-1' WHERE id = $1`,
      [id]
    );

    // Канал подключён и токен свежий — обновлять его не придётся, поэтому
    // подменённому fetch достаётся один запрос: приватность ролика.
    await saveIntegration(pool, config, {
      name: 'youtube',
      token: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: new Date(Date.now() + 3600_000)
    });
    const app = createApp({
      config,
      pool,
      queue: { add: async () => {} },
      fetchImpl: async (url) => {
        assert.match(String(url), /videos\?part=status/);
        return { ok: true, json: async () => ({ items: [{ status: { privacyStatus: 'public' } }] }) };
      }
    });

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/admin/lessons/urok/publish/youtube/check`, {
        method: 'POST',
        headers: asAdmin(adminId)
      });
      assert.equal((await response.json()).state, 'published');
    });

    const [publication] = await publicationsFor(pool, lesson.id);
    assert.equal(publication.state, 'published');
  });
});

test('всё ещё приватный ролик остаётся ready', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, adminId } = await seed(pool);
    const { id } = await startPublication(pool, {
      lessonId: lesson.id, platform: 'youtube', assetId: null, mode: 'semi'
    });
    await pool.query(
      `UPDATE publications SET state = 'ready', external_id = 'video-1' WHERE id = $1`,
      [id]
    );

    await saveIntegration(pool, config, {
      name: 'youtube',
      token: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: new Date(Date.now() + 3600_000)
    });
    const app = createApp({
      config,
      pool,
      queue: { add: async () => {} },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ items: [{ status: { privacyStatus: 'private' } }] })
      })
    });

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/admin/lessons/urok/publish/youtube/check`, {
        method: 'POST',
        headers: asAdmin(adminId)
      });
      assert.equal((await response.json()).state, 'ready');
    });
  });
});
```

**Исполнителю:** `createApp` принимает объект — `createApp({ config, pool, fetchImpl, queue })`,
см. `src/app.js:31`. Подмена площадки идёт через уже существующий `fetchImpl`, а
не через новую зависимость: он для того и заведён, им же подменяется Яндекс Диск.
Чтобы `fetchImpl` дошёл до маршрута проверки, `adminRoutes` принимает его третьим
доводом — так же, как `integrationRoutes` (`src/app.js:71`).

Дописать в `test/html.test.js`:

```js
test('карточка молчит про площадку, пока ролик не публичен', () => {
  // Приватный ролик чужому человеку не открывается: кнопка на карточке вела бы
  // зрителя в отказ площадки. Правило в коде уже есть — тест держит его на
  // месте: строка отбора короткая, и снести её при правке соседней разметки
  // легче лёгкого, а заметит это зритель, а не мы.
  const html = lessonPage({
    config,
    user: null,
    comments: [],
    lesson: {
      id: 1,
      slug: 'urok',
      title: 'Урок',
      description: '',
      tags: [],
      coverUrl: null,
      publishedAt: new Date(),
      publications: [
        { platform: 'youtube', state: 'ready', url: 'https://youtu.be/private-1' },
        { platform: 'youtube', state: 'published', url: 'https://youtu.be/public-1' }
      ]
    }
  });
  assert.doesNotMatch(html, /private-1/, 'приватный ролик показывать нельзя');
  assert.match(html, /public-1/, 'а публичный — нужно');
});
```

`lessonPage` уже импортируется в этом файле; `config` — тот же, что у соседних
тестов. Если полей урока в вызове не хватит и вид упадёт, добавьте недостающие
по сигнатуре `lessonPage` в `src/views/lesson.js`, а не подгоняйте вид под тест.

- [ ] **Шаг 2: Прогнать тесты и убедиться, что они падают**

```bash
docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app \
  my_portal-worker sh -c 'node --test test/publish-routes.test.js test/html.test.js'
```

Ожидание: маршрутов нет — 404; карточка показывает ссылку и тест падает.

- [ ] **Шаг 3: Написать маршруты**

`src/routes/admin.js`:

```js
  // Выкладка на YouTube отдельной кнопкой, а не вместе с публикацией на
  // портале: витрина и площадка живут своей жизнью, и отказ площадки не должен
  // мешать уроку появиться на сайте.
  router.post('/lessons/:slug/publish/youtube', async (req, res) => {
    const lesson = await getLessonBySlug(pool, req.params.slug, { includeDrafts: true });
    if (!lesson) throw new PublicError('Урок не найден', 404);

    const assets = await assetsOfLesson(pool, lesson.id);
    const video = pickVideoAsset(assets);
    if (!video) throw new PublicError('Записи нет в буфере — загрузите её заново', 400);

    const publication = await startPublication(pool, {
      lessonId: lesson.id,
      platform: 'youtube',
      assetId: video.id,
      mode: config.youtube.mode
    });
    await addJob(req.app.locals.queue, JOBS.publishYoutube, {
      lessonId: lesson.id,
      publicationId: publication.id
    });
    res.json({ publicationId: publication.id, state: 'queued' });
  });

  // «Проверить»: автор открыл ролик в студии — спрашиваем площадку и снимаем
  // замок с ссылки в карточке. Опрашивать по расписанию незачем: это работа
  // ради одного нажатия раз в неделю.
  router.post('/lessons/:slug/publish/youtube/check', async (req, res) => {
    const lesson = await getLessonBySlug(pool, req.params.slug, { includeDrafts: true });
    if (!lesson) throw new PublicError('Урок не найден', 404);

    const [publication] = (await publicationsFor(pool, lesson.id)).filter(
      (item) => item.platform === 'youtube'
    );
    if (!publication?.externalId) throw new PublicError('Ролик ещё не уехал', 400);

    const token = await youtubeAccessToken(pool, config);
    if (!token) throw new PublicError('Канал YouTube не подключён', 400);

    const privacy = await readVideoPrivacy({ token, videoId: publication.externalId });
    const state = privacy === 'public' ? 'published' : publication.state;
    if (state !== publication.state) await markPublicationState(pool, publication.id, { state });
    res.json({ state });
  });
```

- [ ] **Шаг 4: Показать раздел «Площадки» на экране урока**

`src/views/admin-review.js` — новый раздел после «Что видит зритель»:

```js
<section class="card">
  <h2>Площадки</h2>
  ${
    youtube
      ? `<p>YouTube: ${PUBLICATION_STATES[youtube.state] ?? youtube.state}
           ${youtube.url ? `<a href="${escapeHtml(youtube.url)}">открыть</a>` : ''}</p>
         ${youtube.error ? `<p class="hint danger">${escapeHtml(youtube.error)}</p>` : ''}
         ${
           youtube.state === 'ready'
             ? `<p class="hint">Ролик лежит приватным: откройте его в студии и нажмите
                  «Проверить» — ссылка появится в карточке урока.</p>
                <button class="button" type="button"
                  data-youtube-check="${escapeHtml(lesson.slug)}">Проверить</button>`
             : ''
         }`
      : '<p class="hint">На YouTube ещё не отправляли.</p>'
  }
  <div class="form-row">
    <button class="button-brand" type="button" data-youtube="${escapeHtml(lesson.slug)}"
      ${hasVideo ? '' : 'disabled title="Сначала загрузите запись"'}>
      Отправить на YouTube
    </button>
  </div>
</section>
```

Словарь состояний рядом, в том же файле:

```js
// Состояние публикации человеку. «ready» на экране не объясняет ничего.
const PUBLICATION_STATES = {
  queued: 'в очереди',
  uploading: 'заливается',
  ready: 'лежит приватным, ждёт вашего нажатия',
  published: 'опубликован',
  failed: 'не уехал'
};
```

- [ ] **Шаг 5: Проверить правило в карточке — оно уже написано**

`src/views/lesson.js:53` уже отбирает публикации так:

```js
  const platformButtons = lesson.publications
    .filter((p) => p.url && p.state === 'published')
```

Менять нечего — правило «ссылка только у публичного ролика» в коде есть с этапа
2. Задача шага: убедиться, что строка на месте, и что тест из шага 1 её держит.
Если строка изменилась — вернуть отбор по `state === 'published'`.

- [ ] **Шаг 6: Написать кнопки в клиенте**

`public/admin.js`:

```js
  /* --- Выкладка на площадки ------------------------------------------------ */

  const youtubeButton = document.querySelector('[data-youtube]');
  youtubeButton?.addEventListener('click', async () => {
    try {
      await withButtonState(youtubeButton, 'Отправляю…', 'Отправлено', async () => {
        const answer = await request(
          `/api/admin/lessons/${youtubeButton.dataset.youtube}/publish/youtube`,
          { method: 'POST' }
        );
        if (!answer) return;
        toast('Ролик поехал на YouTube. Уведомление придёт, когда закончится.');
        // Состояние ведёт воркер, а не браузер: перечитываем страницу, чтобы
        // автор увидел «заливается», а не старую надпись.
        setTimeout(() => location.reload(), 1500);
      });
    } catch (error) {
      toast(`Не отправилось: ${error.message}`, true);
    }
  });

  const youtubeCheckButton = document.querySelector('[data-youtube-check]');
  youtubeCheckButton?.addEventListener('click', async () => {
    try {
      await withButtonState(youtubeCheckButton, 'Спрашиваю…', 'Готово', async () => {
        const answer = await request(
          `/api/admin/lessons/${youtubeCheckButton.dataset.youtubeCheck}/publish/youtube/check`,
          { method: 'POST' }
        );
        if (!answer) return;
        if (answer.state === 'published') {
          toast('Ролик публичный — ссылка встала в карточку урока.');
          setTimeout(() => location.reload(), 1500);
        } else {
          toast('YouTube всё ещё считает ролик приватным. Откройте его в студии.', true);
        }
      });
    } catch (error) {
      toast(`Не спросилось: ${error.message}`, true);
    }
  });
```

- [ ] **Шаг 7: Прогнать всё и убедиться, что зелено**

```bash
docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app \
  my_portal-worker sh -c 'node --test --test-concurrency=8 "test/**/*.test.js"; npm run lint'
```

Ожидание: все тесты и линтер зелёные. Сторож форм из
`test/client-contract.test.js` тоже: новые кнопки — не форма, но их зацепки
`data-youtube` и `data-youtube-check` обязаны найтись в клиенте.

- [ ] **Шаг 8: Зафиксировать**

```bash
git add src/routes/admin.js src/views/admin-review.js src/views/lesson.js \
        public/admin.js test/publish-routes.test.js test/html.test.js
git commit -m "feat: кнопка выкладки на YouTube и честная ссылка в карточке"
```

---

## Задача 9: Живая приёмка

**Файлы:**
- Создать: `docs/youtube-setup.md`

Тесты сюда не доходят: проверяется то, что можно увидеть только на настоящем
канале.

- [ ] **Шаг 1: Написать памятку по настройке**

`docs/youtube-setup.md` — по шагам, с тем, что заказчик делает руками:

1. Завести **отдельный** проект в Google Cloud (не тот, где живёт вход через
   Google): аудит идёт по проекту.
2. Включить в нём YouTube Data API v3.
3. Настроить экран согласия: тип «Внешний», добавить себя в тестовые
   пользователи, область `youtube.force-ssl`.
4. Создать учётные данные OAuth типа «Веб-приложение», записать адрес возврата
   `https://<домен>/api/integrations/youtube/callback` — **до последнего знака**
   так же, как в `.env`.
5. Положить `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI`
   в `.env` на сервере, `YOUTUBE_MODE=semi`.
6. Перезапустить `api` и `worker`.
7. На странице загрузки нажать «Подключить YouTube», выбрать аккаунт канала.

Отдельным разделом — **заявка на аудит**: что в ней пишут, что снимает
принудительную приватность и что до её прохождения `YOUTUBE_MODE` остаётся
`semi`.

- [ ] **Шаг 2: Выкатить на сервер**

```bash
docker compose build api worker && docker compose up -d api worker
```

Перед пересборкой убедиться, что очередь пуста — иначе пересоздание оборвёт
чужую работу:

```bash
docker exec shared-redis-1 redis-cli llen portal:pipeline:wait
docker exec shared-redis-1 redis-cli lrange portal:pipeline:active 0 -1
```

- [ ] **Шаг 3: Приёмка заказчиком**

Проверяется на настоящем уроке:

1. «Подключить YouTube» — экран согласия Google, возврат на портал, надпись
   «YouTube подключён».
2. «Отправить на YouTube» на экране урока — состояние меняется на «заливается»,
   по окончании приходит уведомление на телефон.
3. В студии YouTube: ролик на месте, заголовок и описание те же, что в карточке,
   в описании ссылка на урок, теги на месте, обложка та, что выбрана, субтитры
   русским треком включаются и **не разъезжаются к концу урока**.
4. Открыть ролик в студии, нажать «Проверить» на портале — состояние стало
   «опубликован», ссылка появилась на странице урока.

- [ ] **Шаг 4: Зафиксировать**

```bash
git add docs/youtube-setup.md
git commit -m "docs: как подключить канал YouTube"
```

---

## Самопроверка плана

**Покрытие спеки.** Раздел 4 (подключение) — задача 3. Раздел 5 (что уезжает) —
задачи 4 и 5. Раздел 6 (как выполняется) — задачи 6 и 7. Раздел 7 (состояния и
честная ссылка) — задачи 1, 2, 8. Раздел 8 (отказы) — задачи 6 и 7. Раздел 9
(чем проверяется) — тесты в задачах 4–8 и живая приёмка в задаче 9. Непокрытого
в спеке не осталось.

**Заглушек нет.** Все шаги несут код, команды и ожидаемый результат.

**Согласованность имён.** `startPublication` / `markPublicationState` /
`publicationsFor` (задача 2) вызываются под этими же именами в задачах 7 и 8.
`pickVideoAsset` / `pickSubtitlesAsset` / `buildVideoBody` (задача 4) — в задачах
7 и 8. `startUploadSession` / `uploadVideoFile` / `insertCaptions` /
`setThumbnail` / `readVideoPrivacy` (задача 6) — в задачах 7 и 8.
`youtubeAccessToken` (задача 3) — в задачах 7 и 8.

**Две зависимости, которых может не оказаться в коде** и которые поэтому
заведены явным шагом внутри задачи 7: `assetsOfLesson` в `src/services/media.js`
и `getLessonById` в `src/services/lessons.js`. Исполнителю: сперва проверить,
нет ли их под другим именем, и только потом заводить.

**Что самопроверка нашла в самом плане и что исправлено.** Первая редакция
опиралась на помощника `test/helpers/agent.js`, которого в проекте нет:
маршруты проверяются через `createApp` + `withServer` + подписанный токен, и
тесты переписаны на этот способ. Там же был неверный вызов `createApp` — он
принимает объект, а не три довода. И третье: правило «ссылка только у публичного
ролика» уже написано в `src/views/lesson.js:53` — план обещал его добавить, а
теперь закрепляет тестом и просит ничего не переписывать.

**Чего в плане намеренно нет:** глав в описании (решение заказчика — следующим
шагом), реестра площадок и общего запуска (появятся, когда площадок станет
несколько), публикации вертикальных нарезок.
