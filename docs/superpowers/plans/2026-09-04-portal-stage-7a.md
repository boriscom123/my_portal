# Этап 7а: основание публикации — план работ

> **Исполнителю:** ОБЯЗАТЕЛЬНЫЙ ПОДСКИЛЛ: superpowers:subagent-driven-development
> (рекомендуется) или superpowers:executing-plans — задача за задачей. Шаги
> отмечаются галочками (`- [ ]`).

**Цель:** автор подключает площадки на отдельной странице настроек, выбирает для
урока, куда он идёт, и портал ведёт публикацию: горизонтальную запись на
YouTube / Rutube / Dzen / VK Video, вертикальные нарезки на Instagram / TikTok /
Telegram / MAX — со списком ссылок на горизонтальные в описании.

**Устройство.** Публикация каждой площадки — строка в `publications` со своим
состоянием: одна упавшая не роняет остальные. За площадкой стоит адаптер с
единым интерфейсом и одним из трёх режимов зрелости (`auto`, `semi`, `manual`) —
режим есть следствие того, что полноценный автопостинг возможен не везде.
Конвейер публикации идёт двумя шагами: сначала горизонталь, потом вертикаль,
потому что в описание вертикальных роликов кладётся список ссылок на
горизонтальные.

**Технологии:** Node 24, Express 5, PostgreSQL, BullMQ, AES-256-GCM для чужих
токенов, `node:test`.

**Спека:** `docs/superpowers/specs/2026-09-01-portal-design.md` — разделы 8 (путь
урока), 9 (адаптеры площадок), 11 (соглашения по коду).

**Это первая из двух порций этапа 7.** Здесь — основание: хранение подключений,
страница настроек, интерфейс адаптера, состояния публикаций, кабинет и ручные
площадки. Сами автоматические адаптеры (YouTube, VK, Rutube, Telegram, TikTok,
Instagram) — во второй порции, планом `2026-09-XX-portal-stage-7b.md`. Разделено
не по слоям, а по сдаче: после этой порции портал уже публикует — вручную, с
готовыми пакетами материалов, — и это работающая software на своём праве.

## Общие ограничения

- **Имена — только латиницей**, комментарии и тексты для человека — на русском.
  Правило проверяется линтером (`no-restricted-syntax` в `eslint.config.js`).
- **Секретов в репозитории нет.** Каждая новая переменная окружения добавляется в
  `.env.example` пустой, с объяснением, тем же коммитом, что и код, который её
  читает.
- **Чужие токены лежат в базе зашифрованными** (AES-256-GCM, ключ
  `TOKEN_ENCRYPTION_KEY` из окружения). Сообщения об ошибках не содержат токенов:
  они уходят и в журнал, и на экран человеку.
- **Наружу ничего не уходит без нажатия автора** (спека, раздел 8, пункт 3).
- **На площадки уходит смонтированная запись**, а не исходник (спека, раздел 8,
  пункт 4). Если монтаж для урока выключен — исходник.
- Проверка перед фиксацией — обе команды в образе проекта:
  ```bash
  docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app \
    my_portal-worker sh -c 'node --test --test-concurrency=8 "test/**/*.test.js"; npm run lint'
  ```

---

## Состав файлов

| Файл | За что отвечает |
|---|---|
| `migrations/014_publications_assets.sql` | Публикация знает, какой файл выложен; ручным площадкам — место под ссылку от автора |
| `src/services/integrations.js` | Хранение подключений к чужим сервисам (перенос из `services/disk.js`) |
| `src/platforms/index.js` | Реестр площадок: имя, режим, что умеет, как подключается |
| `src/platforms/manual.js` | Адаптер ручной площадки: собирает пакет материалов |
| `src/services/publications.js` | Состояния публикаций: планирование, отметка о выходе, сбор ссылок |
| `src/jobs/publish-horizontal.js` | Шаг конвейера: горизонтальная запись по выбранным площадкам |
| `src/jobs/publish-vertical.js` | Шаг конвейера: вертикальные нарезки со списком ссылок |
| `src/lib/description.js` | Сборка описания ролика: заголовок, ссылки, теги |
| `src/routes/settings.js` | API страницы настроек: подключить, отключить, проверить |
| `src/views/admin-settings.js` | Страница «Настройки»: площадки и их подключения |
| `src/views/admin-publish.js` | Раздел карточки урока: куда публикуем и что вышло |

---

## Задача 1: Публикация знает свой файл

Сейчас `publications` держит одну строку на площадку и урок. Вертикальных
роликов у урока три, и на TikTok уходят все три — при нынешнем ограничении
вторая строка просто не вставится.

**Файлы:**
- Создать: `migrations/014_publications_assets.sql`, `test/migrations-publications.test.js`

**Интерфейсы:**
- Отдаёт дальше: колонки `publications.asset_id`, `publications.kind`,
  `publications.manual_url`; ограничение уникальности по
  `(lesson_id, platform, asset_id)`.

- [ ] **Шаг 1: Написать падающий тест**

`test/migrations-publications.test.js`:

```js
// Публикация привязана к файлу, а не только к уроку: вертикальных роликов у
// урока три, и на площадку коротких видео уходят все три. Прежнее ограничение
// «одна строка на площадку и урок» вторую вставить не давало.
import test from 'node:test';
import assert from 'node:assert/strict';
import { saveLesson } from '../src/services/lessons.js';
import { registerAsset } from '../src/services/media.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = { media: { dir: '/tmp', ttlHours: 168 } };

test('на одну площадку помещается несколько роликов одного урока', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    const first = await registerAsset(pool, config, {
      lessonId: lesson.id, kind: 'clip', relativePath: 'lesson-1/clip-1.mp4', bytes: 10
    });
    const second = await registerAsset(pool, config, {
      lessonId: lesson.id, kind: 'clip', relativePath: 'lesson-1/clip-2.mp4', bytes: 10
    });

    for (const asset of [first, second]) {
      await pool.query(
        `INSERT INTO publications (lesson_id, platform, kind, asset_id, mode)
         VALUES ($1, 'tiktok', 'vertical', $2, 'semi')`,
        [lesson.id, asset.id]
      );
    }
    const { rows } = await pool.query(
      `SELECT count(*)::int n FROM publications WHERE lesson_id = $1`,
      [lesson.id]
    );
    assert.equal(rows[0].n, 2);
  });
});

test('один и тот же ролик дважды на площадку не встанет', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    const asset = await registerAsset(pool, config, {
      lessonId: lesson.id, kind: 'clip', relativePath: 'lesson-1/clip-1.mp4', bytes: 10
    });
    const insert = () =>
      pool.query(
        `INSERT INTO publications (lesson_id, platform, kind, asset_id, mode)
         VALUES ($1, 'tiktok', 'vertical', $2, 'semi')`,
        [lesson.id, asset.id]
      );
    await insert();
    // Повторная постановка того же ролика — это двойная выкладка у зрителя.
    await assert.rejects(insert(), /duplicate key/);
  });
});

test('горизонтальная публикация живёт без файла в строке', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    // Горизонтальная запись у урока одна, и какая именно — решает шаг
    // публикации: смонтированная, а если монтаж выключен, исходник.
    await pool.query(
      `INSERT INTO publications (lesson_id, platform, kind, mode)
       VALUES ($1, 'youtube', 'horizontal', 'auto')`,
      [lesson.id]
    );
    const { rows } = await pool.query(
      `SELECT asset_id, state FROM publications WHERE lesson_id = $1`,
      [lesson.id]
    );
    assert.equal(rows[0].asset_id, null);
    assert.equal(rows[0].state, 'planned');
  });
});

test('ссылка от автора хранится отдельно от ссылки от площадки', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    // Dzen выкладывается руками: ссылку приносит автор, а не площадка. Держать
    // её в том же поле, что и ответ API, значит потерять различие между
    // «портал выложил» и «автор сказал, что выложил».
    await pool.query(
      `INSERT INTO publications (lesson_id, platform, kind, mode, manual_url, state)
       VALUES ($1, 'dzen', 'horizontal', 'manual', 'https://dzen.ru/video/watch/x', 'published')`,
      [lesson.id]
    );
    const { rows } = await pool.query('SELECT manual_url, url FROM publications');
    assert.equal(rows[0].url, null);
    assert.match(rows[0].manual_url, /dzen\.ru/);
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить:
```bash
docker run --rm --network shared-data --env-file .env -v "$PWD":/app -w /app \
  my_portal-worker node --test test/migrations-publications.test.js
```
Ожидается: FAIL — `column "kind" of relation "publications" does not exist`.

- [ ] **Шаг 3: Написать миграцию**

`migrations/014_publications_assets.sql`:

```sql
-- Публикация знает, какой именно файл выложен.
--
-- До этого строка была одна на площадку и урок. Вертикальных роликов у урока
-- три, и на площадку коротких видео уходят все три — вторая строка просто не
-- вставлялась. Горизонтальная запись при этом одна, и в строке она остаётся
-- пустой: какой файл выкладывать — смонтированный или исходник, если монтаж
-- выключен, — решает шаг публикации в момент отправки.
-- Читается из src/services/publications.js.
ALTER TABLE publications
  ADD COLUMN kind text NOT NULL DEFAULT 'horizontal'
    CHECK (kind IN ('horizontal', 'vertical')),
  ADD COLUMN asset_id bigint REFERENCES assets(id) ON DELETE SET NULL,
  -- Ссылка, которую принёс автор после ручной выкладки. Отдельно от url:
  -- иначе теряется различие между «портал выложил» и «автор сказал, что
  -- выложил», а на нём держится доверие к автопубликации.
  ADD COLUMN manual_url text;

-- Прежнее ограничение допускало одну строку на площадку и урок.
ALTER TABLE publications DROP CONSTRAINT IF EXISTS publications_lesson_id_platform_key;

-- NULLS NOT DISTINCT: без него две горизонтальные строки с пустым файлом
-- считались бы разными, и один и тот же урок ушёл бы на YouTube дважды.
ALTER TABLE publications
  ADD CONSTRAINT publications_target_key
  UNIQUE NULLS NOT DISTINCT (lesson_id, platform, asset_id);
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Выполнить ту же команду. Ожидается: 4 теста PASS.

- [ ] **Шаг 5: Коммит**

```bash
git add migrations/014_publications_assets.sql test/migrations-publications.test.js
git commit -m "feat: публикация привязана к файлу, а не только к уроку"
```

---

## Задача 2: Хранение подключений переезжает из disk.js

`saveIntegration` и `loadIntegration` живут в `src/services/disk.js` — файле про
Яндекс Диск. С этапа 7 через них подключаются восемь площадок, и оставлять их
там значит, что подключение YouTube импортируется из модуля про Диск.

**Файлы:**
- Создать: `src/services/integrations.js`, `test/integrations-store.test.js`
- Изменить: `src/services/disk.js`, `src/routes/integrations.js`

**Интерфейсы:**
- Потребляет: `encryptSecret`, `decryptSecret` из `src/lib/secrets.js`.
- Отдаёт дальше: `saveIntegration(pool, config, { name, token, refreshToken, expiresAt })`,
  `loadIntegration(pool, config, name)` → `{ token, refreshToken, expiresAt } | null`,
  `forgetIntegration(pool, name)`, `listIntegrations(pool)` →
  `[{ name, connectedAt, expiresAt }]` — **без токенов**.

- [ ] **Шаг 1: Написать падающий тест**

`test/integrations-store.test.js`:

```js
// Хранение чужих токенов. Главное правило спеки: дамп базы не должен быть
// утечкой, поэтому токен лежит зашифрованным, а список подключений его вообще
// не отдаёт — страница настроек показывает факт подключения, а не ключи.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  saveIntegration,
  loadIntegration,
  forgetIntegration,
  listIntegrations
} from '../src/services/integrations.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = { tokenEncryptionKey: 'a'.repeat(64) };

test('токен возвращается тому, кто знает ключ', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveIntegration(pool, config, { name: 'youtube', token: 'секрет-1' });
    const loaded = await loadIntegration(pool, config, 'youtube');
    assert.equal(loaded.token, 'секрет-1');
  });
});

test('в базе токен лежит не открытым текстом', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveIntegration(pool, config, { name: 'youtube', token: 'секрет-1' });
    const { rows } = await pool.query('SELECT token FROM integrations');
    assert.ok(!rows[0].token.includes('секрет-1'), 'дамп базы стал бы утечкой');
  });
});

test('чужой ключ токен не открывает', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveIntegration(pool, config, { name: 'youtube', token: 'секрет-1' });
    await assert.rejects(loadIntegration(pool, { tokenEncryptionKey: 'b'.repeat(64) }, 'youtube'));
  });
});

test('список подключений токенов не отдаёт', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveIntegration(pool, config, { name: 'youtube', token: 'секрет-1' });
    const list = await listIntegrations(pool);
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'youtube');
    // Страница настроек показывает факт подключения. Токен ей не нужен, а
    // попав в разметку, он утёк бы в историю браузера и в кеш.
    assert.ok(!('token' in list[0]));
    assert.ok(!JSON.stringify(list).includes('секрет-1'));
  });
});

test('отключение убирает подключение целиком', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveIntegration(pool, config, { name: 'youtube', token: 'секрет-1' });
    await forgetIntegration(pool, 'youtube');
    assert.equal(await loadIntegration(pool, config, 'youtube'), null);
    assert.deepEqual(await listIntegrations(pool), []);
  });
});

test('повторное подключение заменяет токен, а не плодит строки', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveIntegration(pool, config, { name: 'youtube', token: 'старый' });
    await saveIntegration(pool, config, { name: 'youtube', token: 'новый' });
    const loaded = await loadIntegration(pool, config, 'youtube');
    assert.equal(loaded.token, 'новый');
    assert.equal((await listIntegrations(pool)).length, 1);
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Ожидается: FAIL — `Cannot find module '../src/services/integrations.js'`.

- [ ] **Шаг 3: Написать `src/services/integrations.js`**

```js
// Подключения портала к чужим сервисам.
//
// Задача — хранить чужие токены так, чтобы дамп базы не был утечкой. Токен
// Яндекс Диска даёт доступ ко всему диску заказчика, токен YouTube — право
// публиковать от его имени; ключ шифрования живёт в окружении, поэтому дамп без
// него бесполезен.
//
// Зачем отдельным файлом от services/disk.js, где эти функции жили раньше: с
// этапа 7 через них подключаются восемь площадок, и подключение YouTube не
// должно импортироваться из модуля про Диск.
// Вызывается из src/routes/settings.js, src/services/disk.js и адаптеров площадок.
import { encryptSecret, decryptSecret } from '../lib/secrets.js';

/** Сохраняет подключение. Повторное сохранение заменяет токен. */
export async function saveIntegration(pool, config, { name, token, refreshToken, expiresAt }) {
  await pool.query(
    `INSERT INTO integrations (name, token, refresh_token, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (name) DO UPDATE SET token = EXCLUDED.token,
                                      refresh_token = EXCLUDED.refresh_token,
                                      expires_at = EXCLUDED.expires_at,
                                      updated_at = now()`,
    [
      name,
      encryptSecret(token, config.tokenEncryptionKey),
      refreshToken ? encryptSecret(refreshToken, config.tokenEncryptionKey) : null,
      expiresAt ?? null
    ]
  );
}

/** Достаёт токен подключения. null, если сервис не подключён. */
export async function loadIntegration(pool, config, name) {
  const { rows } = await pool.query(
    'SELECT token, refresh_token, expires_at FROM integrations WHERE name = $1',
    [name]
  );
  if (!rows.length) return null;
  return {
    token: decryptSecret(rows[0].token, config.tokenEncryptionKey),
    refreshToken: rows[0].refresh_token
      ? decryptSecret(rows[0].refresh_token, config.tokenEncryptionKey)
      : null,
    expiresAt: rows[0].expires_at
  };
}

/** Убирает подключение. Токен после этого не восстановить — только подключиться заново. */
export async function forgetIntegration(pool, name) {
  await pool.query('DELETE FROM integrations WHERE name = $1', [name]);
}

/**
 * Что подключено — для страницы настроек.
 * Токенов не отдаёт намеренно: странице нужен факт подключения, а попав в
 * разметку, токен утёк бы в историю браузера и в кеш.
 */
export async function listIntegrations(pool) {
  const { rows } = await pool.query(
    'SELECT name, created_at, expires_at FROM integrations ORDER BY name'
  );
  return rows.map((row) => ({
    name: row.name,
    connectedAt: row.created_at,
    expiresAt: row.expires_at
  }));
}
```

- [ ] **Шаг 4: Переключить старых потребителей**

В `src/services/disk.js` удалить обе функции и добавить сверху:

```js
import { saveIntegration, loadIntegration } from './integrations.js';
```

Экспорт из `disk.js` сохранить реэкспортом, чтобы не править вызовы разом:

```js
// Реэкспорт ради обратной совместимости вызовов: сами функции живут в
// services/integrations.js, потому что через них подключаются не только Диск.
export { saveIntegration, loadIntegration };
```

- [ ] **Шаг 5: Убедиться, что проходит весь набор**

Выполнить обе команды из «Общих ограничений». Ожидается: все PASS, линтер чист.
Тесты `test/disk.test.js` и `test/integrations.test.js` должны пройти без правок —
это и есть проверка, что перенос ничего не сломал.

- [ ] **Шаг 6: Коммит**

```bash
git add src/services/integrations.js src/services/disk.js test/integrations-store.test.js
git commit -m "refactor: хранение чужих токенов вынесено из модуля про Диск"
```

---

## Задача 3: Реестр площадок

Площадка — это не только имя. У неё есть режим зрелости, вид видео, который она
принимает, способ подключения и человеческое название для страницы настроек.
Держать это в восьми местах кода значит однажды показать в кабинете площадку,
которой нет в базе.

**Файлы:**
- Создать: `src/platforms/index.js`, `test/platforms.test.js`

**Интерфейсы:**
- Отдаёт дальше: `PLATFORMS` — массив
  `{ name, title, mode, kinds, connect, limits }`;
  `platformsFor(kind)` → площадки, принимающие такой вид видео;
  `platformByName(name)` → площадка или `undefined`;
  `PLATFORM_NAMES` — массив имён, совпадающий с ограничением в базе.

- [ ] **Шаг 1: Написать падающий тест**

`test/platforms.test.js`:

```js
// Реестр площадок. Он один на портал: имена в нём обязаны совпадать с
// ограничением в базе, иначе кабинет покажет площадку, публикация в которую не
// вставится, и человек узнает об этом по красной ошибке вместо вышедшего урока.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORMS, PLATFORM_NAMES, platformsFor, platformByName } from '../src/platforms/index.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

test('имена площадок совпадают с тем, что принимает база', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'publications_platform_check'`
    );
    for (const name of PLATFORM_NAMES) {
      assert.match(rows[0].def, new RegExp(`'${name}'`), `база не знает площадку ${name}`);
    }
  });
});

test('горизонтальное видео идёт на одни площадки, вертикальное на другие', () => {
  const horizontal = platformsFor('horizontal').map((p) => p.name);
  const vertical = platformsFor('vertical').map((p) => p.name);
  // Решение заказчика: длинный урок на площадки длинных видео, нарезки — на
  // площадки коротких.
  assert.deepEqual(horizontal.sort(), ['dzen', 'rutube', 'vk', 'youtube']);
  assert.deepEqual(vertical.sort(), ['instagram', 'max', 'telegram', 'tiktok']);
});

test('у каждой площадки есть режим и человеческое название', () => {
  for (const platform of PLATFORMS) {
    assert.ok(['auto', 'semi', 'manual'].includes(platform.mode), platform.name);
    // Название читает человек на странице настроек: «vk» ему ничего не говорит.
    assert.ok(platform.title.length > 1, platform.name);
    assert.ok(platform.kinds.length > 0, platform.name);
  }
});

test('площадка без API загрузки помечена ручной', () => {
  // Публичного API загрузки у Dzen нет — это не наша недоделка, и притворяться,
  // что он появится, значит обещать автору то, чего не будет.
  assert.equal(platformByName('dzen').mode, 'manual');
  assert.equal(platformByName('max').mode, 'manual');
});

test('незнакомая площадка не находится', () => {
  assert.equal(platformByName('vimeo'), undefined);
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Ожидается: FAIL — модуль не найден.

- [ ] **Шаг 3: Написать `src/platforms/index.js`**

```js
// Реестр площадок портала.
//
// Задача — держать в одном месте всё, что портал знает о площадке: как её
// зовут человеку, что она принимает, умеет ли портал публиковать в неё сам и
// как к ней подключаются. Зачем одним местом: имена отсюда обязаны совпадать с
// ограничением в базе, а разъехавшись, они дадут площадку в кабинете, публикация
// в которую не вставится.
//
// Режим зрелости — из спеки, раздел 9. Он не пожелание, а положение дел:
// у Dzen нет публичного API загрузки, TikTok и Instagram публикуют только
// после ревью приложения.
// Вызывается из src/routes/settings.js, src/views/admin-settings.js и шагов
// публикации.

export const PLATFORMS = [
  {
    name: 'youtube',
    title: 'YouTube',
    mode: 'auto',
    kinds: ['horizontal'],
    connect: 'oauth',
    limits: 'Около шести загрузок в сутки по умолчанию; расширение по заявке.'
  },
  {
    name: 'vk',
    title: 'VK Видео',
    mode: 'auto',
    kinds: ['horizontal'],
    connect: 'oauth',
    limits: ''
  },
  {
    name: 'rutube',
    title: 'RuTube',
    mode: 'auto',
    kinds: ['horizontal'],
    connect: 'token',
    limits: 'Загрузка по ключу, который выдаёт площадка по заявке.'
  },
  {
    name: 'dzen',
    title: 'Дзен',
    mode: 'manual',
    kinds: ['horizontal'],
    connect: 'none',
    limits: 'Публичного API загрузки нет: портал собирает пакет, выкладывает автор.'
  },
  {
    name: 'telegram',
    title: 'Telegram-канал',
    mode: 'auto',
    kinds: ['vertical'],
    connect: 'bot',
    limits: 'Бот отдаёт файлы до 50 МБ — вертикальные нарезки в это укладываются.'
  },
  {
    name: 'tiktok',
    title: 'TikTok',
    mode: 'semi',
    kinds: ['vertical'],
    connect: 'oauth',
    limits: 'До ревью приложения ролик уходит в черновики, а не в ленту.'
  },
  {
    name: 'instagram',
    title: 'Instagram Reels',
    mode: 'semi',
    kinds: ['vertical'],
    connect: 'oauth',
    limits: 'Только Business- или Creator-аккаунт: с личного публиковать нельзя.'
  },
  {
    name: 'max',
    title: 'MAX-канал',
    mode: 'manual',
    kinds: ['vertical'],
    connect: 'bot',
    limits: 'Публикация видео в ленту требует отдельной проверки у площадки.'
  }
];

export const PLATFORM_NAMES = PLATFORMS.map((platform) => platform.name);

/** Площадки, принимающие такой вид видео: 'horizontal' или 'vertical'. */
export function platformsFor(kind) {
  return PLATFORMS.filter((platform) => platform.kinds.includes(kind));
}

/** Площадка по имени. undefined — имя пришло не из реестра. */
export function platformByName(name) {
  return PLATFORMS.find((platform) => platform.name === name);
}
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Ожидается: 5 тестов PASS.

- [ ] **Шаг 5: Коммит**

```bash
git add src/platforms/index.js test/platforms.test.js
git commit -m "feat: реестр площадок с режимами зрелости"
```

---

## Задача 4: Страница «Настройки»

**Файлы:**
- Создать: `src/views/admin-settings.js`, `src/routes/settings.js`, `test/admin-settings.test.js`
- Изменить: `src/routes/pages.js`, `src/app.js`, `src/views/layout.js`, `public/admin.js`

**Интерфейсы:**
- Потребляет: `PLATFORMS`, `listIntegrations`, `forgetIntegration`.
- Отдаёт дальше: страница `GET /admin/settings`;
  `DELETE /api/settings/integrations/:name` — отключить;
  `POST /api/settings/integrations/:name/token` — подключение ключом
  (для площадок с `connect: 'token'`).

- [ ] **Шаг 1: Написать падающий тест**

`test/admin-settings.test.js`:

```js
// Страница настроек: где автор подключает площадки. Главное, что здесь
// проверяется, — что она показывает факт подключения и никогда токен, и что
// посторонний её не открывает.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveIntegration } from '../src/services/integrations.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://soloaijourney.online',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', botId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: '' },
  tokenEncryptionKey: 'a'.repeat(64),
  media: { dir: '/tmp', ttlHours: 168 }
};

async function adminHeaders(pool) {
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  return {
    Accept: 'text/html',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'admin' }, config.jwtSecret)}`
  };
}

test('на странице перечислены все площадки с их режимами', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const headers = await adminHeaders(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (await fetch(`${base}/admin/settings`, { headers })).text();
      assert.match(html, /YouTube/);
      assert.match(html, /Дзен/);
      // Режим написан словами: «manual» человеку ничего не говорит, а знать,
      // что Дзен придётся выкладывать руками, он должен заранее.
      assert.match(html, /выкладывается вручную/i);
    });
  });
});

test('подключённая площадка видна, токен — нет', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveIntegration(pool, config, { name: 'youtube', token: 'секрет-1' });
    const headers = await adminHeaders(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (await fetch(`${base}/admin/settings`, { headers })).text();
      assert.match(html, /подключён/i);
      assert.ok(!html.includes('секрет-1'), 'токен попал в разметку');
    });
  });
});

test('отключение убирает подключение', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveIntegration(pool, config, { name: 'youtube', token: 'секрет-1' });
    const headers = await adminHeaders(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/settings/integrations/youtube`, {
        method: 'DELETE',
        headers
      });
      assert.equal(res.status, 200);
    });
    const { rows } = await pool.query('SELECT count(*)::int n FROM integrations');
    assert.equal(rows[0].n, 0);
  });
});

test('незнакомую площадку отключить нельзя', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const headers = await adminHeaders(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      // Имя приходит из адреса, то есть от человека: без сверки с реестром
      // сюда пришло бы что угодно.
      const res = await fetch(`${base}/api/settings/integrations/vimeo`, {
        method: 'DELETE',
        headers
      });
      assert.equal(res.status, 404);
    });
  });
});

test('посторонний в настройки не попадает', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(
      `INSERT INTO users (display_name, role) VALUES ('Зритель', 'user') RETURNING id`
    );
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/admin/settings`, {
        headers: {
          Accept: 'text/html',
          Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'user' }, config.jwtSecret)}`
        }
      });
      assert.equal(res.status, 403);
    });
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Ожидается: FAIL — 404 на `/admin/settings`.

- [ ] **Шаг 3: Написать `src/views/admin-settings.js`**

```js
// Страница настроек портала: подключения к площадкам.
//
// Задача — дать автору одно место, где видно, куда портал может публиковать, а
// куда пока нет. Зачем отдельной страницей, а не в карточке урока: подключение
// живёт дольше урока, и делать его заново при каждой выкладке незачем.
// Вызывается из src/routes/pages.js по адресу /admin/settings.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';
import { PLATFORMS } from '../platforms/index.js';

// Что означает режим — словами для человека. «manual» на экране не объясняет
// ничего, а знать, что площадку придётся выкладывать руками, автор должен до
// того, как выберет её для урока.
const MODE_LABELS = {
  auto: 'портал публикует сам',
  semi: 'портал готовит черновик, публикуете вы',
  manual: 'выкладывается вручную, портал собирает пакет'
};

const KIND_LABELS = { horizontal: 'полный урок', vertical: 'вертикальные ролики' };

function platformCard(platform, connection) {
  const connected = Boolean(connection);
  return `<li class="platform-card">
  <div class="grow">
    <h3>${escapeHtml(platform.title)}</h3>
    <p class="meta">
      ${escapeHtml(platform.kinds.map((kind) => KIND_LABELS[kind]).join(', '))}
      · ${escapeHtml(MODE_LABELS[platform.mode])}
    </p>
    ${platform.limits ? `<p class="hint">${escapeHtml(platform.limits)}</p>` : ''}
  </div>
  <div class="actions">
    ${
      platform.connect === 'none'
        ? '<span class="badge">подключение не нужно</span>'
        : connected
          ? `<span class="badge">подключён</span>
             <button class="button" type="button"
               data-disconnect="${escapeHtml(platform.name)}">Отключить</button>`
          : `<a class="button-brand" href="/api/settings/connect/${escapeHtml(platform.name)}">
               Подключить
             </a>`
    }
  </div>
</li>`;
}

export function adminSettingsPage({ config, user, connections }) {
  const byName = new Map(connections.map((item) => [item.name, item]));

  return layout({
    config,
    user,
    path: '/admin/settings',
    title: 'Настройки — Solo AI Journey',
    description: 'Подключения портала к площадкам.',
    body: `
<nav class="admin-nav">
  <a class="button" href="/admin">← Кабинет</a>
</nav>

<h1>Настройки</h1>
<p class="hint">
  Площадки, на которые портал выкладывает уроки. Полный урок идёт на площадки
  длинных видео, вертикальные нарезки — на площадки коротких.
</p>

<h2>Полный урок</h2>
<ul class="platform-list">
  ${PLATFORMS.filter((platform) => platform.kinds.includes('horizontal'))
    .map((platform) => platformCard(platform, byName.get(platform.name)))
    .join('')}
</ul>

<h2>Вертикальные ролики</h2>
<ul class="platform-list">
  ${PLATFORMS.filter((platform) => platform.kinds.includes('vertical'))
    .map((platform) => platformCard(platform, byName.get(platform.name)))
    .join('')}
</ul>`
  });
}
```

- [ ] **Шаг 4: Написать `src/routes/settings.js`**

```js
// API страницы настроек: подключить и отключить площадку.
//
// Задача — тонкий слой над хранением подключений. Зачем отдельно от
// routes/integrations.js: там подключение Яндекс Диска, откуда портал БЕРЁТ
// исходники, а здесь площадки, куда он ОТДАЁТ готовое. Разные вещи с разными
// последствиями утечки.
// Подключается в src/app.js по префиксу /api/settings.
import { Router } from 'express';
import { requireAdmin } from '../middleware/guards.js';
import { PublicError } from '../middleware/errors.js';
import { platformByName } from '../platforms/index.js';
import { forgetIntegration, saveIntegration } from '../services/integrations.js';

export function settingsRoutes(config, pool) {
  const router = Router();
  router.use(requireAdmin);

  router.delete('/integrations/:name', async (req, res) => {
    // Имя приходит из адреса, то есть от человека: без сверки с реестром сюда
    // пришло бы что угодно.
    if (!platformByName(req.params.name)) throw new PublicError('Такой площадки нет', 404);
    await forgetIntegration(pool, req.params.name);
    res.json({ disconnected: req.params.name });
  });

  // Подключение ключом — для площадок, где нет OAuth и ключ выдаёт поддержка.
  router.post('/integrations/:name/token', async (req, res) => {
    const platform = platformByName(req.params.name);
    if (!platform) throw new PublicError('Такой площадки нет', 404);
    if (platform.connect !== 'token') {
      throw new PublicError('Эта площадка подключается иначе', 400);
    }
    const token = String(req.body?.token ?? '').trim();
    if (!token) throw new PublicError('Ключ не введён', 400);

    await saveIntegration(pool, config, { name: platform.name, token });
    res.json({ connected: platform.name });
  });

  return router;
}
```

- [ ] **Шаг 5: Подключить страницу и маршруты**

В `src/routes/pages.js` рядом с другими маршрутами кабинета:

```js
router.get('/admin/settings', requireAdmin, async (req, res) => {
  const user = await currentUser(pool, req);
  res.type('html').send(
    adminSettingsPage({ config, user, connections: await listIntegrations(pool) })
  );
});
```

В `src/app.js` — до общего `/api`:

```js
app.use('/api/settings', settingsRoutes(config, pool));
```

В `src/views/layout.js` в навигацию админа, рядом с «Кабинет»:

```js
${user?.role === 'admin' ? '<a href="/admin/settings">Настройки</a>' : ''}
```

В `public/admin.js`:

```js
/* --- Отключение площадки ------------------------------------------------- */

// Отключение спрашивает подтверждения: подключение восстанавливается только
// проходом OAuth заново, а на некоторых площадках это ещё и ожидание ревью.
document.querySelectorAll('[data-disconnect]').forEach((button) => {
  button.addEventListener('click', async () => {
    if (!confirm('Отключить площадку? Подключаться придётся заново.')) return;
    button.disabled = true;
    const answer = await request(`/api/settings/integrations/${button.dataset.disconnect}`, {
      method: 'DELETE'
    });
    if (answer) location.reload();
    else button.disabled = false;
  });
});
```

- [ ] **Шаг 6: Убедиться, что тесты проходят**

Выполнить обе команды из «Общих ограничений». Ожидается: все PASS, линтер чист.
Тест `test/client-contract.test.js` проверит, что у `data-disconnect` есть
обработчик в клиенте.

- [ ] **Шаг 7: Коммит**

```bash
git add src/views/admin-settings.js src/routes/settings.js src/routes/pages.js \
        src/app.js src/views/layout.js public/admin.js test/admin-settings.test.js
git commit -m "feat: страница настроек с подключениями площадок"
```

---

## Задача 5: Состояния публикаций

**Файлы:**
- Создать: `src/services/publications.js`, `test/publications-service.test.js`

**Интерфейсы:**
- Потребляет: реестр площадок, таблицу `publications`.
- Отдаёт дальше:
  `planPublications(pool, lessonId, { horizontal, vertical })` — создаёт строки
  по выбору автора; `listPublications(pool, lessonId)` →
  `[{ id, platform, kind, state, url, manualUrl, error, mode }]`;
  `markPublished(pool, id, { externalId, url })`;
  `markFailed(pool, id, message)`;
  `setManualUrl(pool, id, url)`;
  `publishedLinks(pool, lessonId)` → `[{ title, url }]` — только вышедшие
  горизонтальные, для описания вертикальных.

- [ ] **Шаг 1: Написать падающий тест**

`test/publications-service.test.js`:

```js
// Состояния публикаций. Спека: по строке на площадку, каждая живёт своей
// жизнью и падает независимо — упавший YouTube не должен отменять вышедший VK.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planPublications,
  listPublications,
  markPublished,
  markFailed,
  setManualUrl,
  publishedLinks
} from '../src/services/publications.js';
import { saveLesson } from '../src/services/lessons.js';
import { registerAsset } from '../src/services/media.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = { media: { dir: '/tmp', ttlHours: 168 } };

async function seed(pool) {
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
  const clips = [];
  for (const name of ['clip-1.mp4', 'clip-2.mp4']) {
    clips.push(
      await registerAsset(pool, config, {
        lessonId: lesson.id, kind: 'clip', relativePath: `lesson-1/${name}`, bytes: 10
      })
    );
  }
  return { lessonId: lesson.id, clips };
}

test('план создаёт по строке на площадку и на ролик', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, clips } = await seed(pool);
    await planPublications(pool, lessonId, {
      horizontal: ['youtube', 'dzen'],
      vertical: ['telegram']
    });
    const rows = await listPublications(pool, lessonId);
    // Две горизонтальные — по одной на площадку. Вертикальных две: по одной на
    // каждый ролик, потому что на площадку уходят все нарезки.
    assert.equal(rows.filter((r) => r.kind === 'horizontal').length, 2);
    assert.equal(rows.filter((r) => r.kind === 'vertical').length, clips.length);
    assert.ok(rows.every((r) => r.state === 'planned'));
  });
});

test('режим берётся из реестра, а не из запроса', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId } = await seed(pool);
    await planPublications(pool, lessonId, { horizontal: ['dzen'], vertical: [] });
    const [row] = await listPublications(pool, lessonId);
    // Иначе клиент мог бы попросить auto у площадки, где его нет, и урок
    // застрял бы в ожидании публикации, которой не случится.
    assert.equal(row.mode, 'manual');
  });
});

test('повторное планирование не плодит строк', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId } = await seed(pool);
    await planPublications(pool, lessonId, { horizontal: ['youtube'], vertical: [] });
    await planPublications(pool, lessonId, { horizontal: ['youtube'], vertical: [] });
    assert.equal((await listPublications(pool, lessonId)).length, 1);
  });
});

test('незнакомая площадка в план не попадает', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId } = await seed(pool);
    await planPublications(pool, lessonId, { horizontal: ['vimeo'], vertical: [] });
    assert.deepEqual(await listPublications(pool, lessonId), []);
  });
});

test('упавшая публикация не отменяет вышедшую', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId } = await seed(pool);
    await planPublications(pool, lessonId, { horizontal: ['youtube', 'vk'], vertical: [] });
    const rows = await listPublications(pool, lessonId);
    await markPublished(pool, rows[0].id, { externalId: 'abc', url: 'https://x/1' });
    await markFailed(pool, rows[1].id, 'квота на сегодня кончилась');

    const after = await listPublications(pool, lessonId);
    assert.equal(after.find((r) => r.id === rows[0].id).state, 'published');
    assert.equal(after.find((r) => r.id === rows[1].id).state, 'failed');
    assert.match(after.find((r) => r.id === rows[1].id).error, /квота/);
  });
});

test('ссылка от автора отмечает ручную площадку вышедшей', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId } = await seed(pool);
    await planPublications(pool, lessonId, { horizontal: ['dzen'], vertical: [] });
    const [row] = await listPublications(pool, lessonId);
    await setManualUrl(pool, row.id, 'https://dzen.ru/video/watch/x');
    const [after] = await listPublications(pool, lessonId);
    assert.equal(after.state, 'published');
    assert.match(after.manualUrl, /dzen/);
  });
});

test('для описания вертикалок берутся только вышедшие горизонтальные', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId } = await seed(pool);
    await planPublications(pool, lessonId, {
      horizontal: ['youtube', 'vk', 'dzen'],
      vertical: ['telegram']
    });
    const rows = await listPublications(pool, lessonId);
    const youtube = rows.find((r) => r.platform === 'youtube');
    const dzen = rows.find((r) => r.platform === 'dzen');
    await markPublished(pool, youtube.id, { externalId: 'a', url: 'https://youtu.be/a' });
    await setManualUrl(pool, dzen.id, 'https://dzen.ru/video/watch/b');

    const links = await publishedLinks(pool, lessonId);
    // VK ещё не вышел — ссылки на него нет; вертикальный ролик в список не
    // попадает вовсе, иначе ролик ссылался бы сам на себя.
    assert.deepEqual(links.map((l) => l.title).sort(), ['Дзен', 'YouTube']);
    assert.ok(links.every((l) => l.url.startsWith('https://')));
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Ожидается: FAIL — модуль не найден.

- [ ] **Шаг 3: Написать `src/services/publications.js`**

```js
// Состояния публикаций урока.
//
// Задача — единственное место, которое знает SQL про то, куда урок выложен и
// чем это кончилось. Спека: по строке на площадку, каждая живёт своей жизнью и
// падает независимо — упавший YouTube не отменяет вышедший VK.
// Вызывается из шагов публикации, кабинета и API.
import { platformByName, platformsFor } from '../platforms/index.js';

/**
 * Заводит строки публикаций по выбору автора.
 * Горизонтальная — одна на площадку: запись у урока одна. Вертикальных на
 * площадку столько, сколько нарезок: на площадки коротких видео уходят все.
 * Повторный вызов ничего не плодит — выбор можно менять до отправки.
 */
export async function planPublications(pool, lessonId, { horizontal = [], vertical = [] }) {
  const { rows: clips } = await pool.query(
    `SELECT id FROM assets WHERE lesson_id = $1 AND kind = 'clip' ORDER BY path`,
    [lessonId]
  );

  for (const name of horizontal) {
    const platform = platformByName(name);
    // Имя пришло из формы: незнакомое молча пропускаем, а не роняем всю
    // отправку из-за одной опечатки.
    if (!platform || !platform.kinds.includes('horizontal')) continue;
    await pool.query(
      `INSERT INTO publications (lesson_id, platform, kind, mode)
       VALUES ($1, $2, 'horizontal', $3)
       ON CONFLICT (lesson_id, platform, asset_id) DO NOTHING`,
      [lessonId, platform.name, platform.mode]
    );
  }

  for (const name of vertical) {
    const platform = platformByName(name);
    if (!platform || !platform.kinds.includes('vertical')) continue;
    for (const clip of clips) {
      await pool.query(
        `INSERT INTO publications (lesson_id, platform, kind, asset_id, mode)
         VALUES ($1, $2, 'vertical', $3, $4)
         ON CONFLICT (lesson_id, platform, asset_id) DO NOTHING`,
        [lessonId, platform.name, clip.id, platform.mode]
      );
    }
  }
}

/** Приводит строку базы к виду, в котором её ждут кабинет и шаги публикации. */
function toPublication(row) {
  return {
    id: Number(row.id),
    platform: row.platform,
    kind: row.kind,
    state: row.state,
    mode: row.mode,
    assetId: row.asset_id ? Number(row.asset_id) : null,
    url: row.url,
    manualUrl: row.manual_url,
    error: row.error
  };
}

export async function listPublications(pool, lessonId) {
  const { rows } = await pool.query(
    `SELECT id, platform, kind, state, mode, asset_id, url, manual_url, error
       FROM publications WHERE lesson_id = $1 ORDER BY kind DESC, platform, id`,
    [lessonId]
  );
  return rows.map(toPublication);
}

export async function markPublished(pool, id, { externalId = null, url = null }) {
  await pool.query(
    `UPDATE publications SET state = 'published', external_id = $2, url = $3,
                             error = NULL, updated_at = now()
      WHERE id = $1`,
    [id, externalId, url]
  );
}

export async function markFailed(pool, id, message) {
  await pool.query(
    `UPDATE publications SET state = 'failed', error = $2, updated_at = now() WHERE id = $1`,
    // Обрезаем: сообщение показывается в кабинете, и мегабайт чужого ответа
    // там не нужен.
    [id, String(message).slice(0, 500)]
  );
}

/**
 * Ссылка, которую принёс автор после ручной выкладки.
 * Она же отмечает публикацию вышедшей: для ручной площадки другого признака нет.
 */
export async function setManualUrl(pool, id, url) {
  await pool.query(
    `UPDATE publications SET manual_url = $2, state = 'published', updated_at = now()
      WHERE id = $1`,
    [id, url]
  );
}

/**
 * Ссылки на вышедшие горизонтальные публикации — для описания вертикальных.
 * Вертикальные сюда не попадают: ролик ссылался бы сам на себя.
 */
export async function publishedLinks(pool, lessonId) {
  const { rows } = await pool.query(
    `SELECT platform, url, manual_url FROM publications
      WHERE lesson_id = $1 AND kind = 'horizontal' AND state = 'published'
      ORDER BY platform`,
    [lessonId]
  );
  return rows
    .map((row) => ({
      title: platformByName(row.platform)?.title ?? row.platform,
      url: row.url ?? row.manual_url
    }))
    .filter((link) => Boolean(link.url));
}

/** Площадки, которые вообще принимают такой вид видео — для формы выбора. */
export { platformsFor };
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Ожидается: 7 тестов PASS.

- [ ] **Шаг 5: Коммит**

```bash
git add src/services/publications.js test/publications-service.test.js
git commit -m "feat: состояния публикаций по площадкам"
```

---

## Задача 6: Описание ролика со списком ссылок

**Файлы:**
- Создать: `src/lib/description.js`, `test/description.test.js`

**Интерфейсы:**
- Потребляет: `publishedLinks`.
- Отдаёт дальше: `buildDescription({ title, description, links, tags, limit })` → строка.

- [ ] **Шаг 1: Написать падающий тест**

`test/description.test.js`:

```js
// Описание ролика для площадки. Решение заказчика: в описании вертикального
// ролика идут ВСЕ ссылки на выложенные горизонтальные — описание длиннее, зато
// у зрителя выбор, где смотреть урок целиком.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDescription } from '../src/lib/description.js';

const links = [
  { title: 'YouTube', url: 'https://youtu.be/a' },
  { title: 'VK Видео', url: 'https://vk.com/video-1_2' }
];

test('в описании есть заголовок, текст и все ссылки', () => {
  const text = buildDescription({
    title: 'Портал с нуля',
    description: 'Собираем каркас на VPS.',
    links,
    tags: ['docker', 'vps']
  });
  assert.match(text, /Портал с нуля/);
  assert.match(text, /Собираем каркас на VPS/);
  assert.match(text, /https:\/\/youtu\.be\/a/);
  assert.match(text, /https:\/\/vk\.com\/video-1_2/);
  // Площадку называем словами: голая ссылка не говорит зрителю, куда он идёт.
  assert.match(text, /YouTube/);
  assert.match(text, /#docker/);
});

test('без вышедших горизонталок описание всё равно годное', () => {
  // Ни одна площадка ещё не вышла — ролик не должен уйти с болтающимся
  // заголовком «Смотреть целиком:» и пустотой под ним.
  const text = buildDescription({ title: 'Урок', description: 'Текст', links: [], tags: [] });
  assert.match(text, /Урок/);
  assert.ok(!/Смотреть целиком/.test(text));
});

test('описание не длиннее предела площадки', () => {
  const text = buildDescription({
    title: 'Урок',
    description: 'а'.repeat(5000),
    links,
    tags: ['docker'],
    limit: 2200
  });
  assert.ok(text.length <= 2200, `вышло ${text.length} знаков`);
  // Ссылки обязаны уцелеть: ради них описание и собирается — обрезается текст.
  assert.match(text, /https:\/\/youtu\.be\/a/);
  assert.match(text, /https:\/\/vk\.com\/video-1_2/);
});

test('обрезка не рвёт слово посередине', () => {
  const text = buildDescription({
    title: 'Урок',
    description: 'слово '.repeat(500),
    links: [],
    tags: [],
    limit: 200
  });
  assert.ok(!text.includes('сло…'), 'обрезано посреди слова');
  assert.match(text, /…$|слово$/);
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Ожидается: FAIL — модуль не найден.

- [ ] **Шаг 3: Написать `src/lib/description.js`**

```js
// Описание ролика для площадки.
//
// Задача — собрать один текст из заголовка, описания урока, ссылок на
// выложенные записи и тегов. Решение заказчика: в описании вертикального ролика
// идут ВСЕ ссылки на выложенные горизонтальные — описание длиннее, зато у
// зрителя выбор, где смотреть урок целиком.
//
// Предел длины у площадок разный (у Instagram около 2200 знаков), и упирается
// в него сначала текст, а не ссылки: ссылки — то, ради чего описание и
// собирается.
// Вызывается из src/jobs/publish-vertical.js и адаптеров площадок.

// Куда обрезать, если предел не назван. Две тысячи знаков проходят везде.
const DEFAULT_LIMIT = 2000;

/** Обрезает по границе слова: разрыв посреди слова читается как опечатка. */
function cut(text, limit) {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit - 1);
  const space = head.lastIndexOf(' ');
  return `${space > limit / 2 ? head.slice(0, space) : head}…`;
}

export function buildDescription({
  title,
  description = '',
  links = [],
  tags = [],
  limit = DEFAULT_LIMIT
}) {
  const linksBlock = links.length
    ? `Смотреть целиком:\n${links.map((link) => `${link.title}: ${link.url}`).join('\n')}`
    : '';
  const tagsBlock = tags.length ? tags.map((tag) => `#${tag}`).join(' ') : '';

  // Собираем с конца: сначала то, что обязано уцелеть, потом остаток отдаём
  // тексту урока.
  const tail = [linksBlock, tagsBlock].filter(Boolean).join('\n\n');
  const head = String(title).trim();
  const room = limit - head.length - tail.length - 4;
  const body = room > 0 ? cut(String(description).trim(), room) : '';

  return [head, body, tail].filter(Boolean).join('\n\n');
}
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Ожидается: 4 теста PASS.

- [ ] **Шаг 5: Коммит**

```bash
git add src/lib/description.js test/description.test.js
git commit -m "feat: описание ролика со списком ссылок на полный урок"
```

---

## Задача 7: Ручная площадка отдаёт пакет материалов

Dzen и MAX публикуются руками. Портал обязан отдать автору всё, что нужно для
выкладки, одной ссылкой — иначе «ручной режим» означает «ищи файлы сам».

**Файлы:**
- Создать: `src/platforms/manual.js`, `test/manual-platform.test.js`
- Изменить: `src/routes/admin.js`

**Интерфейсы:**
- Потребляет: `mediaLink`, `listPublications`, `buildDescription`.
- Отдаёт дальше: `manualPackage(config, pool, { lessonId, platform })` →
  `{ platform, title, description, checklist: [строки], files: [{ name, url }] }`;
  маршрут `POST /api/admin/publications/:id/url` — автор приносит ссылку.

- [ ] **Шаг 1: Написать падающий тест**

`test/manual-platform.test.js`:

```js
// Ручная площадка. «Выкладывается вручную» не должно означать «ищи файлы сам»:
// портал обязан отдать автору видео, обложку, субтитры, готовый текст и
// чек-лист — иначе ручной режим бесполезен.
import test from 'node:test';
import assert from 'node:assert/strict';
import { manualPackage } from '../src/platforms/manual.js';
import { saveLesson } from '../src/services/lessons.js';
import { registerAsset } from '../src/services/media.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://soloaijourney.online',
  jwtSecret: 'x'.repeat(32),
  media: { dir: '/tmp', ttlHours: 168 }
};

async function seed(pool) {
  const lesson = await saveLesson(pool, {
    slug: 'urok',
    title: 'Портал с нуля',
    description: 'Собираем каркас.'
  });
  for (const [kind, name] of [
    ['trimmed', 'trimmed.mp4'],
    ['cover', 'cover.jpg'],
    ['subtitles', 'trimmed.srt']
  ]) {
    await registerAsset(pool, config, {
      lessonId: lesson.id, kind, relativePath: `lesson-1/${name}`, bytes: 10
    });
  }
  return lesson;
}

test('пакет содержит видео, обложку и субтитры', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await seed(pool);
    const pack = await manualPackage(config, pool, { lessonId: lesson.id, platform: 'dzen' });
    const names = pack.files.map((file) => file.name);
    assert.ok(names.some((name) => name.endsWith('.mp4')), 'без видео выкладывать нечего');
    assert.ok(names.some((name) => name.endsWith('.jpg')));
    assert.ok(names.some((name) => name.endsWith('.srt')));
    // Файлы буфера наружу по прямому адресу не смотрят даже автору.
    assert.ok(pack.files.every((file) => file.url.includes('/media/')));
  });
});

test('в пакете лежит готовый текст, а не заготовка', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await seed(pool);
    const pack = await manualPackage(config, pool, { lessonId: lesson.id, platform: 'dzen' });
    assert.match(pack.description, /Собираем каркас/);
    assert.equal(pack.title, 'Портал с нуля');
    // Чек-лист нужен, потому что через месяц автор не вспомнит, что у Дзена
    // обложка ставится отдельно от загрузки.
    assert.ok(pack.checklist.length >= 2);
  });
});

test('на вертикальную площадку идут нарезки, а не полный урок', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await seed(pool);
    await registerAsset(pool, config, {
      lessonId: lesson.id, kind: 'clip', relativePath: 'lesson-1/clip-1.mp4', bytes: 10
    });
    const pack = await manualPackage(config, pool, { lessonId: lesson.id, platform: 'max' });
    const names = pack.files.map((file) => file.name);
    assert.ok(names.includes('clip-1.mp4'));
    assert.ok(!names.includes('trimmed.mp4'), 'в канал коротких видео полный урок не идёт');
  });
});

test('незнакомая площадка пакета не получает', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await seed(pool);
    await assert.rejects(
      manualPackage(config, pool, { lessonId: lesson.id, platform: 'vimeo' }),
      /площадк/i
    );
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Ожидается: FAIL — модуль не найден.

- [ ] **Шаг 3: Написать `src/platforms/manual.js`**

```js
// Ручная площадка: пакет материалов для выкладки руками.
//
// Задача — отдать автору всё, что нужно для публикации, одной страницей.
// «Выкладывается вручную» не должно означать «ищи файлы сам»: у Дзена нет
// публичного API загрузки, и это не повод оставлять автора без материалов.
//
// Ссылки временные и подписанные: буфер по прямому адресу наружу не смотрит
// даже автору.
// Вызывается из src/routes/admin.js и кабинета.
import { mediaLink } from '../lib/media-token.js';
import { buildDescription } from '../lib/description.js';
import { platformByName } from './index.js';
import { publishedLinks } from '../services/publications.js';

// Ссылка живёт три часа: выкладка руками с обложкой и текстами в час не
// укладывается.
const LINK_SECONDS = 3 * 3600;

// Что человек забудет, если не написать. Список короткий намеренно: длинный
// не читают.
const CHECKLIST = {
  dzen: [
    'Загрузить видео и дождаться обработки — она идёт своим чередом',
    'Поставить обложку отдельно: при загрузке Дзен её не берёт',
    'Вставить заголовок и описание из этого пакета',
    'Вернуться сюда и вставить ссылку на вышедший ролик'
  ],
  max: [
    'Опубликовать ролик в канале',
    'Вставить описание из этого пакета',
    'Вернуться сюда и вставить ссылку на пост'
  ]
};

export async function manualPackage(config, pool, { lessonId, platform: name }) {
  const platform = platformByName(name);
  if (!platform) throw new Error(`Незнакомая площадка: ${name}`);

  const { rows: lessons } = await pool.query(
    'SELECT title, description FROM lessons WHERE id = $1',
    [lessonId]
  );
  if (!lessons.length) throw new Error('урок не найден');

  const wantsVertical = platform.kinds.includes('vertical');
  // Полный урок отдаём смонтированный: на площадки уходит он, а не исходник.
  const videoKinds = wantsVertical ? ['clip'] : ['trimmed', 'source'];

  const { rows: assets } = await pool.query(
    `SELECT id, kind, path FROM assets
      WHERE lesson_id = $1 AND kind = ANY($2::text[]) ORDER BY kind, path`,
    [lessonId, [...videoKinds, 'cover', 'subtitles']]
  );

  // Если монтаж выключен, смонтированной записи нет — тогда идёт исходник.
  const hasTrimmed = assets.some((row) => row.kind === 'trimmed');
  const files = assets
    .filter((row) => !(hasTrimmed && row.kind === 'source'))
    .map((row) => ({
      name: row.path.split('/').pop(),
      url: mediaLink(config, Number(row.id), LINK_SECONDS)
    }));

  const links = wantsVertical ? await publishedLinks(pool, lessonId) : [];

  return {
    platform: platform.name,
    title: lessons[0].title,
    description: buildDescription({
      title: lessons[0].title,
      description: lessons[0].description,
      links,
      tags: []
    }),
    checklist: CHECKLIST[platform.name] ?? ['Выложить и вернуться со ссылкой'],
    files
  };
}
```

- [ ] **Шаг 4: Добавить маршрут для ссылки от автора**

В `src/routes/admin.js`:

```js
// Автор вернулся со ссылкой после ручной выкладки. Это единственный признак,
// по которому портал узнаёт, что ручная площадка вышла.
router.post('/publications/:id/url', async (req, res) => {
  const url = String(req.body?.url ?? '').trim();
  // Проверяем схему: в поле попадает то, что человек скопировал, и «vk.com/…»
  // без схемы стало бы неработающей ссылкой в описании вертикалок.
  if (!/^https:\/\/\S+$/.test(url)) throw new PublicError('Нужна ссылка, начинающаяся с https://', 400);

  const { rows } = await pool.query(
    `SELECT id, mode FROM publications WHERE id = $1`,
    [Number(req.params.id)]
  );
  if (!rows[0]) throw new PublicError('Публикация не найдена', 404);
  if (rows[0].mode === 'auto') {
    throw new PublicError('Эта площадка публикуется сама — ссылку она принесёт сама', 400);
  }

  await setManualUrl(pool, Number(req.params.id), url);
  res.json({ url });
});
```

- [ ] **Шаг 5: Убедиться, что тесты проходят**

Ожидается: 4 теста PASS плюс весь набор.

- [ ] **Шаг 6: Коммит**

```bash
git add src/platforms/manual.js src/routes/admin.js test/manual-platform.test.js
git commit -m "feat: пакет материалов для площадок, которые выкладываются руками"
```

---

## Задача 8: Кабинет — выбор площадок и состояние публикаций

**Файлы:**
- Создать: `src/views/admin-publish.js`, `test/admin-publish.test.js`
- Изменить: `src/views/admin-review.js`, `src/routes/pages.js`, `src/routes/admin.js`,
  `public/admin.js`, `public/styles.css`

**Интерфейсы:**
- Потребляет: `platformsFor`, `listPublications`, `planPublications`.
- Отдаёт дальше: раздел карточки урока с галочками площадок и состояниями;
  `POST /api/admin/lessons/:slug/publish` — сохранить выбор и запустить публикацию.

- [ ] **Шаг 1: Написать падающий тест**

`test/admin-publish.test.js`:

```js
// Выбор площадок и состояние публикаций в кабинете. Спека: окончательно
// упавшее показывается красным, а не прячется в журнале контейнера.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveLesson } from '../src/services/lessons.js';
import { planPublications, markFailed, listPublications } from '../src/services/publications.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://soloaijourney.online',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', botId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: '' },
  tokenEncryptionKey: 'a'.repeat(64),
  media: { dir: '/tmp', ttlHours: 168 }
};

async function seed(pool) {
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  return {
    lesson,
    headers: {
      Accept: 'text/html',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'admin' }, config.jwtSecret)}`
    }
  };
}

test('на экране проверки есть выбор площадок', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { headers } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (await fetch(`${base}/admin/lesson/urok`, { headers })).text();
      assert.match(html, /name="horizontal" value="youtube"/);
      assert.match(html, /name="vertical" value="telegram"/);
      // Полный урок на площадку коротких видео не предлагается вовсе.
      assert.ok(!/name="horizontal" value="tiktok"/.test(html));
    });
  });
});

test('упавшая публикация видна с причиной', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool);
    await planPublications(pool, lesson.id, { horizontal: ['youtube'], vertical: [] });
    const [row] = await listPublications(pool, lesson.id);
    await markFailed(pool, row.id, 'квота на сегодня кончилась');

    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (await fetch(`${base}/admin/lesson/urok`, { headers })).text();
      assert.match(html, /квота на сегодня кончилась/);
      assert.match(html, /data-retry-publication="/);
    });
  });
});

test('отправка сохраняет выбор и ставит задачу', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool);
    const added = [];
    const app = finalize(
      createApp({ config, pool, queue: { add: async (name, data) => added.push({ name, data }) } })
    );
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons/urok/publish`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ horizontal: ['youtube', 'dzen'], vertical: ['telegram'] })
      });
      assert.equal(res.status, 200);
    });
    assert.equal((await listPublications(pool, lesson.id)).length >= 2, true);
    // Публикация идёт очередью: загрузка видео на площадку живёт минутами, а
    // запрос столько не живёт.
    assert.equal(added[0].name, 'publishHorizontal');
  });
});

test('без выбранных площадок отправка не запускается', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { headers } = await seed(pool);
    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons/urok/publish`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ horizontal: [], vertical: [] })
      });
      assert.equal(res.status, 400);
    });
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Ожидается: FAIL — в разметке нет выбора площадок.

- [ ] **Шаг 3: Написать `src/views/admin-publish.js`**

```js
// Раздел карточки урока: куда публикуем и что из этого вышло.
//
// Задача — дать автору выбрать площадки и увидеть судьбу каждой отправки.
// Спека: окончательно упавшее показывается красным, а не прячется в журнале
// контейнера, до которого с телефона не добраться.
// Вызывается из src/views/admin-review.js.
import { escapeHtml } from '../lib/html.js';
import { platformsFor } from '../platforms/index.js';

const STATE_LABELS = {
  planned: 'запланировано',
  queued: 'в очереди',
  uploading: 'загружается',
  published: 'вышло',
  failed: 'упало'
};

function checkbox(platform, field, chosen) {
  return `<label class="checkbox-row">
  <input type="checkbox" name="${field}" value="${escapeHtml(platform.name)}"
    ${chosen.has(platform.name) ? 'checked' : ''}>
  ${escapeHtml(platform.title)}
  ${platform.mode === 'manual' ? '<span class="badge">вручную</span>' : ''}
  ${platform.mode === 'semi' ? '<span class="badge">черновик</span>' : ''}
</label>`;
}

function publicationRow(publication, slug) {
  const link = publication.url ?? publication.manualUrl;
  return `<li class="form-row">
  <span>
    ${escapeHtml(publication.platform)}
    <span class="meta">${escapeHtml(STATE_LABELS[publication.state] ?? publication.state)}</span>
    ${link ? `<a href="${escapeHtml(link)}" rel="noopener" target="_blank">открыть</a>` : ''}
  </span>
  <span>
    ${
      publication.mode !== 'auto' && !link
        ? `<button class="button" type="button"
             data-manual-url="${publication.id}">Я выложил, вот ссылка</button>`
        : ''
    }
    ${
      publication.state === 'failed'
        ? `<button class="button" type="button"
             data-retry-publication="${publication.id}">Повторить</button>`
        : ''
    }
  </span>
  ${publication.error ? `<p class="hint danger">${escapeHtml(publication.error)}</p>` : ''}
</li>`;
}

export function publishSection({ lesson, publications }) {
  const chosen = new Set(publications.map((item) => item.platform));

  return `<section class="card">
  <h2>Куда публикуем</h2>
  <form id="publish-form" data-publish="${escapeHtml(lesson.slug)}">
    <h3>Полный урок</h3>
    ${platformsFor('horizontal').map((p) => checkbox(p, 'horizontal', chosen)).join('')}
    <h3>Вертикальные ролики</h3>
    ${platformsFor('vertical').map((p) => checkbox(p, 'vertical', chosen)).join('')}
    <p class="hint">
      Вертикальные уходят после горизонтальных: в их описание кладётся список
      ссылок на выложенный урок целиком.
    </p>
    <div class="form-row">
      <button class="button-brand" type="submit">Опубликовать</button>
    </div>
  </form>

  ${
    publications.length
      ? `<h3>Что вышло</h3>
         <ul>${publications.map((item) => publicationRow(item, lesson.slug)).join('')}</ul>`
      : ''
  }
</section>`;
}
```

- [ ] **Шаг 4: Написать маршрут отправки**

В `src/routes/admin.js`:

```js
// Отправка урока на площадки. Наружу ничего не уходит, пока автор не нажал —
// это требование спеки, и оно выполняется именно здесь.
router.post('/lessons/:slug/publish', async (req, res) => {
  const lesson = await getLessonBySlug(pool, req.params.slug, { includeDrafts: true });
  if (!lesson) throw new PublicError('Урок не найден', 404);

  const horizontal = Array.isArray(req.body.horizontal) ? req.body.horizontal : [];
  const vertical = Array.isArray(req.body.vertical) ? req.body.vertical : [];
  if (!horizontal.length && !vertical.length) {
    throw new PublicError('Не выбрано ни одной площадки', 400);
  }
  if (!req.app.locals.queue) throw new PublicError('Очередь недоступна', 503);

  await planPublications(pool, lesson.id, { horizontal, vertical });
  // Публикация идёт очередью: загрузка видео на площадку живёт минутами, а
  // запрос столько не живёт.
  await addJob(req.app.locals.queue, 'publishHorizontal', { lessonId: lesson.id });
  res.json({ planned: await listPublications(pool, lesson.id) });
});
```

- [ ] **Шаг 5: Встроить раздел в экран проверки**

В `src/views/admin-review.js` — импорт и вставка перед разделом «Файлы в буфере»:

```js
import { publishSection } from './admin-publish.js';
```

```js
${publishSection({ lesson, publications })}
```

В `src/routes/pages.js` в обработчике `/admin/lesson/:slug` добавить в вызов вида:

```js
publications: await listPublications(pool, lesson.id),
```

- [ ] **Шаг 6: Клиент**

В `public/admin.js`:

```js
/* --- Отправка на площадки ------------------------------------------------ */

const publishForm = document.querySelector('[data-publish]');
publishForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(publishForm);
  const button = event.submitter ?? publishForm.querySelector('button');
  try {
    await withButtonState(button, 'Отправляю…', 'Отправлено', async () => {
      const answer = await request(`/api/admin/lessons/${publishForm.dataset.publish}/publish`, {
        method: 'POST',
        body: JSON.stringify({
          horizontal: data.getAll('horizontal'),
          vertical: data.getAll('vertical')
        })
      });
      if (answer) setTimeout(() => location.reload(), 1600);
    });
  } catch (error) {
    toast(`Не отправилось: ${error.message}`, true);
  }
});

// Ссылка после ручной выкладки: для Дзена и MAX это единственный способ
// узнать, что публикация состоялась.
document.querySelectorAll('[data-manual-url]').forEach((button) => {
  button.addEventListener('click', async () => {
    const url = prompt('Вставьте ссылку на вышедший ролик');
    if (!url) return;
    try {
      const answer = await request(`/api/admin/publications/${button.dataset.manualUrl}/url`, {
        method: 'POST',
        body: JSON.stringify({ url })
      });
      if (answer) location.reload();
    } catch (error) {
      toast(`Ссылка не принята: ${error.message}`, true);
    }
  });
});

// Повтор упавшей публикации: одна упавшая площадка не должна означать
// переотправку остальных.
document.querySelectorAll('[data-retry-publication]').forEach((button) => {
  button.addEventListener('click', async () => {
    button.disabled = true;
    const answer = await request(
      `/api/admin/publications/${button.dataset.retryPublication}/retry`,
      { method: 'POST' }
    );
    if (answer) location.reload();
    else button.disabled = false;
  });
});
```

- [ ] **Шаг 7: Убедиться, что тесты проходят**

Выполнить обе команды из «Общих ограничений». Ожидается: все PASS, линтер чист.

- [ ] **Шаг 8: Коммит**

```bash
git add src/views/admin-publish.js src/views/admin-review.js src/routes/admin.js \
        src/routes/pages.js public/admin.js public/styles.css test/admin-publish.test.js
git commit -m "feat: выбор площадок и состояние публикаций в кабинете"
```

---

## Задача 9: Шаги конвейера — горизонталь, потом вертикаль

**Файлы:**
- Создать: `src/jobs/publish-horizontal.js`, `src/jobs/publish-vertical.js`,
  `test/publish-jobs.test.js`
- Изменить: `src/queue.js`, `src/worker.js`

**Интерфейсы:**
- Потребляет: `listPublications`, `markPublished`, `markFailed`, `publishedLinks`,
  `buildDescription`, реестр площадок.
- Отдаёт дальше: обработчики `publishHorizontal({ lessonId })` и
  `publishVertical({ lessonId })`; имена шагов `JOBS.publishHorizontal`,
  `JOBS.publishVertical`.

- [ ] **Шаг 1: Написать падающий тест**

`test/publish-jobs.test.js`:

```js
// Шаги публикации. Адаптеры площадок подставляются заглушками: проверяется не
// работа чужого API, а порядок и то, что одна упавшая площадка не роняет
// остальные.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makePublishHorizontal } from '../src/jobs/publish-horizontal.js';
import { makePublishVertical } from '../src/jobs/publish-vertical.js';
import { saveLesson } from '../src/services/lessons.js';
import { registerAsset } from '../src/services/media.js';
import { planPublications, listPublications } from '../src/services/publications.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://soloaijourney.online',
  jwtSecret: 'x'.repeat(32),
  media: { dir: '/tmp', ttlHours: 168 }
};

async function seed(pool) {
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок', description: 'Текст' });
  await registerAsset(pool, config, {
    lessonId: lesson.id, kind: 'trimmed', relativePath: 'lesson-1/trimmed.mp4', bytes: 10
  });
  await registerAsset(pool, config, {
    lessonId: lesson.id, kind: 'clip', relativePath: 'lesson-1/clip-1.mp4', bytes: 10
  });
  return lesson;
}

test('вышедшая площадка отмечается ссылкой', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await seed(pool);
    await planPublications(pool, lesson.id, { horizontal: ['youtube'], vertical: [] });
    const adapters = {
      youtube: { publish: async () => ({ externalId: 'abc', url: 'https://youtu.be/abc' }) }
    };
    const queue = { add: async () => {} };
    await makePublishHorizontal(config, pool, queue, adapters)({ lessonId: lesson.id });

    const [row] = await listPublications(pool, lesson.id);
    assert.equal(row.state, 'published');
    assert.equal(row.url, 'https://youtu.be/abc');
  });
});

test('одна упавшая площадка не роняет остальные', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await seed(pool);
    await planPublications(pool, lesson.id, { horizontal: ['youtube', 'vk'], vertical: [] });
    const adapters = {
      youtube: {
        publish: async () => {
          throw new Error('квота на сегодня кончилась');
        }
      },
      vk: { publish: async () => ({ externalId: '1', url: 'https://vk.com/video1' }) }
    };
    await makePublishHorizontal(config, pool, { add: async () => {} }, adapters)({
      lessonId: lesson.id
    });

    const rows = await listPublications(pool, lesson.id);
    assert.equal(rows.find((r) => r.platform === 'youtube').state, 'failed');
    assert.equal(rows.find((r) => r.platform === 'vk').state, 'published');
  });
});

test('ручная площадка ждёт автора, а не считается упавшей', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await seed(pool);
    await planPublications(pool, lesson.id, { horizontal: ['dzen'], vertical: [] });
    await makePublishHorizontal(config, pool, { add: async () => {} }, {})({
      lessonId: lesson.id
    });
    const [row] = await listPublications(pool, lesson.id);
    // Красная надпись «упало» у площадки, которую и не собирались публиковать
    // автоматически, — вранье в кабинете.
    assert.equal(row.state, 'planned');
  });
});

test('вертикаль ставится после горизонтали', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await seed(pool);
    await planPublications(pool, lesson.id, { horizontal: ['youtube'], vertical: ['telegram'] });
    const added = [];
    const adapters = {
      youtube: { publish: async () => ({ externalId: 'a', url: 'https://youtu.be/a' }) }
    };
    await makePublishHorizontal(config, pool, { add: async (n) => added.push(n) }, adapters)({
      lessonId: lesson.id
    });
    // Решение заказчика: в описании вертикалок идут ссылки на горизонтали,
    // поэтому вертикаль обязана идти второй.
    assert.equal(added[0], 'publishVertical');
  });
});

test('в описание вертикалки попадают ссылки на вышедшие горизонтали', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await seed(pool);
    await planPublications(pool, lesson.id, { horizontal: ['youtube'], vertical: ['telegram'] });
    const rows = await listPublications(pool, lesson.id);
    const youtube = rows.find((r) => r.platform === 'youtube');
    await pool.query(
      `UPDATE publications SET state = 'published', url = 'https://youtu.be/a' WHERE id = $1`,
      [youtube.id]
    );

    let seen = null;
    const adapters = {
      telegram: {
        publish: async ({ description }) => {
          seen = description;
          return { externalId: '1', url: 'https://t.me/c/1' };
        }
      }
    };
    await makePublishVertical(config, pool, adapters)({ lessonId: lesson.id });
    assert.match(seen, /https:\/\/youtu\.be\/a/);
    assert.match(seen, /YouTube/);
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Ожидается: FAIL — модули не найдены.

- [ ] **Шаг 3: Написать `src/jobs/publish-horizontal.js`**

```js
// Шаг конвейера: полный урок на площадки длинных видео.
//
// Задача — отправить смонтированную запись туда, куда выбрал автор, и записать
// судьбу каждой отправки. Спека: по строке на площадку, каждая падает
// независимо — упавший YouTube не отменяет вышедший VK.
//
// Идёт первым из двух шагов публикации: в описание вертикальных роликов
// кладётся список ссылок на вышедшие горизонтальные, значит они обязаны выйти
// раньше.
// Вызывается воркером по имени JOBS.publishHorizontal.
import { listPublications, markPublished, markFailed } from '../services/publications.js';
import { buildDescription } from '../lib/description.js';
import { mediaPath } from '../services/media.js';
import { addJob } from '../queue.js';

export function makePublishHorizontal(config, pool, queue, adapters) {
  return async ({ lessonId }) => {
    const { rows: lessons } = await pool.query(
      `SELECT l.title, l.description,
              COALESCE(array_agg(t.slug) FILTER (WHERE t.slug IS NOT NULL), '{}') AS tags
         FROM lessons l
         LEFT JOIN lesson_tags lt ON lt.lesson_id = l.id
         LEFT JOIN tags t ON t.id = lt.tag_id
        WHERE l.id = $1 GROUP BY l.id`,
      [lessonId]
    );
    if (!lessons.length) throw new Error('урок не найден');

    // На площадки уходит смонтированная запись. Монтаж выключен — идёт
    // исходник: иначе публиковать нечего.
    const { rows: videos } = await pool.query(
      `SELECT path, kind FROM assets
        WHERE lesson_id = $1 AND kind IN ('trimmed', 'source')
        ORDER BY CASE kind WHEN 'trimmed' THEN 0 ELSE 1 END LIMIT 1`,
      [lessonId]
    );
    if (!videos.length) throw new Error('нет записи для публикации');

    const description = buildDescription({
      title: lessons[0].title,
      description: lessons[0].description,
      links: [],
      tags: lessons[0].tags
    });

    const publications = await listPublications(pool, lessonId);
    let done = 0;

    for (const publication of publications) {
      if (publication.kind !== 'horizontal') continue;
      // Ручные и полуручные площадки ждут автора: красная надпись «упало» у
      // площадки, которую и не собирались публиковать сами, — вранье в кабинете.
      if (publication.mode !== 'auto') continue;
      if (publication.state === 'published') continue;

      const adapter = adapters[publication.platform];
      if (!adapter) {
        await markFailed(pool, publication.id, 'площадка не подключена');
        continue;
      }

      try {
        const result = await adapter.publish({
          videoPath: mediaPath(config, videos[0].path),
          title: lessons[0].title,
          description,
          tags: lessons[0].tags
        });
        await markPublished(pool, publication.id, result);
        done += 1;
      } catch (error) {
        // Одна упавшая площадка не отменяет остальные: цикл продолжается.
        await markFailed(pool, publication.id, error.message);
      }
    }

    const hasVertical = publications.some((item) => item.kind === 'vertical');
    if (hasVertical) await addJob(queue, 'publishVertical', { lessonId });

    return { published: done };
  };
}
```

- [ ] **Шаг 4: Написать `src/jobs/publish-vertical.js`**

```js
// Шаг конвейера: вертикальные нарезки на площадки коротких видео.
//
// Задача — отправить нарезки и положить в описание каждой список ссылок на
// вышедший урок целиком. Решение заказчика: ссылки идут все — описание длиннее,
// зато у зрителя выбор, где смотреть.
//
// Идёт после публикации горизонтальных: ссылок, которых ещё нет, в описании не
// будет.
// Вызывается воркером по имени JOBS.publishVertical.
import {
  listPublications,
  markPublished,
  markFailed,
  publishedLinks
} from '../services/publications.js';
import { buildDescription } from '../lib/description.js';
import { mediaPath, assetById } from '../services/media.js';

export function makePublishVertical(config, pool, adapters) {
  return async ({ lessonId }) => {
    const { rows: lessons } = await pool.query(
      `SELECT l.title, l.description,
              COALESCE(array_agg(t.slug) FILTER (WHERE t.slug IS NOT NULL), '{}') AS tags
         FROM lessons l
         LEFT JOIN lesson_tags lt ON lt.lesson_id = l.id
         LEFT JOIN tags t ON t.id = lt.tag_id
        WHERE l.id = $1 GROUP BY l.id`,
      [lessonId]
    );
    if (!lessons.length) throw new Error('урок не найден');

    const links = await publishedLinks(pool, lessonId);
    const description = buildDescription({
      title: lessons[0].title,
      description: lessons[0].description,
      links,
      tags: lessons[0].tags
    });

    const publications = await listPublications(pool, lessonId);
    let done = 0;

    for (const publication of publications) {
      if (publication.kind !== 'vertical') continue;
      if (publication.mode !== 'auto') continue;
      if (publication.state === 'published') continue;

      const adapter = adapters[publication.platform];
      if (!adapter) {
        await markFailed(pool, publication.id, 'площадка не подключена');
        continue;
      }

      const asset = publication.assetId ? await assetById(pool, publication.assetId) : null;
      if (!asset) {
        await markFailed(pool, publication.id, 'ролика нет в буфере: он удалён по сроку');
        continue;
      }

      try {
        const result = await adapter.publish({
          videoPath: mediaPath(config, asset.path),
          title: lessons[0].title,
          description,
          tags: lessons[0].tags
        });
        await markPublished(pool, publication.id, result);
        done += 1;
      } catch (error) {
        await markFailed(pool, publication.id, error.message);
      }
    }

    return { published: done, links: links.length };
  };
}
```

- [ ] **Шаг 5: Зарегистрировать шаги**

В `src/queue.js` в `JOBS`:

```js
  publishHorizontal: 'publishHorizontal',
  publishVertical: 'publishVertical',
```

И в `NO_RETRY_JOBS` их **не** добавлять: отказ площадки часто временный — квота,
сеть, пятисотая, — и повтор с нарастающей паузой здесь осмыслен.

В `src/worker.js`:

```js
import { makePublishHorizontal } from './jobs/publish-horizontal.js';
import { makePublishVertical } from './jobs/publish-vertical.js';

// Адаптеры площадок появятся во второй порции этапа 7. Пока пустой набор:
// автоматических площадок нет, ручные и так ждут автора, и шаг честно скажет
// «площадка не подключена» вместо тихого пропуска.
const adapters = {};

const handlers = {
  // ...
  [JOBS.publishHorizontal]: makePublishHorizontal(config, pool, queue, adapters),
  [JOBS.publishVertical]: makePublishVertical(config, pool, adapters)
};
```

В `src/views/admin-home.js` в `STEP_LABELS`:

```js
  publishHorizontal: 'выкладывается полный урок',
  publishVertical: 'выкладываются вертикальные ролики',
```

- [ ] **Шаг 6: Убедиться, что тесты проходят**

Ожидается: 5 тестов PASS плюс весь набор. Тест `queue.test.js` («у каждого имени
шага есть обработчик в воркере») проверит, что оба шага зарегистрированы.

- [ ] **Шаг 7: Коммит**

```bash
git add src/jobs/publish-horizontal.js src/jobs/publish-vertical.js \
        src/queue.js src/worker.js src/views/admin-home.js test/publish-jobs.test.js
git commit -m "feat: шаги публикации — сначала горизонталь, потом вертикаль со ссылками"
```

---

## Задача 10: Уведомление об упавшей публикации и приёмка

**Файлы:**
- Изменить: `src/jobs/publish-horizontal.js`, `src/jobs/publish-vertical.js`,
  `src/services/notify/lesson.js`, `test/publish-jobs.test.js`

**Интерфейсы:**
- Потребляет: `notify` из `src/services/notify/index.js`.
- Отдаёт дальше: `notifyPublishFailed(pool, channels, { lesson, platform, error })`.

- [ ] **Шаг 1: Написать падающий тест**

Добавить в `test/publish-jobs.test.js`:

```js
test('упавшая публикация будит автора, а не ждёт, пока он зайдёт', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await seed(pool);
    const { rows } = await pool.query(
      `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
    );
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, 'https://push.example/1', 'k', 's')`,
      [Number(rows[0].id)]
    );
    await planPublications(pool, lesson.id, { horizontal: ['youtube'], vertical: [] });

    const sent = [];
    const channels = { webpush: async (subs, message) => sent.push(message) };
    const adapters = {
      youtube: {
        publish: async () => {
          throw new Error('квота на сегодня кончилась');
        }
      }
    };
    await makePublishHorizontal(config, pool, { add: async () => {} }, adapters, channels)({
      lessonId: lesson.id
    });

    // Спека, раздел 7: повод уведомить админа — публикация на площадку упала.
    assert.equal(sent.length, 1);
    assert.match(sent[0].body, /youtube/i);
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Ожидается: FAIL — уведомление не отправляется.

- [ ] **Шаг 3: Добавить уведомление**

В `src/services/notify/lesson.js`:

```js
/**
 * Будит автора, когда публикация упала.
 * Спека, раздел 7: об упавшей публикации автор должен узнать сам, а не найти
 * красную строку, случайно зайдя в кабинет.
 * Вызывается из шагов публикации.
 */
export async function notifyPublishFailed(pool, channels, { lesson, platform, error }) {
  const { rows } = await pool.query(`SELECT id FROM users WHERE role = 'admin'`);
  for (const { id } of rows) {
    await notify(
      pool,
      {
        userId: Number(id),
        kind: 'publish_failed',
        // Ключ несёт урок, площадку и попытку: повтор задачи не разбудит
        // автора второй раз тем же сообщением.
        dedupKey: `publish:${lesson.id}:${platform}:failed`,
        title: 'Публикация не прошла',
        body: `${platform}: ${String(error).slice(0, 120)}`,
        url: `/admin/lesson/${lesson.slug}`
      },
      channels
    );
  }
}
```

В обоих шагах публикации принять `channels` пятым доводом и вызвать в `catch`:

```js
} catch (error) {
  await markFailed(pool, publication.id, error.message);
  if (channels) {
    await notifyPublishFailed(pool, channels, {
      lesson: { id: lessonId, slug: lessons[0].slug },
      platform: publication.platform,
      error: error.message
    });
  }
}
```

В `src/worker.js` передать каналы, собранные так же, как в `src/app.js`:

```js
import { createWebPushChannel } from './services/notify/webpush.js';
import { createTelegramChannel } from './services/notify/telegram.js';

const channels = {
  webpush: createWebPushChannel(config, pool),
  telegram: createTelegramChannel(config)
};
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Выполнить обе команды из «Общих ограничений».

- [ ] **Шаг 5: Проверка приёмки на живом сервере**

```bash
docker compose up -d --build
```

1. Открыть `/admin/settings` — перечислены восемь площадок, у Дзена и MAX
   написано «выкладывается вручную».
2. На экране проверки урока выбрать Дзен и MAX, нажать «Опубликовать».
3. Убедиться, что в кабинете появились строки со состоянием «запланировано» и
   кнопкой «Я выложил, вот ссылка».
4. Открыть пакет материалов ручной площадки: скачиваются видео, обложка и
   субтитры, текст описания готов к вставке.
5. Вставить ссылку — строка стала «вышло», ссылка открывается.
6. Проверить, что в описании пакета для MAX (вертикальная площадка) появилась
   ссылка на выложенный Дзен.

- [ ] **Шаг 6: Коммит**

```bash
git add src/jobs/publish-horizontal.js src/jobs/publish-vertical.js \
        src/services/notify/lesson.js src/worker.js test/publish-jobs.test.js
git commit -m "feat: уведомление автору об упавшей публикации"
```

---

## Что остаётся во второй порции

Порция 7б — сами автоматические адаптеры, по задаче на площадку:

| Площадка | Что предстоит | Что нужно от заказчика |
|---|---|---|
| Telegram | Отправка видео в канал ботом | Ничего: бот и канал уже есть |
| YouTube | OAuth, возобновляемая загрузка, квота | Приложение в Google Cloud, проверка приложения |
| VK Видео | OAuth, загрузка по выданному адресу | Приложение ВКонтакте |
| RuTube | Загрузка по ключу | Ключ от площадки по заявке |
| TikTok | Загрузка в черновики | Приложение и ревью |
| Instagram | Reels через Graph API | Business-аккаунт и приложение Meta |

Порядок внутри порции: Telegram первым — он единственный, где ничего не надо
регистрировать, и на нём отлаживается весь путь автоматической публикации.

---

## Самопроверка плана

**Покрытие спеки.** Раздел 8 (путь урока): состояния публикаций — задача 5,
«наружу ничего без нажатия» — задача 8, «на площадки уходит смонтированная
запись» — задача 9. Раздел 9 (адаптеры): три режима зрелости — задачи 3 и 7,
единый интерфейс адаптера — задача 9 (`publish({ videoPath, title, description,
tags })`). Раздел 7 (уведомления): упавшая публикация будит автора — задача 10.
Раздел 11 (соглашения): латиница в именах и шифрование токенов — в общих
ограничениях, проверяются линтером и тестом задачи 2.

**Пробел, оставленный сознательно.** Метрики и стягивание комментариев с
площадок (спека, раздел 10) — это этап 9, не этот план.

**Согласованность имён.** `publish({ videoPath, title, description, tags })` →
`{ externalId, url }` — один и тот же вид у адаптера в задачах 7, 9 и в порции
7б. `listPublications` отдаёт `manualUrl` (не `manual_url`) — так его читают
кабинет в задаче 8 и `publishedLinks` в задаче 5.
