# Портал видеоуроков, этапы 0–4 — план работ

> **Для исполнителя (агента или человека):** ОБЯЗАТЕЛЬНАЯ ПОДСКИЛЛ:
> `superpowers:subagent-driven-development` (рекомендуется) или
> `superpowers:executing-plans`. Задачи выполняются по одной, шаги отмечаются
> галочками `- [ ]`. Не переходить к следующей задаче, пока тесты текущей не
> зелёные и коммит не сделан.

**Цель.** Довести портал до состояния «живой сайт с приложением на телефоне»:
каркас на сервере, вход шестью путями (пока двумя), витрина уроков с обратной
связью, PWA с пушами, борд идей. Всё, что после этого, — автоматизация.

**Архитектура.** Один контейнер `api` на Node 24 + Express 5: JSON API для всех
клиентов и серверный рендер публичных страниц из одного процесса. База —
PostgreSQL в общем слое VPS, отдельная база `portal` с отдельной ролью. Точка
входа — общий nginx из `ClaudeDocker`. Фронт — серверные шаблоны плюс ванильный
JS, без сборки.

**Стек.** Node 24 LTS, Express 5, `pg`, `jsonwebtoken`, `web-push`, ESM,
встроенный `node:test`, ESLint 9 (flat config) + Prettier, GitHub Actions.

**Спека.** `docs/superpowers/specs/2026-09-01-portal-design.md` — план опирается
на неё и спорит с ней только там, где это записано ниже. Читать оба документа.

---

## Глобальные требования

Действуют в каждой задаче, повторяться в них не будут.

- **Node 24 LTS**, **Express 5**, модули только **ESM** (`"type": "module"`).
- Тесты — встроенный **`node:test`**, запуск `npm test`. Каталог тест-раннеру
  передаётся шаблоном (`node --test "test/**/*.test.js"`): голый путь к каталогу
  Node 24 принимает за файл и падает с `Cannot find module`. Сторонних
  тест-раннеров и `supertest` не добавляем: HTTP проверяется через `app.listen(0)`
  и глобальный `fetch`.
- **ESLint 9 flat config + Prettier**, единый стиль. `npm run lint` — часть CI.
- **Комментарии на русском.** Блочный комментарий обязателен для файла, класса,
  функции, сервиса и отвечает на три вопроса: какую задачу выполняет, зачем
  нужен, **кто его вызывает**. Для переменных и констант — там, где имя не
  объясняет себя, и всегда для настроек, порогов и чисел с неочевидным смыслом.
  Пересказ сигнатуры комментарием не считается. «Счётчик циклов» над счётчиком
  циклов не пишем.
- **Ни один секрет не попадает в код и в git.** Всё из окружения. Новая
  переменная добавляется в `.env.example` **тем же коммитом**, что и код,
  который её читает.
- **Адрес портала нигде не хардкодится** — только `PUBLIC_BASE_URL`. Из него
  собираются ссылки, `redirect_uri` OAuth и манифест PWA.
- **Миграции — версионированные файлы**, применяются при старте, по порядку
  имён, каждая в своей транзакции.
- Файлы держим небольшими, одна ответственность на файл.
- **Коммиты**: `<тип>: <что сделано>` на русском (`feat:`, `fix:`, `test:`,
  `chore:`, `docs:`), тело — зачем, если это не очевидно. Коммит после каждой
  задачи, не реже.
- Порт приложения — **3004** (3001 занят game, 3002 devbot, 3003 myproject).
- **Домены проекта** (зарегистрированы 2026-09-02): `soloaijourney.online` и
  `soloaijourney.ru`. Основной — тот, что стоит в `PUBLIC_BASE_URL`; второй
  отвечает редиректом на первый. Установленная PWA и подписки Web Push
  привязаны к origin, поэтому основной домен выбирается один раз и больше не
  меняется. Адрес по-прежнему нигде не хардкодится.
- **Бот** `@solo_ai_journey_bot` — один на всё: виджет входа на сайте, подпись
  мини-приложения, отправка уведомлений и, с этапа 8, публикация в канал
  `t.me/solo_ai_journey`, где он администратор. Для MAX предусмотрено то же
  самое; бот там появится позже.

## Расхождения со спекой

Спека написана 2026-09-01, инфраструктура VPS за сутки изменилась. Ниже —
что именно исполнитель делает иначе, и почему. Спеку правим отдельным коммитом
в конце этапа 0.

| Спека говорит | Делаем | Почему |
|---|---|---|
| Свой контейнер `db` в компоузе портала | Общий `postgres` из `ClaudeDocker`, своя база `portal` и своя роль `portal` | Постгрес уехал в общий слой, аргумент «перезапуск чужого компоуза уронит портал» отпал. На машине 3.8 ГБ и заполненный swap — второй экземпляр это ~200 МБ впустую. **Решение заказчика от 2026-09-02.** Свой `db` остаётся в компоузе под профилем `standalone` — на чистой машине проект по-прежнему поднимается целиком |
| Redis `claudeservice-redis-1` | Общий `redis` (алиас на сети `shared-data`) | Правило владения из `ClaudeDocker/README.md`: ресурс нужен нескольким проектам — живёт в общем слое. На этапах 0–4 очередь не нужна вообще, подключаем на этапе 5 |
| nginx проекта game | `shared-nginx-1` из `ClaudeDocker` | Вход сервера переехал в общий слой |
| `passport` + `passport-google-oauth20` | Голый `fetch` по эндпоинтам Google | В game (`server/routes/auth.js:87-131`) OAuth написан вручную и работает; `passport` там лежит неиспользуемой зависимостью. Минус две зависимости из публичного репозитория |
| Три контейнера с первого дня | `api` сейчас, `worker` на этапе 5 | Воркеру до конвейера нечего делать, а память на машине в дефиците |
| «серверный рендер HTML шаблонами» | Шаблоны — обычные ESM-функции, возвращающие строку | Движок шаблонов — ещё одна зависимость и ещё один язык в кадре. Функция с экранированием проверяется обычным `node:test` |

## Что берём готовым

- **Web Push** — из `myproject`: `server.js:17-34` (VAPID, отправка),
  `public/sw.js` (обработчики `push` и `notificationclick`). Логика подписки
  проверена в бою, переписывать нечего.
- **Google OAuth и проверка подписи Telegram** — из
  `game_world_tycoon_idle/server/routes/auth.js`: обмен кода на токен (строки
  99–131), HMAC виджета (строки 33–56). Переносим смысл, не копируем код: там
  провайдер вшит в таблицу `users`, у нас он в отдельной `identities`.
- **Dockerfile** — форма из `myproject`: `node:24-alpine`, `USER node`.
  Добавляем многоступенчатость.

## Структура файлов

Создаётся по ходу плана; здесь — карта целиком, чтобы исполнитель видел,
куда что кладётся.

```
docker-compose.yml          самодостаточный compose (db под профилем standalone)
Dockerfile                  многоступенчатая сборка, запуск не от root
package.json                зависимости и npm-скрипты
eslint.config.js            ESLint 9 flat config
.prettierrc.json            стиль
.github/workflows/ci.yml    линт, тесты, сборка образа

migrations/
  001_schema_migrations.sql журнал применённых миграций
  002_users.sql             users, identities
  003_content.sql           lessons, news, tags, lesson_tags, publications
  004_feedback.sql          reactions, comments
  005_notifications.sql     push_subscriptions, notifications
  006_ideas.sql             ideas, idea_votes

src/
  config.js                 чтение и проверка окружения (единственная точка)
  db.js                     пул подключений к postgres
  migrate.js                применение миграций при старте
  app.js                    сборка Express-приложения
  server.js                 точка входа: конфиг → пул → миграции → listen
  middleware/
    session.js              разбор токена из куки или заголовка → req.user
    guards.js               requireUser, requireAdmin
    errors.js               обработчик ошибок Express 5
  lib/
    jwt.js                  выпуск и проверка токена сессии
    telegram-signature.js   проверка подписи виджета Telegram
    google-oauth.js         ссылка на согласие и обмен кода на профиль
    html.js                 экранирование и сборка страницы
  services/
    identity.js             единая процедура входа и привязки
    lessons.js              уроки и новости
    feedback.js             реакции и комментарии
    ideas.js                идеи и голоса
    notify/
      index.js              слой каналов: выбор канала и защита от повтора
      webpush.js            канал Web Push
      telegram.js           канал телеграм-бота
  routes/
    auth.js                 вход, выход, /me
    lessons.js              JSON API витрины и админские правки
    feedback.js             реакции, комментарии, модерация
    ideas.js                борд идей
    push.js                 ключ VAPID, подписка и отписка
    pages.js                серверные страницы
  views/
    layout.js               общая обвязка страницы, OG-теги
    feed.js                 лента уроков и новостей
    lesson.js               карточка урока
    ideas.js                страница борда идей
    login.js                страница входа

public/
  app.js                    ванильный клиент: реакции, комментарии, подписка
  styles.css
  manifest.webmanifest      отдаётся не файлом, а роутом (адрес из окружения)
  sw.js                     service worker: офлайн-оболочка и пуши
  icons/                    192, 512, 180

test/
  helpers/db.js             тестовая база: миграции и очистка между тестами
  helpers/http.js           поднять приложение на случайном порту
  <по файлу на модуль>
```

---

# Этап 0 — Каркас

**Критерий приёмки заказчика:** адрес открывается по https; после перезагрузки
VPS всё поднялось само.

### Задача 1: Скелет репозитория, линтер, тесты, CI

**Файлы:**
- Создать: `package.json`, `eslint.config.js`, `.prettierrc.json`,
  `.github/workflows/ci.yml`, `src/version.js`, `test/version.test.js`

**Интерфейсы:**
- Отдаёт дальше: `npm test` (запускает `npm test`), `npm run lint`.

- [ ] **Шаг 1: Написать падающий тест**

`test/version.test.js`:

```js
// Проверка того, что каркас проекта собран: ESM-импорт работает, тест-раннер
// видит файлы, версия читается из package.json, а не вписана в код.
// Вызывается из `npm test` и из CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { version } from '../src/version.js';

test('версия проекта совпадает с package.json', async () => {
  const pkg = JSON.parse(
    await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../package.json', import.meta.url), 'utf8')
    )
  );
  assert.equal(version, pkg.version);
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `npm test`
Ожидается: FAIL — `Cannot find module .../src/version.js`.

- [ ] **Шаг 3: Написать `package.json`**

```json
{
  "name": "my-portal",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Портал видеоуроков: витрина, обратная связь, публикация на площадки.",
  "engines": { "node": ">=24" },
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test \"test/**/*.test.js\"",
    "lint": "eslint .",
    "format": "prettier --write ."
  },
  "devDependencies": {
    "eslint": "^9.0.0",
    "prettier": "^3.0.0"
  }
}
```

- [ ] **Шаг 4: Написать `src/version.js`**

```js
// Версия приложения. Задача — отдать номер сборки одной строкой всем, кому он
// нужен: ответу /healthz и странице «о проекте». Зачем отдельный файл: номер
// живёт в package.json, и дублировать его в коде нельзя — разойдётся.
// Вызывается из src/app.js (маршрут /healthz) и из тестов.
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const version = pkg.version;
```

- [ ] **Шаг 5: Написать `eslint.config.js` и `.prettierrc.json`**

`eslint.config.js`:

```js
// Правила стиля для всего репозитория. Задача — держать код в кадре
// одинаковым: репозиторий показательный, разнобой в нём заметнее, чем в
// обычном. Плоский конфиг — формат ESLint 9, .eslintrc больше не читается.
// Вызывается из `npm run lint` и из CI.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'public/vendor/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: 'error',
      'no-console': 'off'
    }
  },
  {
    // Клиентский код исполняется браузером, а не Node: там свои глобальные
    // объекты, и Node-овских нет.
    files: ['public/**/*.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.serviceworker } }
  }
];
```

`.prettierrc.json`:

```json
{
  "singleQuote": true,
  "printWidth": 100,
  "trailingComma": "none",
  "arrowParens": "always"
}
```

Добавить в `devDependencies`: `"@eslint/js": "^9.0.0"`, `"globals": "^15.0.0"`.
Выполнить `npm install`.

- [ ] **Шаг 6: Убедиться, что тест проходит и линтер молчит**

Выполнить: `npm test && npm run lint`
Ожидается: 1 тест PASS, линтер без замечаний.

- [ ] **Шаг 7: Написать `.github/workflows/ci.yml`**

```yaml
# Проверка каждого коммита: линтер, тесты, сборка образа.
# Зачем: репозиторий публичный и учебный — зелёная галочка в нём это доверие,
# а красная видна раньше, чем зритель успеет повторить ошибку за автором.
# Запускается GitHub на push и pull request в main.
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    services:
      # Тесты ходят в настоящий postgres: половина логики портала — это
      # ограничения самой базы (уникальность привязок, один голос на идею),
      # и на заглушке они не проверяются.
      postgres:
        image: postgres:18-alpine
        env:
          POSTGRES_DB: portal_test
          POSTGRES_USER: portal
          POSTGRES_PASSWORD: portal
        options: >-
          --health-cmd "pg_isready -U portal"
          --health-interval 5s --health-timeout 5s --health-retries 10
        ports: ['5432:5432']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test
        env:
          TEST_DATABASE_URL: postgres://portal:portal@localhost:5432/portal_test
      - run: docker build -t my-portal:ci .
```

- [ ] **Шаг 8: Коммит**

```bash
git add package.json package-lock.json eslint.config.js .prettierrc.json \
        .github/workflows/ci.yml src/version.js test/version.test.js
git commit -m "chore: каркас репозитория — ESM, node:test, ESLint 9, CI"
```

### Задача 2: Конфигурация из окружения

**Файлы:**
- Создать: `src/config.js`, `test/config.test.js`
- Изменить: `.env.example`

**Интерфейсы:**
- Отдаёт дальше: `loadConfig(env)` → объект
  `{ publicBaseUrl, port, db: { host, port, name, user, password }, jwtSecret,
  adminIdentities: [{provider, externalId}], telegram: { botToken, channelId },
  google: { clientId, clientSecret }, vapid: { publicKey, privateKey, subject },
  media: { dir, ttlHours } }`. Бросает `Error` с именем переменной, если
  обязательная не задана.

- [ ] **Шаг 1: Написать падающий тест**

`test/config.test.js`:

```js
// Проверка чтения окружения. Задача теста — закрепить два правила: без
// обязательной переменной приложение не стартует молча, а падает с её именем;
// адрес портала берётся только из окружения и нормализуется.
// Вызывается из `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

// Минимальный набор, при котором приложение имеет право стартовать.
const minimal = {
  PUBLIC_BASE_URL: 'https://portal.example.nip.io/',
  DB_HOST: 'postgres',
  DB_NAME: 'portal',
  DB_USER: 'portal',
  DB_PASS: 'secret',
  JWT_SECRET: 'x'.repeat(32)
};

test('нет обязательной переменной — падаем с её именем', () => {
  const env = { ...minimal };
  delete env.JWT_SECRET;
  assert.throws(() => loadConfig(env), /JWT_SECRET/);
});

test('хвостовой слэш в адресе срезается', () => {
  const config = loadConfig(minimal);
  assert.equal(config.publicBaseUrl, 'https://portal.example.nip.io');
});

test('порт по умолчанию 3004', () => {
  assert.equal(loadConfig(minimal).port, 3004);
});

test('список админов разбирается в пары провайдер-идентификатор', () => {
  const config = loadConfig({ ...minimal, ADMIN_IDENTITIES: 'google:42, tg_widget:7 ' });
  assert.deepEqual(config.adminIdentities, [
    { provider: 'google', externalId: '42' },
    { provider: 'tg_widget', externalId: '7' }
  ]);
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/config.test.js`
Ожидается: FAIL — `Cannot find module .../src/config.js`.

- [ ] **Шаг 3: Написать `src/config.js`**

```js
// Конфигурация портала: единственное место, где читается окружение.
// Зачем единственное: секретов в публичном репозитории быть не может, а
// разбросанные по коду process.env превращают проверку «ничего не утекло» в
// вычитывание всего проекта. Здесь же приложение падает на старте, если
// обязательной переменной нет, — вместо загадочной ошибки в первом запросе.
// Вызывается из src/server.js один раз при запуске и из тестов с подставным
// окружением.

// Порт приложения. 3001 занят game, 3002 devbot, 3003 myproject.
const DEFAULT_PORT = 3004;

// Срок жизни файла в рабочем буфере по умолчанию — неделя. Постоянного
// видеоархива у портала нет, буфер обязан чистить себя сам.
const DEFAULT_MEDIA_TTL_HOURS = 168;

/**
 * Читает переменную, которой не может не быть.
 * Зачем отдельной функцией: сообщение об ошибке должно называть переменную,
 * иначе в логе остаётся «undefined» без подсказки, что именно не задано.
 * Вызывается только из loadConfig.
 */
function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`Не задана обязательная переменная окружения ${name}`);
  return value;
}

/**
 * Разбирает список админов вида "google:42,tg_widget:7".
 * Зачем: роль администратора нельзя выдавать по факту регистрации — портал
 * публичный, и первым может зарегистрироваться кто угодно. Админ назначается
 * снаружи, окружением. Вызывается только из loadConfig.
 */
function parseAdminIdentities(raw) {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [provider, externalId] = item.split(':');
      return { provider: provider.trim(), externalId: String(externalId).trim() };
    });
}

/**
 * Собирает конфигурацию приложения из окружения.
 * Зачем принимает env аргументом: так конфигурацию можно проверить тестом,
 * не подменяя process.env глобально.
 * Вызывается из src/server.js и из тестов.
 */
export function loadConfig(env = process.env) {
  return {
    publicBaseUrl: required(env, 'PUBLIC_BASE_URL').replace(/\/+$/, ''),
    port: Number(env.PORT ?? DEFAULT_PORT),
    db: {
      host: required(env, 'DB_HOST'),
      port: Number(env.DB_PORT ?? 5432),
      name: required(env, 'DB_NAME'),
      user: required(env, 'DB_USER'),
      password: required(env, 'DB_PASS')
    },
    jwtSecret: required(env, 'JWT_SECRET'),
    adminIdentities: parseAdminIdentities(env.ADMIN_IDENTITIES ?? ''),
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN ?? '',
      channelId: env.TELEGRAM_CHANNEL_ID ?? ''
    },
    google: {
      clientId: env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: env.GOOGLE_CLIENT_SECRET ?? ''
    },
    vapid: {
      publicKey: env.VAPID_PUBLIC ?? '',
      privateKey: env.VAPID_PRIVATE ?? '',
      subject: env.VAPID_SUBJECT ?? 'mailto:admin@example.com'
    },
    media: {
      dir: env.MEDIA_DIR ?? '/app/media',
      ttlHours: Number(env.MEDIA_TTL_HOURS ?? DEFAULT_MEDIA_TTL_HOURS)
    }
  };
}
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Выполнить: `node --test test/config.test.js`
Ожидается: 4 теста PASS.

- [ ] **Шаг 5: Дописать `.env.example`**

Добавить в раздел «Адрес портала» строку про оверлей и новый раздел про админа:

```bash
# Подключение оверлея этого VPS: снимает публикацию порта и включает контейнер
# в общие сети. На чистой машине строка не нужна — там работает профиль standalone.
COMPOSE_FILE=docker-compose.yml:/path/to/ClaudeDocker/projects/my_portal/docker-compose.yml

# --- Администратор ------------------------------------------------------------
# Кто получает роль admin при входе. Список пар «провайдер:идентификатор»,
# через запятую. Роль не выдаётся по факту регистрации: портал публичный,
# первым зарегистрироваться может кто угодно.
ADMIN_IDENTITIES=

# Тестовая база. Пусто в бою; заполняется только при прогоне тестов.
TEST_DATABASE_URL=
```

Исправить там же адрес Redis на общий слой:

```bash
REDIS_URL=redis://redis:6379
```

- [ ] **Шаг 6: Коммит**

```bash
git add src/config.js test/config.test.js .env.example
git commit -m "feat: конфигурация из окружения с проверкой обязательных переменных"
```

### Задача 3: Приложение Express и обработка ошибок

**Файлы:**
- Создать: `src/app.js`, `src/middleware/errors.js`, `test/helpers/http.js`,
  `test/app.test.js`

**Интерфейсы:**
- Потребляет: `loadConfig` из задачи 2, `version` из задачи 1.
- Отдаёт дальше: `createApp({ config, pool })` → экземпляр Express без
  замыкающих обработчиков; `finalize(app)` → тот же app с 404 и обработчиком
  ошибок в конце цепочки; `PublicError(message, status)` для ошибок, которые
  можно показать пользователю;
  `withServer(app, fn)` из `test/helpers/http.js` — поднимает приложение на
  случайном порту, отдаёт в `fn` базовый адрес, гасит сервер после.

- [ ] **Шаг 1: Написать падающий тест**

`test/helpers/http.js`:

```js
// Помощник для HTTP-тестов: поднимает приложение на свободном порту и гасит
// после проверки. Зачем: без него каждый тест повторял бы возню с listen,
// адресом и close, а забытый close вешает прогон тестов.
// Вызывается из всех тестов, которые ходят в приложение по HTTP.
export async function withServer(app, fn) {
  // Порт 0 — просьба к системе выдать любой свободный: параллельные тесты не
  // должны драться за один номер.
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
```

`test/app.test.js`:

```js
// Проверка каркаса приложения: живой ответ /healthz и единая форма ошибки.
// Вызывается из `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { withServer } from './helpers/http.js';
import { version } from '../src/version.js';

const config = { publicBaseUrl: 'https://portal.example.nip.io', port: 0 };

test('/healthz отвечает версией', async () => {
  const app = finalize(createApp({ config, pool: null }));
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok', version });
  });
});

test('неизвестный маршрут — 404 в общем формате', async () => {
  const app = finalize(createApp({ config, pool: null }));
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/нет-такого`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'Не найдено' });
  });
});

test('ошибка в асинхронном обработчике не роняет процесс и даёт 500', async () => {
  const app = createApp({ config, pool: null });
  app.get('/взорвись', async () => {
    throw new Error('внутренняя поломка');
  });
  finalize(app);
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/взорвись`);
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, 'Внутренняя ошибка');
    // Текст исключения наружу не отдаём: он часто содержит запрос и параметры.
    assert.ok(!JSON.stringify(body).includes('внутренняя поломка'));
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/app.test.js`
Ожидается: FAIL — `Cannot find module .../src/app.js`.

- [ ] **Шаг 3: Написать `src/middleware/errors.js`**

```js
// Обработка ошибок в едином виде. Задача — превратить любое исключение в
// JSON одной формы и не дать деталям утечь наружу: текст ошибки почти всегда
// содержит SQL, параметры запроса, иногда токен. Зачем отдельным файлом:
// формат ответа об ошибке — договор со всеми четырьмя клиентами, и менять его
// надо в одном месте. Вызывается из src/app.js последним в цепочке.

/**
 * Ошибка, которую можно показать пользователю.
 * Зачем: отличает «ты прислал ерунду» (400) от «у нас сломалось» (500) —
 * первое показываем как есть, второе прячем. Бросается из сервисов и роутов.
 */
export class PublicError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.public = true;
  }
}

/** Ответ на запрос к несуществующему маршруту. Вызывается из src/app.js. */
export function notFound(req, res) {
  res.status(404).json({ error: 'Не найдено' });
}

/**
 * Последнее звено цепочки Express. Express 5 сам ловит отказ промиса в
 * асинхронном обработчике и доводит его сюда — ради этого и взята пятая версия.
 * Вызывается фреймворком, вручную не вызывается никогда.
 */
export function errorHandler(err, req, res, _next) {
  if (err?.public) {
    res.status(err.status ?? 400).json({ error: err.message });
    return;
  }
  console.error('Необработанная ошибка:', err);
  res.status(500).json({ error: 'Внутренняя ошибка' });
}
```

- [ ] **Шаг 4: Написать `src/app.js`**

```js
// Сборка HTTP-приложения. Задача — собрать в одном месте порядок прослоек и
// маршрутов: он важен (сессия раньше защит, ошибки последними) и должен
// читаться целиком с одного экрана. Зачем принимает config и pool аргументами:
// приложение не лезет в окружение и в глобальные соединения само, поэтому в
// тесте поднимается с подставными. Вызывается из src/server.js и из тестов.
import express from 'express';
import { version } from './version.js';
import { notFound, errorHandler } from './middleware/errors.js';

/**
 * Собирает приложение: прослойки и маршруты.
 * Возвращает приложение БЕЗ замыкающих обработчиков — их ставит finalize,
 * чтобы тест мог дописать свой маршрут после сборки.
 */
export function createApp({ config, pool }) {
  const app = express();

  // За общим nginx настоящий адрес клиента приходит заголовком; без этого в
  // логах и ограничителях частоты будет адрес контейнера nginx для всех.
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '64kb' }));

  // Пригодится роутам и сервисам, чтобы не тащить конфиг импортом отовсюду.
  app.locals.config = config;
  app.locals.pool = pool;

  // Проба живости для docker и для человека: адрес открылся — значит дошло до
  // приложения, а не остановилось на nginx.
  app.get('/healthz', (req, res) => res.json({ status: 'ok', version }));

  return app;
}

/**
 * Ставит замыкающие обработчики: 404 и ошибки.
 * Зачем отдельно от createApp: в Express порядок решает всё — эти двое обязаны
 * стоять после всех маршрутов, включая те, что добавит тест.
 * Вызывается из src/server.js и из тестов перед listen.
 */
export function finalize(app) {
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
```

Добавить зависимость: `npm install express@^5`.

- [ ] **Шаг 5: Убедиться, что тесты проходят**

Выполнить: `node --test test/app.test.js`
Ожидается: 3 теста PASS.

Если тест `/взорвись` отвечает 404 — `finalize` вызвана до `app.get`.

- [ ] **Шаг 6: Коммит**

```bash
git add src/app.js src/middleware/errors.js test/helpers/http.js test/app.test.js package.json package-lock.json
git commit -m "feat: приложение Express 5 с единым форматом ошибок"
```

### Задача 4: Подключение к базе и миграции при старте

**Файлы:**
- Создать: `src/db.js`, `src/migrate.js`, `migrations/001_schema_migrations.sql`,
  `src/server.js`, `test/helpers/db.js`, `test/migrate.test.js`

**Интерфейсы:**
- Потребляет: `loadConfig`, `createApp`.
- Отдаёт дальше: `createPool(dbConfig)` → `pg.Pool`;
  `runMigrations(pool, dir)` → `{ applied: ['001_...', ...] }`;
  `withTestDb(fn)` из `test/helpers/db.js` — пул к тестовой базе с применёнными
  миграциями и очищенными таблицами.

- [ ] **Шаг 1: Написать падающий тест**

`test/helpers/db.js`:

```js
// Тестовая база. Задача — дать каждому тесту чистую схему настоящего
// postgres. Зачем настоящую, а не заглушку: половина правил портала — это
// ограничения самой базы (одна привязка на провайдера, один голос на идею),
// и заглушка их не проверяет. Если TEST_DATABASE_URL не задан, тесты базы
// пропускаются — чтобы `npm test` работал на машине без базы.
// Вызывается из всех тестов, которым нужна база.
import pg from 'pg';
import { runMigrations } from '../../src/migrate.js';

export const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? '';
export const skipWithoutDb = { skip: testDatabaseUrl ? false : 'TEST_DATABASE_URL не задан' };

export async function withTestDb(fn) {
  const pool = new pg.Pool({ connectionString: testDatabaseUrl });
  try {
    await runMigrations(pool, new URL('../../migrations/', import.meta.url));
    // Порядок таблиц не важен: CASCADE снимает внешние ключи, RESTART IDENTITY
    // возвращает счётчики, иначе идентификаторы растут от теста к тесту и
    // проверки на конкретные значения становятся хрупкими.
    const { rows } = await pool.query(
      `SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`
    );
    if (rows.length) {
      const names = rows.map((r) => `"${r.tablename}"`).join(', ');
      await pool.query(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
    }
    return await fn(pool);
  } finally {
    await pool.end();
  }
}
```

`test/migrate.test.js`:

```js
// Проверка применения миграций: журнал заполняется, повтор ничего не ломает.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runMigrations } from '../src/migrate.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

test('миграции применяются и записываются в журнал', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query('SELECT name FROM schema_migrations ORDER BY name');
    assert.ok(rows.some((r) => r.name === '001_schema_migrations.sql'));
  });
});

test('повторный запуск не применяет уже применённое', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const result = await runMigrations(pool, new URL('../migrations/', import.meta.url));
    assert.deepEqual(result.applied, []);
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `TEST_DATABASE_URL=postgres://portal:portal@localhost:5432/portal_test node --test test/migrate.test.js`
Ожидается: FAIL — `Cannot find module .../src/migrate.js`.

- [ ] **Шаг 3: Написать миграцию и модули базы**

`migrations/001_schema_migrations.sql`:

```sql
-- Журнал применённых миграций. Задача — помнить, что уже накатано, чтобы
-- повторный старт контейнера не пытался создать существующие таблицы.
-- Читается и пополняется только src/migrate.js.
CREATE TABLE IF NOT EXISTS schema_migrations (
  name       text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
```

`src/db.js`:

```js
// Пул подключений к PostgreSQL. Задача — держать один набор соединений на
// процесс: открывать соединение на каждый запрос дорого, а без ограничения
// сверху приложение упирается в лимит базы. Зачем отдельным файлом: параметры
// пула — это настройка эксплуатации, и менять её надо в одном месте.
// Вызывается из src/server.js один раз при старте.
import pg from 'pg';

// Десяти соединений хватает: у портала один процесс, а общий постгрес делится
// с другими проектами — забирать больше без нужды невежливо.
const MAX_CLIENTS = 10;

export function createPool(dbConfig) {
  return new pg.Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.name,
    user: dbConfig.user,
    password: dbConfig.password,
    max: MAX_CLIENTS
  });
}
```

`src/migrate.js`:

```js
// Применение миграций при старте. Задача — привести схему базы к состоянию,
// которое ждёт код, до того как приложение начнёт принимать запросы. Зачем при
// старте, а не руками: разъехавшаяся схема — самая частая причина «у меня
// работает», а деплой здесь это `docker compose up -d` без отдельных шагов.
// Вызывается из src/server.js и из тестового помощника test/helpers/db.js.
import { readdir, readFile } from 'node:fs/promises';

/**
 * Накатывает все ещё не применённые файлы из каталога миграций по порядку имён.
 * Каждый файл идёт в своей транзакции: упавшая миграция откатывается целиком,
 * а применённые до неё остаются — иначе разбор аварии превращается в гадание.
 */
export async function runMigrations(pool, dir) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

  const { rows } = await pool.query('SELECT name FROM schema_migrations');
  const done = new Set(rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

  const applied = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(new URL(file, dir), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      applied.push(file);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Миграция ${file} не применилась: ${err.message}`);
    } finally {
      client.release();
    }
  }
  return { applied };
}
```

`src/server.js`:

```js
// Точка входа. Задача — соединить в правильном порядке четыре вещи: конфиг,
// пул, миграции, приём запросов. Порядок здесь не косметика: принимать запросы
// на несоответствующей схеме нельзя. Запускается командой `node src/server.js`
// из CMD образа.
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { runMigrations } from './migrate.js';
import { createApp, finalize } from './app.js';

const config = loadConfig();
const pool = createPool(config.db);

const { applied } = await runMigrations(pool, new URL('../migrations/', import.meta.url));
if (applied.length) console.log(`Применены миграции: ${applied.join(', ')}`);

const app = finalize(createApp({ config, pool }));
app.listen(config.port, () => console.log(`Портал слушает порт ${config.port}`));
```

Добавить зависимость: `npm install pg`.

- [ ] **Шаг 4: Завести базу и роль в общем постгресе**

```bash
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" shared-postgres-1 \
  psql -U game_user -d postgres \
  -c "CREATE ROLE portal LOGIN PASSWORD 'ЗАМЕНИТЬ';" \
  -c "CREATE DATABASE portal OWNER portal;" \
  -c "CREATE DATABASE portal_test OWNER portal;"
```

Пароль сгенерировать (`openssl rand -base64 24`), записать в `.env` портала в
`DB_PASS`. В git не попадает.

- [ ] **Шаг 5: Убедиться, что тесты проходят**

Выполнить:
`TEST_DATABASE_URL=postgres://portal:ПАРОЛЬ@127.0.0.1:5432/portal_test node --test test/migrate.test.js`

Если порт постгреса наружу не опубликован (а он не опубликован), прогонять
тесты изнутри сети: `docker compose run --rm api npm test` — либо временно
на локальной машине. Ожидается: 2 теста PASS.

- [ ] **Шаг 6: Коммит**

```bash
git add src/db.js src/migrate.js src/server.js migrations/001_schema_migrations.sql \
        test/helpers/db.js test/migrate.test.js package.json package-lock.json
git commit -m "feat: пул postgres и версионированные миграции при старте"
```

### Задача 5: Образ, компоуз, место в общем слое, сертификат

**Файлы:**
- Создать: `Dockerfile`, `.dockerignore`, `docker-compose.yml`
- Создать вне репозитория: `ClaudeDocker/projects/my_portal/docker-compose.yml`,
  `ClaudeDocker/nginx/templates/sites/portal.conf.template`
- Изменить вне репозитория: `ClaudeDocker/docker-compose.yml` (переменная домена),
  `ClaudeDocker/.env`, `ClaudeDocker/.env.example`, `ClaudeDocker/README.md`

**Интерфейсы:**
- Потребляет: `src/server.js` из задачи 4.
- Отдаёт дальше: работающий адрес `https://<домен>/healthz`.

- [ ] **Шаг 1: Написать `Dockerfile` и `.dockerignore`**

`Dockerfile`:

```dockerfile
# Образ портала. Многоступенчатая сборка: в готовый образ не попадают ни
# инструменты сборки, ни devDependencies, ни история git — меньше поверхность
# и меньше вес. Запуск не от root: базовая гигиена, которую видно в файле.
# Node 24 «Krypton» — актуальный LTS, поддержка до апреля 2028.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY migrations ./migrations
COPY public ./public
# Рабочий буфер: каталог создаётся заранее и отдаётся пользователю node,
# иначе процесс без прав root не сможет писать в него на этапе 5.
RUN mkdir -p /app/media && chown -R node:node /app/media
USER node
EXPOSE 3004
CMD ["node", "src/server.js"]
```

`.dockerignore`:

```
node_modules
.git
.env
docs
test
media
```

- [ ] **Шаг 2: Написать `docker-compose.yml`**

```yaml
# Портал видеоуроков.
#
# Файл самодостаточен: на чистой машине `docker compose --profile standalone up -d`
# поднимает приложение вместе со своей базой и публикует порт наружу.
#
# На этом VPS профиль standalone не включается: база живёт в общем слое
# (ClaudeDocker), порт наружу не публикуется, вход держит общий nginx.
# Оверлей подключается строкой COMPOSE_FILE в .env — см. .env.example.
services:
  api:
    build: .
    restart: unless-stopped
    env_file: .env
    environment:
      PORT: 3004
    ports:
      - "${APP_PORT:-3004}:3004"

  # Своя база — только для запуска на отдельной машине. На VPS её заменяет
  # общий postgres: держать второй экземпляр на 3.8 ГБ памяти незачем.
  db:
    image: postgres:18-alpine
    profiles: [standalone]
    environment:
      POSTGRES_DB: ${DB_NAME}
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASS}
    volumes:
      - portal_db:/var/lib/postgresql
    restart: unless-stopped

volumes:
  portal_db:
```

- [ ] **Шаг 3: Написать оверлей общего слоя**

`ClaudeDocker/projects/my_portal/docker-compose.yml`:

```yaml
# Портал на этом VPS. Применяется поверх docker-compose.yml проекта:
#   COMPOSE_FILE=docker-compose.yml:/home/boris/projects/ClaudeDocker/projects/my_portal/docker-compose.yml
#
# Порт наружу не публикуется — вход держит общий nginx, который ходит в апстрим
# portal:3004 по сети claude-net. База берётся с сети shared-data, где живёт
# алиас `postgres`. Своя база не поднимается: профиль standalone не включён.
services:
  api:
    ports: !reset []
    networks:
      claude-net:
        # Явный алиас: имя сервиса `api` на общей сети слишком общее и однажды
        # столкнётся с другим проектом.
        aliases: [portal]
      data:

networks:
  claude-net:
    external: true
  data:
    external: true
    name: shared-data
```

- [ ] **Шаг 4: Прописать портал в общем nginx**

`ClaudeDocker/nginx/templates/sites/portal.conf.template`:

```nginx
# Портал видеоуроков. Апстрим `portal` — алиас контейнера api на сети
# claude-net, к которой подключён общий nginx.
server {
    listen 80;
    server_name ${PORTAL_DOMAIN};

    location /.well-known/acme-challenge/ { root /var/www/acme; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    server_name ${PORTAL_DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${PORTAL_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${PORTAL_DOMAIN}/privkey.pem;

    # Исходники уроков заливаются с телефона и весят гигабайты; значение по
    # умолчанию (1 МБ) обрежет загрузку на этапе 5. Ставим сразу.
    client_max_body_size 4g;

    location / {
        proxy_pass http://portal:3004;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

В `ClaudeDocker/docker-compose.yml` добавить в сервис `nginx`:
`- PORTAL_DOMAIN=${PORTAL_DOMAIN}` в `environment` и `PORTAL_DOMAIN` в
`NGINX_ENVSUBST_FILTER`:
`^(DOMAIN|CM_DOMAIN|UQ_DOMAIN|MP_DOMAIN|PORTAL_DOMAIN)$$`.

В `ClaudeDocker/.env.example` добавить `PORTAL_DOMAIN=`, в `.env` — реальный
nip.io-адрес. В `README.md` дописать строку про портал в таблицу проектов.

- [ ] **Шаг 5: Выпустить сертификат и поднять**

```bash
# Сертификат — тем же способом, что и остальные сайты: webroot ACME.
sudo certbot certonly --webroot -w /home/boris/infra/acme -d <домен портала>

cd /home/boris/projects/my_portal && docker compose up -d --build
cd /home/boris/projects/ClaudeDocker && docker compose up -d --force-recreate nginx
```

Новую сеть nginx получает только при создании контейнера — поэтому
`--force-recreate`, а не `restart` (записано в README общего слоя).

- [ ] **Шаг 6: Проверить критерий приёмки**

```bash
curl -s https://<домен портала>/healthz     # {"status":"ok","version":"0.1.0"}
sudo reboot
# после перезагрузки, не трогая ничего руками:
curl -s https://<домен портала>/healthz
```

Ожидается: оба раза JSON со статусом `ok`. Если после перезагрузки пусто —
проверить, что у сервисов `restart: unless-stopped` и что оверлей подключён
(`docker compose config | grep -A3 networks`).

- [ ] **Шаг 7: Коммит (два репозитория)**

```bash
cd /home/boris/projects/my_portal
git add Dockerfile .dockerignore docker-compose.yml
git commit -m "feat: образ и compose портала, база из общего слоя"

cd /home/boris/projects/ClaudeDocker
git add nginx/templates/sites/portal.conf.template projects/my_portal/docker-compose.yml \
        docker-compose.yml .env.example README.md
git commit -m "feat: портал видеоуроков в общем слое — маршрут, оверлей, домен"
```

- [ ] **Шаг 8: Привести спеку в соответствие**

Внести в `docs/superpowers/specs/2026-09-01-portal-design.md` изменения из
раздела «Расхождения со спекой»: общий postgres вместо своего контейнера,
общий redis, общий nginx, отказ от passport, воркер с этапа 5.

```bash
git add docs/superpowers/specs/2026-09-01-portal-design.md
git commit -m "docs: спека приведена к фактической инфраструктуре VPS"
```

---

# Этап 1 — Вход

**Критерий приёмки заказчика:** вошёл через Google, вышел, вошёл через
Telegram — получился **один** аккаунт; гость отзыв отправить не может.

Спека требует шесть способов входа, но на этом этапе делаются два: Google
(обычный OAuth) и виджет Telegram (подпись HMAC). Это две из трёх механик;
VK и Яндекс — те же поля с другими адресами, добавляются позже одной задачей,
мини-приложения — на этапе 10.

### Задача 6: Таблицы пользователей и привязок

**Файлы:**
- Создать: `migrations/002_users.sql`, `test/migrations-users.test.js`

**Интерфейсы:**
- Отдаёт дальше: таблицы `users` (id, display_name, avatar_url, role,
  created_at) и `identities` (id, user_id, provider, external_id, created_at)
  с уникальностью по паре (provider, external_id).

- [ ] **Шаг 1: Написать падающий тест**

`test/migrations-users.test.js`:

```js
// Проверка ограничений базы, на которые опирается вход. Их нельзя проверить
// на заглушке: это работа самого postgres, и именно она не даёт одному
// человеку расползтись на два аккаунта.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

test('одна и та же привязка не заводится дважды', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(
      `INSERT INTO users (display_name) VALUES ('Пётр') RETURNING id`
    );
    const userId = rows[0].id;
    await pool.query(
      `INSERT INTO identities (user_id, provider, external_id) VALUES ($1, 'google', '42')`,
      [userId]
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO identities (user_id, provider, external_id) VALUES ($1, 'google', '42')`,
        [userId]
      ),
      /duplicate key|unique/i
    );
  });
});

test('один человек держит привязки разных провайдеров', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(
      `INSERT INTO users (display_name) VALUES ('Пётр') RETURNING id`
    );
    const userId = rows[0].id;
    await pool.query(
      `INSERT INTO identities (user_id, provider, external_id)
       VALUES ($1, 'google', '42'), ($1, 'tg_widget', '7')`,
      [userId]
    );
    const { rows: found } = await pool.query(
      'SELECT provider FROM identities WHERE user_id = $1 ORDER BY provider',
      [userId]
    );
    assert.deepEqual(
      found.map((r) => r.provider),
      ['google', 'tg_widget']
    );
  });
});

test('неизвестный провайдер не принимается', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(
      `INSERT INTO users (display_name) VALUES ('Пётр') RETURNING id`
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO identities (user_id, provider, external_id) VALUES ($1, 'вконтактик', '1')`,
        [rows[0].id]
      ),
      /check constraint|нарушает/i
    );
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/migrations-users.test.js`
Ожидается: FAIL — `relation "users" does not exist`.

- [ ] **Шаг 3: Написать `migrations/002_users.sql`**

```sql
-- Человек и его способы входа.
--
-- Зачем две таблицы, а не поля google_id/telegram_id в одной: способов входа
-- шесть, и в одной таблице они превратились бы в шесть колонок, из которых
-- пять всегда пустые. Хуже того, один и тот же человек, зашедший с сайта и из
-- мини-приложения, стал бы двумя аккаунтами с разной историей. Разделение
-- обязательно с первого дня — потом сливать аккаунты дороже.
--
-- Читается и пополняется из src/services/identity.js.

CREATE TABLE users (
  id           bigserial PRIMARY KEY,
  display_name text NOT NULL,
  avatar_url   text,
  -- Роль хранится у пользователя, а не вычисляется каждый раз из окружения:
  -- запрос роли идёт в каждом защищённом маршруте. Обновляется при входе.
  role         text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identities (
  id          bigserial PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Список закрыт проверкой: опечатка в имени провайдера иначе тихо заведёт
  -- седьмой способ входа, который никто не обслуживает.
  provider    text NOT NULL CHECK (provider IN
                ('tg_widget', 'tg_miniapp', 'max_miniapp', 'google', 'vk', 'yandex')),
  -- Идентификатор у провайдера. Текст, а не число: у Telegram это int64, у
  -- Google — строка из цифр, у VK — число. Общий знаменатель — текст.
  external_id text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Главное ограничение всей авторизации: один аккаунт провайдера принадлежит
  -- ровно одному человеку на портале.
  UNIQUE (provider, external_id)
);

CREATE INDEX identities_user_id_idx ON identities (user_id);
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Выполнить: `node --test test/migrations-users.test.js`
Ожидается: 3 теста PASS.

- [ ] **Шаг 5: Коммит**

```bash
git add migrations/002_users.sql test/migrations-users.test.js
git commit -m "feat: таблицы пользователей и привязок ко входу"
```

### Задача 7: Токен сессии

**Файлы:**
- Создать: `src/lib/jwt.js`, `test/jwt.test.js`

**Интерфейсы:**
- Отдаёт дальше: `signSession({ userId, role }, secret)` → строка;
  `verifySession(token, secret)` → `{ userId, role }` или `null`;
  `signShortLived(payload, secret, seconds)` и `verifyShortLived(token, secret)`
  — для state в OAuth.

- [ ] **Шаг 1: Написать падающий тест**

`test/jwt.test.js`:

```js
// Проверка токена сессии: свой — читается, чужой и просроченный — нет.
import test from 'node:test';
import assert from 'node:assert/strict';
import { signSession, verifySession, signShortLived, verifyShortLived } from '../src/lib/jwt.js';

const secret = 'x'.repeat(32);

test('свой токен читается обратно', () => {
  const token = signSession({ userId: 5, role: 'admin' }, secret);
  assert.deepEqual(verifySession(token, secret), { userId: 5, role: 'admin' });
});

test('токен, подписанный другим ключом, не принимается', () => {
  const token = signSession({ userId: 5, role: 'admin' }, 'y'.repeat(32));
  assert.equal(verifySession(token, secret), null);
});

test('мусор вместо токена не роняет проверку', () => {
  assert.equal(verifySession('не-токен', secret), null);
  assert.equal(verifySession('', secret), null);
});

test('короткоживущий токен протухает', async () => {
  const token = signShortLived({ nonce: 'abc' }, secret, 0);
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(verifyShortLived(token, secret), null);
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/jwt.test.js`
Ожидается: FAIL — `Cannot find module .../src/lib/jwt.js`.

- [ ] **Шаг 3: Написать `src/lib/jwt.js`**

```js
// Токен сессии. Задача — превратить «этот человек вошёл» в строку, которую
// можно положить в куку сайта и в заголовок мини-приложения, и прочитать
// обратно без похода в базу. Зачем не серверные сессии: клиентов четыре, один
// из них — мини-приложение, где куки ненадёжны, а общего хранилища сессий на
// этом этапе нет вовсе.
// Вызывается из src/routes/auth.js (выпуск) и src/middleware/session.js
// (проверка на каждом запросе).
import jwt from 'jsonwebtoken';

// Месяц. Портал — не банк: выкидывать человека каждую неделю ради безопасности
// профиля с отзывами о видеоуроках вредно. Выход по кнопке гасит куку сразу.
const SESSION_TTL = '30d';

/** Выпускает токен сессии. Вызывается после успешного входа. */
export function signSession({ userId, role }, secret) {
  return jwt.sign({ sub: String(userId), role }, secret, { expiresIn: SESSION_TTL });
}

/**
 * Проверяет токен сессии. Возвращает null на любой неудаче — просроченный,
 * чужой, испорченный. Зачем null вместо исключения: вызывающий код — прослойка
 * на каждом запросе, и различать причины ей нечего.
 */
export function verifySession(token, secret) {
  try {
    const payload = jwt.verify(token, secret);
    return { userId: Number(payload.sub), role: payload.role };
  } catch {
    return null;
  }
}

/**
 * Короткоживущий подписанный пакет для state в OAuth.
 * Зачем: state обязан пережить переход на Google и вернуться неподделанным,
 * но хранить его на сервере не нужно — подписи достаточно.
 * Вызывается из src/routes/auth.js.
 */
export function signShortLived(payload, secret, seconds) {
  return jwt.sign(payload, secret, { expiresIn: seconds });
}

/** Обратная сторона signShortLived. Возвращает null на любой неудаче. */
export function verifyShortLived(token, secret) {
  try {
    const { iat: _iat, exp: _exp, ...payload } = jwt.verify(token, secret);
    return payload;
  } catch {
    return null;
  }
}
```

Добавить зависимость: `npm install jsonwebtoken`.

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Выполнить: `node --test test/jwt.test.js`
Ожидается: 4 теста PASS.

- [ ] **Шаг 5: Коммит**

```bash
git add src/lib/jwt.js test/jwt.test.js package.json package-lock.json
git commit -m "feat: подписанный токен сессии"
```

### Задача 8: Единая процедура входа и привязки

**Файлы:**
- Создать: `src/services/identity.js`, `test/identity.test.js`

**Интерфейсы:**
- Потребляет: таблицы из задачи 6.
- Отдаёт дальше:
  `resolveIdentity(pool, { provider, externalId, displayName, avatarUrl, currentUserId, adminIdentities })`
  → `{ userId, role, created }`. Это единственный вход в систему: все шесть
  способов сходятся сюда.

- [ ] **Шаг 1: Написать падающий тест**

`test/identity.test.js`:

```js
// Проверка трёх правил входа. Именно этот тест закрывает критерий приёмки
// заказчика: вошёл Google, вышел, вошёл Telegram — один аккаунт.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveIdentity } from '../src/services/identity.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const google = { provider: 'google', externalId: '42', displayName: 'Пётр' };
const telegram = { provider: 'tg_widget', externalId: '7', displayName: 'Пётр из телеги' };

test('первый вход заводит человека', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const result = await resolveIdentity(pool, google);
    assert.equal(result.created, true);
    assert.equal(result.role, 'user');
  });
});

test('повторный вход тем же способом — тот же человек', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const first = await resolveIdentity(pool, google);
    const second = await resolveIdentity(pool, google);
    assert.equal(second.created, false);
    assert.equal(second.userId, first.userId);
  });
});

test('вход другим способом при живой сессии привязывается к тому же', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const first = await resolveIdentity(pool, google);
    const second = await resolveIdentity(pool, { ...telegram, currentUserId: first.userId });
    assert.equal(second.userId, first.userId);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
    assert.equal(rows[0].n, 1);
  });
});

test('вход другим способом без сессии заводит второго человека', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await resolveIdentity(pool, google);
    await resolveIdentity(pool, telegram);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
    assert.equal(rows[0].n, 2);
  });
});

test('роль админа выдаётся по списку из окружения', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const admins = [{ provider: 'google', externalId: '42' }];
    const result = await resolveIdentity(pool, { ...google, adminIdentities: admins });
    assert.equal(result.role, 'admin');
  });
});

test('добавление в список админов действует со следующего входа', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const first = await resolveIdentity(pool, google);
    assert.equal(first.role, 'user');
    const second = await resolveIdentity(pool, {
      ...google,
      adminIdentities: [{ provider: 'google', externalId: '42' }]
    });
    assert.equal(second.role, 'admin');
  });
});

test('чужая привязка к своему аккаунту не переезжает', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const owner = await resolveIdentity(pool, telegram);
    const other = await resolveIdentity(pool, google);
    // Второй человек пытается привязать телеграм, уже занятый первым.
    const result = await resolveIdentity(pool, { ...telegram, currentUserId: other.userId });
    assert.equal(result.userId, owner.userId);
    assert.equal(result.conflict, true);
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/identity.test.js`
Ожидается: FAIL — `Cannot find module .../src/services/identity.js`.

- [ ] **Шаг 3: Написать `src/services/identity.js`**

```js
// Единая процедура входа. Задача — свести все способы входа к одному решению:
// это уже известный человек, это новый способ у известного человека, или это
// новый человек. Зачем в одном месте: правило «один человек — один аккаунт»
// иначе пришлось бы повторять в каждом из шести обработчиков входа, и на
// шестом оно бы разошлось.
// Вызывается из src/routes/auth.js всеми способами входа.

/**
 * Находит или заводит пользователя по привязке.
 *
 * Три случая, в порядке проверки:
 *   1. привязка найдена — входим под её пользователем;
 *   2. привязки нет, но человек уже вошёл — привязываем к нему;
 *   3. иначе — заводим нового.
 *
 * Возвращает { userId, role, created, conflict }. conflict — попытка привязать
 * к себе аккаунт провайдера, уже занятый другим человеком: входим под
 * владельцем, а не отнимаем привязку.
 */
export async function resolveIdentity(
  pool,
  { provider, externalId, displayName, avatarUrl = null, currentUserId = null, adminIdentities = [] }
) {
  const isAdmin = adminIdentities.some(
    (admin) => admin.provider === provider && admin.externalId === String(externalId)
  );
  const role = isAdmin ? 'admin' : 'user';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const found = await client.query(
      'SELECT user_id FROM identities WHERE provider = $1 AND external_id = $2',
      [provider, String(externalId)]
    );

    // Случай 1: знакомая привязка.
    if (found.rowCount > 0) {
      const userId = found.rows[0].user_id;
      // Роль пересчитывается при каждом входе: правка списка админов в
      // окружении должна действовать после перезапуска, а не после переустановки
      // базы. Понижение роли работает так же, как повышение.
      await client.query('UPDATE users SET role = $1 WHERE id = $2', [role, userId]);
      await client.query('COMMIT');
      return {
        userId: Number(userId),
        role,
        created: false,
        conflict: currentUserId !== null && Number(currentUserId) !== Number(userId)
      };
    }

    // Случай 2: новый способ входа у уже вошедшего человека.
    if (currentUserId !== null) {
      await client.query(
        'INSERT INTO identities (user_id, provider, external_id) VALUES ($1, $2, $3)',
        [currentUserId, provider, String(externalId)]
      );
      if (isAdmin) await client.query('UPDATE users SET role = $1 WHERE id = $2', [role, currentUserId]);
      const current = await client.query('SELECT role FROM users WHERE id = $1', [currentUserId]);
      await client.query('COMMIT');
      return {
        userId: Number(currentUserId),
        role: current.rows[0].role,
        created: false,
        conflict: false
      };
    }

    // Случай 3: новый человек.
    const created = await client.query(
      'INSERT INTO users (display_name, avatar_url, role) VALUES ($1, $2, $3) RETURNING id',
      [displayName || 'Гость', avatarUrl, role]
    );
    const userId = created.rows[0].id;
    await client.query(
      'INSERT INTO identities (user_id, provider, external_id) VALUES ($1, $2, $3)',
      [userId, provider, String(externalId)]
    );
    await client.query('COMMIT');
    return { userId: Number(userId), role, created: true, conflict: false };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Выполнить: `node --test test/identity.test.js`
Ожидается: 7 тестов PASS.

- [ ] **Шаг 5: Коммит**

```bash
git add src/services/identity.js test/identity.test.js
git commit -m "feat: единая процедура входа — вход, привязка, регистрация"
```

### Задача 9: Проверка подписи Telegram

**Файлы:**
- Создать: `src/lib/telegram-signature.js`, `test/telegram-signature.test.js`

**Интерфейсы:**
- Отдаёт дальше:
  `verifyTelegramWidget(data, botToken, { maxAgeSeconds, nowSeconds })` → `true`
  или `false`. `data` — объект полей виджета, включая `hash`.

- [ ] **Шаг 1: Написать падающий тест**

`test/telegram-signature.test.js`:

```js
// Проверка подписи виджета Telegram. Вход по этому пути — не OAuth: клиент
// присылает данные о себе сам, и единственное, что отличает настоящего
// пользователя от подделки, — правильный HMAC. Ошибка здесь равна дыре во
// всей авторизации, поэтому проверяются и подделка, и протухшая давность.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyTelegramWidget } from '../src/lib/telegram-signature.js';

const botToken = '123456:ABC-DEF';

/** Собирает подписанный набор полей так же, как это делает Telegram. */
function signed(fields) {
  const checkString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');
  const secret = crypto.createHash('sha256').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
  return { ...fields, hash };
}

const nowSeconds = 1_800_000_000;
const fresh = { id: '7', first_name: 'Пётр', auth_date: String(nowSeconds - 10) };

test('настоящая подпись принимается', () => {
  assert.equal(verifyTelegramWidget(signed(fresh), botToken, { nowSeconds }), true);
});

test('подменённое поле ломает подпись', () => {
  const data = signed(fresh);
  data.id = '8';
  assert.equal(verifyTelegramWidget(data, botToken, { nowSeconds }), false);
});

test('подпись чужим токеном не принимается', () => {
  assert.equal(verifyTelegramWidget(signed(fresh), 'другой:токен', { nowSeconds }), false);
});

test('старые данные не принимаются', () => {
  const old = signed({ ...fresh, auth_date: String(nowSeconds - 90_000) });
  assert.equal(verifyTelegramWidget(old, botToken, { nowSeconds }), false);
});

test('без hash не принимается', () => {
  assert.equal(verifyTelegramWidget({ ...fresh }, botToken, { nowSeconds }), false);
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/telegram-signature.test.js`
Ожидается: FAIL — модуль не найден.

- [ ] **Шаг 3: Написать `src/lib/telegram-signature.js`**

```js
// Проверка подписи виджета входа Telegram.
//
// Задача — убедиться, что набор полей о пользователе действительно выдан
// Telegram, а не собран в консоли браузера. Зачем отдельным файлом: это
// единственное место во всей авторизации, где безопасность держится на нашей
// арифметике, а не на чужом протоколе, — оно должно быть маленьким и
// прочитываться целиком.
// Вызывается из src/routes/auth.js при входе через виджет.
import crypto from 'node:crypto';

// Сутки. Данные виджета одноразовые: их перехват и повтор через неделю не
// должен давать вход. Сутки — запас на медленного человека, не на архив.
const DEFAULT_MAX_AGE_SECONDS = 86_400;

/**
 * Проверяет подпись и свежесть данных виджета.
 * Возвращает true/false, а не бросает: вызывающему нужен один бит решения.
 */
export function verifyTelegramWidget(data, botToken, options = {}) {
  const { hash, ...fields } = data;
  if (!hash || !botToken) return false;

  const maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const authDate = Number(fields.auth_date);
  if (!Number.isFinite(authDate) || nowSeconds - authDate > maxAgeSeconds) return false;

  // Порядок полей задан протоколом: ключи по алфавиту, строки "ключ=значение",
  // склейка переводом строки. Любое отклонение даёт другой HMAC.
  const checkString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');

  // Ключ подписи — не сам токен бота, а его SHA-256. Так задумано в протоколе.
  const secret = crypto.createHash('sha256').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secret).update(checkString).digest('hex');

  // Побайтовое сравнение с постоянным временем: обычное === выходит на первом
  // несовпадении и по времени ответа выдаёт, сколько знаков угадано.
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(hash), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Выполнить: `node --test test/telegram-signature.test.js`
Ожидается: 5 тестов PASS.

- [ ] **Шаг 5: Коммит**

```bash
git add src/lib/telegram-signature.js test/telegram-signature.test.js
git commit -m "feat: проверка подписи виджета Telegram"
```

### Задача 10: Google OAuth

**Файлы:**
- Создать: `src/lib/google-oauth.js`, `test/google-oauth.test.js`

**Интерфейсы:**
- Потребляет: `config.google`, `config.publicBaseUrl`.
- Отдаёт дальше: `googleRedirectUri(publicBaseUrl)` → строка;
  `buildConsentUrl({ clientId, redirectUri, state })` → строка;
  `fetchGoogleProfile({ code, clientId, clientSecret, redirectUri }, fetchImpl)`
  → `{ externalId, displayName, avatarUrl }`.

- [ ] **Шаг 1: Написать падающий тест**

`test/google-oauth.test.js`:

```js
// Проверка обмена кода на профиль. Сеть в тесте не трогаем: fetch
// подставляется аргументом — иначе тест зависел бы от Google и от интернета.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  googleRedirectUri,
  buildConsentUrl,
  fetchGoogleProfile
} from '../src/lib/google-oauth.js';

test('адрес возврата собирается из адреса портала', () => {
  assert.equal(
    googleRedirectUri('https://portal.example.nip.io'),
    'https://portal.example.nip.io/api/auth/google/callback'
  );
});

test('ссылка на согласие несёт state и адрес возврата', () => {
  const url = new URL(
    buildConsentUrl({
      clientId: 'cid',
      redirectUri: 'https://portal.example.nip.io/api/auth/google/callback',
      state: 'st'
    })
  );
  assert.equal(url.searchParams.get('client_id'), 'cid');
  assert.equal(url.searchParams.get('state'), 'st');
  assert.equal(url.searchParams.get('response_type'), 'code');
});

test('код меняется на профиль', async () => {
  const calls = [];
  const fetchStub = async (url, options) => {
    calls.push(url);
    if (String(url).includes('token')) {
      return { ok: true, json: async () => ({ access_token: 'AT' }) };
    }
    assert.equal(options.headers.Authorization, 'Bearer AT');
    return {
      ok: true,
      json: async () => ({ id: '42', name: 'Пётр', picture: 'https://пример/аватар.png' })
    };
  };

  const profile = await fetchGoogleProfile(
    { code: 'C', clientId: 'cid', clientSecret: 'sec', redirectUri: 'https://п/cb' },
    fetchStub
  );

  assert.deepEqual(profile, {
    externalId: '42',
    displayName: 'Пётр',
    avatarUrl: 'https://пример/аватар.png'
  });
  assert.equal(calls.length, 2);
});

test('отказ Google превращается в понятную ошибку', async () => {
  const fetchStub = async () => ({ ok: false, status: 400, text: async () => 'invalid_grant' });
  await assert.rejects(
    fetchGoogleProfile(
      { code: 'C', clientId: 'cid', clientSecret: 'sec', redirectUri: 'https://п/cb' },
      fetchStub
    ),
    /Google/
  );
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/google-oauth.test.js`
Ожидается: FAIL — модуль не найден.

- [ ] **Шаг 3: Написать `src/lib/google-oauth.js`**

```js
// Вход через Google. Задача — две операции протокола: собрать ссылку на
// страницу согласия и обменять вернувшийся код на профиль. Зачем без passport:
// протокол здесь укладывается в два запроса, а библиотека тянет за собой
// стратегии, сессии и своё представление о пользователе, которое у нас другое
// (у нас человек и его привязки — разные таблицы).
// Вызывается из src/routes/auth.js.
import { PublicError } from '../middleware/errors.js';

const CONSENT_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PROFILE_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

/**
 * Адрес возврата. Он же прописывается в кабинете Google — при смене адреса
 * портала правится в двух местах: в .env и там. Другого источника адреса нет.
 */
export function googleRedirectUri(publicBaseUrl) {
  return `${publicBaseUrl}/api/auth/google/callback`;
}

/** Ссылка на страницу согласия Google. */
export function buildConsentUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    // Нужны только имя, аватар и идентификатор. Больше не просим: лишние
    // разрешения отпугивают человека на экране согласия.
    scope: 'openid profile email',
    state
  });
  return `${CONSENT_URL}?${params}`;
}

/**
 * Меняет код на профиль. fetchImpl вынесен аргументом, чтобы тест не ходил
 * в сеть; в бою подставляется штатный fetch.
 */
export async function fetchGoogleProfile(
  { code, clientId, clientSecret, redirectUri },
  fetchImpl = fetch
) {
  const tokenRes = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  });
  if (!tokenRes.ok) throw new PublicError('Google не принял код авторизации', 401);
  const { access_token: accessToken } = await tokenRes.json();

  const profileRes = await fetchImpl(PROFILE_URL, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!profileRes.ok) throw new PublicError('Google не отдал профиль', 401);
  const profile = await profileRes.json();

  return {
    externalId: String(profile.id),
    displayName: profile.name ?? 'Пользователь Google',
    avatarUrl: profile.picture ?? null
  };
}
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Выполнить: `node --test test/google-oauth.test.js`
Ожидается: 4 теста PASS.

- [ ] **Шаг 5: Коммит**

```bash
git add src/lib/google-oauth.js test/google-oauth.test.js
git commit -m "feat: вход через Google без сторонних стратегий"
```

### Задача 11: Сессия в запросе, маршруты входа и защиты

**Файлы:**
- Создать: `src/middleware/session.js`, `src/middleware/guards.js`,
  `src/routes/auth.js`, `test/auth-routes.test.js`
- Изменить: `src/app.js` (подключить прослойку и маршруты)

**Интерфейсы:**
- Потребляет: `resolveIdentity`, `signSession`/`verifySession`/`signShortLived`/
  `verifyShortLived`, `verifyTelegramWidget`, `fetchGoogleProfile`.
- Отдаёт дальше: `req.user` — `{ id, role }` или `null` в каждом запросе;
  `requireUser`, `requireAdmin`; маршруты `GET /api/auth/google`,
  `GET /api/auth/google/callback`, `POST /api/auth/telegram`,
  `GET /api/auth/me`, `POST /api/auth/logout`.

- [ ] **Шаг 1: Написать падающий тест**

`test/auth-routes.test.js`:

```js
// Проверка маршрутов входа целиком: кука ставится, /me её читает, выход гасит,
// гость получает 401 на защищённом маршруте.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp, finalize } from '../src/app.js';
import { requireUser } from '../src/middleware/guards.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const botToken = '123456:ABC-DEF';
const config = {
  publicBaseUrl: 'https://portal.example.nip.io',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken, channelId: '' },
  google: { clientId: 'cid', clientSecret: 'sec' }
};

function signedWidget(fields) {
  const checkString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = crypto.createHash('sha256').update(botToken).digest();
  return { ...fields, hash: crypto.createHmac('sha256', secret).update(checkString).digest('hex') };
}

/** Достаёт значение куки сессии из заголовка ответа. */
function sessionCookie(res) {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith('portal_session='));
  return raw ? raw.split(';')[0] : null;
}

test('вход виджетом ставит куку, /me её читает', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const data = signedWidget({
        id: '7',
        first_name: 'Пётр',
        auth_date: String(Math.floor(Date.now() / 1000))
      });
      const login = await fetch(`${base}/api/auth/telegram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      assert.equal(login.status, 200);
      const cookie = sessionCookie(login);
      assert.ok(cookie);

      const me = await fetch(`${base}/api/auth/me`, { headers: { cookie } });
      const body = await me.json();
      assert.equal(body.user.displayName, 'Пётр');
      assert.equal(body.user.role, 'user');
    });
  });
});

test('подделанные данные виджета не пускают', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/auth/telegram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: '7', first_name: 'Пётр', auth_date: '1', hash: 'подделка' })
      });
      assert.equal(res.status, 401);
    });
  });
});

test('гость на защищённом маршруте получает 401', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const app = createApp({ config, pool });
    app.post('/api/тест/защита', requireUser, (req, res) => res.json({ ok: true }));
    finalize(app);
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/тест/защита`, { method: 'POST' });
      assert.equal(res.status, 401);
    });
  });
});

test('токен заголовком работает наравне с кукой', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const data = signedWidget({
        id: '7',
        first_name: 'Пётр',
        auth_date: String(Math.floor(Date.now() / 1000))
      });
      const login = await fetch(`${base}/api/auth/telegram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const { token } = await login.json();
      const me = await fetch(`${base}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.equal((await me.json()).user.displayName, 'Пётр');
    });
  });
});

test('выход гасит куку', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const data = signedWidget({
        id: '7',
        first_name: 'Пётр',
        auth_date: String(Math.floor(Date.now() / 1000))
      });
      const login = await fetch(`${base}/api/auth/telegram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const out = await fetch(`${base}/api/auth/logout`, {
        method: 'POST',
        headers: { cookie: sessionCookie(login) }
      });
      const cleared = out.headers.getSetCookie().find((c) => c.startsWith('portal_session='));
      assert.match(cleared, /portal_session=;|Max-Age=0/);
    });
  });
});

test('гость виден как отсутствующий пользователь', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const me = await fetch(`${base}/api/auth/me`);
      assert.deepEqual(await me.json(), { user: null });
    });
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/auth-routes.test.js`
Ожидается: FAIL — `Cannot find module .../src/middleware/guards.js`.

- [ ] **Шаг 3: Написать `src/middleware/session.js`**

```js
// Разбор сессии в каждом запросе. Задача — положить в req.user того, кто
// пришёл, или null, если это гость. Зачем два способа доставки токена: сайт и
// PWA живут на куке, недоступной скриптам, а мини-приложения Telegram и MAX
// работают внутри чужого webview, где куки то есть, то нет, — им остаётся
// заголовок. Токен при этом один и тот же.
// Вызывается из src/app.js для всех маршрутов.
import { verifySession } from '../lib/jwt.js';

export const SESSION_COOKIE = 'portal_session';

// Месяц — столько же, сколько живёт сам токен. Кука не должна пережить его.
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Разбирает заголовок Cookie в объект.
 * Зачем свой разбор вместо cookie-parser: одна строка кода против ещё одной
 * зависимости в публичном репозитории.
 * Вызывается только из sessionMiddleware.
 */
function parseCookies(header = '') {
  const jar = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    jar[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return jar;
}

/** Настройки куки сессии. Вызывается из src/routes/auth.js. */
export function sessionCookieOptions() {
  return {
    httpOnly: true, // Скрипт на странице не должен читать токен: это защита от XSS.
    secure: true, // Портал живёт только на https, отдавать куку по http незачем.
    sameSite: 'lax', // Строгий режим ломает возврат с экрана согласия Google.
    path: '/',
    maxAge: COOKIE_MAX_AGE_MS
  };
}

/** Прослойка. Возвращает функцию, чтобы получить доступ к секрету из конфига. */
export function sessionMiddleware(config) {
  return (req, res, next) => {
    const header = req.headers.authorization ?? '';
    const fromHeader = header.startsWith('Bearer ') ? header.slice(7) : null;
    const fromCookie = parseCookies(req.headers.cookie)[SESSION_COOKIE] ?? null;

    const payload = verifySession(fromHeader ?? fromCookie ?? '', config.jwtSecret);
    req.user = payload ? { id: payload.userId, role: payload.role } : null;
    next();
  };
}
```

- [ ] **Шаг 4: Написать `src/middleware/guards.js`**

```js
// Защиты маршрутов. Задача — одной строкой в маршруте сказать «сюда только
// вошедшим» или «сюда только автору». Зачем отдельным файлом: проверка прав,
// размазанная по обработчикам, однажды окажется забытой в одном из них.
// Вызывается из src/routes/*.js.
import { PublicError } from './errors.js';

/**
 * Пускает только вошедших. Это и есть выполнение требования спеки «гость
 * отзыв отправить не может»: все маршруты записи закрыты ею.
 */
export function requireUser(req, res, next) {
  if (!req.user) throw new PublicError('Нужно войти', 401);
  next();
}

/** Пускает только администратора. Автор портала один. */
export function requireAdmin(req, res, next) {
  if (!req.user) throw new PublicError('Нужно войти', 401);
  if (req.user.role !== 'admin') throw new PublicError('Недостаточно прав', 403);
  next();
}
```

- [ ] **Шаг 5: Написать `src/routes/auth.js`**

```js
// Маршруты входа. Задача — довести человека от кнопки до куки: проверить, кто
// он, вызвать единую процедуру входа и выдать токен. Зачем здесь так мало
// логики: проверка подписи, обмен кода и правило «один человек — один аккаунт»
// живут в своих модулях, а этот файл — только их склейка и HTTP.
// Подключается в src/app.js по префиксу /api/auth.
import { Router } from 'express';
import { signSession, signShortLived, verifyShortLived } from '../lib/jwt.js';
import { verifyTelegramWidget } from '../lib/telegram-signature.js';
import { googleRedirectUri, buildConsentUrl, fetchGoogleProfile } from '../lib/google-oauth.js';
import { resolveIdentity } from '../services/identity.js';
import { SESSION_COOKIE, sessionCookieOptions } from '../middleware/session.js';
import { PublicError } from '../middleware/errors.js';

// Десять минут на прохождение экрана согласия. Больше не нужно, а долгоживущий
// state — это долгоживущая возможность подсунуть чужой ответ.
const STATE_TTL_SECONDS = 600;

/**
 * Завершает вход: выпускает токен, ставит куку и отдаёт его же телом ответа —
 * телом пользуются мини-приложения, кукой сайт и PWA.
 * Вызывается всеми способами входа этого файла.
 */
function completeLogin(res, { userId, role }, config) {
  const token = signSession({ userId, role }, config.jwtSecret);
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  return token;
}

export function authRoutes(config, pool) {
  const router = Router();

  // Шаг 1 Google: уводим на экран согласия. В state кладём того, кто уже вошёл,
  // — тогда возврат станет привязкой, а не вторым аккаунтом.
  router.get('/google', (req, res) => {
    if (!config.google.clientId) throw new PublicError('Вход через Google не настроен', 503);
    const state = signShortLived(
      { currentUserId: req.user?.id ?? null },
      config.jwtSecret,
      STATE_TTL_SECONDS
    );
    res.redirect(
      buildConsentUrl({
        clientId: config.google.clientId,
        redirectUri: googleRedirectUri(config.publicBaseUrl),
        state
      })
    );
  });

  // Шаг 2 Google: код на профиль, профиль в единую процедуру входа.
  router.get('/google/callback', async (req, res) => {
    const state = verifyShortLived(String(req.query.state ?? ''), config.jwtSecret);
    if (!state) throw new PublicError('Ссылка возврата устарела, попробуйте войти заново', 400);

    const profile = await fetchGoogleProfile({
      code: String(req.query.code ?? ''),
      clientId: config.google.clientId,
      clientSecret: config.google.clientSecret,
      redirectUri: googleRedirectUri(config.publicBaseUrl)
    });

    const result = await resolveIdentity(pool, {
      provider: 'google',
      ...profile,
      currentUserId: state.currentUserId,
      adminIdentities: config.adminIdentities
    });
    completeLogin(res, result, config);
    res.redirect('/');
  });

  // Виджет Telegram: данные приходят от клиента, доверие даёт только подпись.
  router.post('/telegram', async (req, res) => {
    if (!verifyTelegramWidget(req.body ?? {}, config.telegram.botToken)) {
      throw new PublicError('Подпись Telegram не сошлась', 401);
    }
    const data = req.body;
    const result = await resolveIdentity(pool, {
      provider: 'tg_widget',
      externalId: String(data.id),
      displayName: [data.first_name, data.last_name].filter(Boolean).join(' ') || 'Пользователь',
      avatarUrl: data.photo_url ?? null,
      currentUserId: req.user?.id ?? null,
      adminIdentities: config.adminIdentities
    });
    const token = completeLogin(res, result, config);
    res.json({ token, conflict: result.conflict });
  });

  // Кто я. Единственный источник правды для клиента о текущем пользователе.
  router.get('/me', async (req, res) => {
    if (!req.user) {
      res.json({ user: null });
      return;
    }
    const { rows } = await pool.query(
      'SELECT id, display_name, avatar_url, role FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows.length) {
      res.json({ user: null });
      return;
    }
    const { rows: links } = await pool.query(
      'SELECT provider FROM identities WHERE user_id = $1 ORDER BY provider',
      [req.user.id]
    );
    res.json({
      user: {
        id: rows[0].id,
        displayName: rows[0].display_name,
        avatarUrl: rows[0].avatar_url,
        role: rows[0].role,
        providers: links.map((l) => l.provider)
      }
    });
  });

  // Выход. Токен не отзывается на сервере — гасится кука; для портала с
  // отзывами о видеоуроках этого достаточно, список отозванных токенов был бы
  // хранилищем ради одного случая.
  router.post('/logout', (req, res) => {
    res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
    res.json({ ok: true });
  });

  return router;
}
```

- [ ] **Шаг 6: Подключить в `src/app.js`**

Дописать в `createApp` после `express.json`:

```js
import { sessionMiddleware } from './middleware/session.js';
import { authRoutes } from './routes/auth.js';

// ...внутри createApp, до маршрутов:
app.use(sessionMiddleware(config));
app.use('/api/auth', authRoutes(config, pool));
```

- [ ] **Шаг 7: Убедиться, что тесты проходят**

Выполнить: `npm test` (все тесты, не только новые)
Ожидается: все PASS.

- [ ] **Шаг 8: Коммит**

```bash
git add src/middleware/session.js src/middleware/guards.js src/routes/auth.js \
        src/app.js test/auth-routes.test.js
git commit -m "feat: сессия в куке и заголовке, маршруты входа Google и Telegram"
```

### Задача 12: Страница входа и проверка на живом сервере

**Файлы:**
- Создать: `src/views/layout.js`, `src/views/login.js`, `src/lib/html.js`,
  `src/routes/pages.js`, `public/styles.css`, `test/html.test.js`
- Изменить: `src/app.js`, `.env.example`

**Интерфейсы:**
- Отдаёт дальше: `escapeHtml(text)`; `layout({ title, description, body, config })`
  → полная HTML-страница; `GET /login` — страница с кнопкой Google и виджетом
  Telegram.

- [ ] **Шаг 1: Написать падающий тест**

`test/html.test.js`:

```js
// Проверка экранирования. Портал принимает тексты от людей и печатает их в
// HTML — без экранирования это готовая XSS, а комментарии здесь публичные.
import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../src/lib/html.js';
import { layout } from '../src/views/layout.js';

test('опасные символы превращаются в сущности', () => {
  assert.equal(
    escapeHtml('<script>alert("х")</script>'),
    '&lt;script&gt;alert(&quot;х&quot;)&lt;/script&gt;'
  );
});

test('кириллица не портится', () => {
  assert.equal(escapeHtml('Урок про Docker'), 'Урок про Docker');
});

test('заголовок страницы экранируется, а разметка тела — нет', () => {
  const html = layout({
    title: '<опасно>',
    description: 'описание',
    body: '<p>тело</p>',
    config: { publicBaseUrl: 'https://portal.example.nip.io' }
  });
  assert.match(html, /<title>&lt;опасно&gt;<\/title>/);
  assert.match(html, /<p>тело<\/p>/);
  assert.match(html, /<html lang="ru">/);
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/html.test.js`
Ожидается: FAIL — модуль не найден.

- [ ] **Шаг 3: Написать `src/lib/html.js`**

```js
// Сборка HTML вручную. Задача — экранирование текста и ничего больше.
// Зачем без движка шаблонов: страниц у портала пять, логики в них нет по
// требованию спеки, а движок — это ещё одна зависимость и ещё один синтаксис
// в кадре учебного ролика. Цена решения — обязанность звать escapeHtml для
// каждого пользовательского текста; всё, что печатают люди, проходит через неё.
// Вызывается из всех файлов src/views/.

const REPLACEMENTS = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Превращает текст в безопасный для вставки в HTML. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => REPLACEMENTS[ch]);
}
```

- [ ] **Шаг 4: Написать `src/views/layout.js` и `src/views/login.js`**

`src/views/layout.js`:

```js
// Обвязка любой страницы портала: голова документа, теги для превью ссылок,
// подключение стилей и клиента. Задача — держать всё это в одном месте: теги
// Open Graph нужны на каждой странице, ради них серверный рендер и существует.
// Вызывается из всех остальных файлов src/views/.
import { escapeHtml } from '../lib/html.js';

export function layout({ title, description, body, config, image = null, user = null }) {
  const url = config.publicBaseUrl;
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ''}
<link rel="manifest" href="${escapeHtml(url)}/manifest.webmanifest">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<header class="шапка">
  <a href="/" class="лого">Портал видеоуроков</a>
  <nav>
    <a href="/идеи">Идеи</a>
    ${user ? `<span class="имя">${escapeHtml(user.displayName)}</span>` : '<a href="/login">Войти</a>'}
  </nav>
</header>
<main>${body}</main>
<script src="/app.js" type="module"></script>
</body>
</html>`;
}
```

`src/views/login.js`:

```js
// Страница входа. Задача — показать два пути входа и объяснить человеку, что
// оба ведут в один аккаунт: без этой строки повторный вход другим способом
// выглядит как потеря истории.
// Вызывается из src/routes/pages.js по маршруту /login.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';

export function loginPage({ config, botUsername }) {
  const widget = botUsername
    ? `<script async src="https://telegram.org/js/telegram-widget.js?22"
         data-telegram-login="${escapeHtml(botUsername)}"
         data-size="large"
         data-onauth="войтиЧерезTelegram(user)"
         data-request-access="write"></script>`
    : '<p class="подсказка">Вход через Telegram пока не настроен.</p>';

  return layout({
    config,
    title: 'Вход — Портал видеоуроков',
    description: 'Войдите, чтобы оставлять отзывы, голосовать за идеи и получать уведомления.',
    body: `
<h1>Вход</h1>
<p>Любой способ ведёт в один и тот же аккаунт: войдите вторым — он привяжется к первому.</p>
<p><a class="кнопка" href="/api/auth/google">Войти через Google</a></p>
${widget}
`
  });
}
```

- [ ] **Шаг 5: Написать `src/routes/pages.js` и подключить**

```js
// Серверные страницы. Задача — отдать поисковику и мессенджеру готовый HTML с
// тегами превью; вся живая логика идёт отдельно, через JSON API.
// Подключается в src/app.js последним из маршрутов.
import { Router } from 'express';
import { loginPage } from '../views/login.js';

export function pageRoutes(config, pool) {
  const router = Router();

  router.get('/login', (req, res) => {
    res.type('html').send(loginPage({ config, botUsername: config.telegram.botUsername }));
  });

  return router;
}
```

В `src/app.js` добавить отдачу статики и страницы:

```js
import express from 'express';
import { pageRoutes } from './routes/pages.js';

// ...внутри createApp, после маршрутов API:
app.use(express.static(new URL('../public', import.meta.url).pathname, { maxAge: '1h' }));
app.use('/', pageRoutes(config, pool));
```

В `src/config.js` добавить в блок `telegram`:
`botUsername: env.TELEGRAM_BOT_USERNAME ?? ''`.

В `.env.example` дописать:

```bash
# Имя бота без @. Нужно виджету входа на сайте: он адресуется по имени, а не
# по токену. Токен того же бота лежит в TELEGRAM_BOT_TOKEN.
TELEGRAM_BOT_USERNAME=
```

`public/app.js` — клиент портала. Пока в нём только вход; реакции, отзывы,
подписка на пуши и голоса за идеи дописываются в задачах 17, 19 и 24:

```js
/* Клиент портала: ванильный JS, без сборки.
 *
 * Задача — оживить серверные страницы: отправить данные виджета, реакцию,
 * отзыв, голос. Зачем без фреймворка: логики здесь на десяток обработчиков,
 * а сборка ради них добавила бы в публичный репозиторий шаг, который зрителю
 * пришлось бы объяснять раньше самого предмета урока.
 * Подключается из src/views/layout.js на каждой странице.
 */

/**
 * Запрос к своему API с общей обработкой отказов.
 * Зачем: «войдите» на 401 нужно во всех обработчиках без исключения, и
 * повторять его в каждом — верный способ где-нибудь забыть.
 * Вызывается всеми обработчиками этого файла.
 */
export async function запрос(адрес, options = {}) {
  const res = await fetch(адрес, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) }
  });
  if (res.status === 401) {
    location.href = '/login';
    return null;
  }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Ошибка');
  return res.json();
}

// Виджет Telegram зовёт эту функцию по имени из атрибута data-onauth, поэтому
// она обязана лежать в window, а не в области видимости модуля.
window.войтиЧерезTelegram = async (user) => {
  await запрос('/api/auth/telegram', { method: 'POST', body: JSON.stringify(user) });
  location.reload();
};

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
```

`public/styles.css` — оформление на усмотрение; на этом шаге достаточно
основы, дальше правится свободно:

```css
/* Оформление портала. Тёмный текст на светлом, одна колонка, крупные цели
   нажатия: основной клиент — телефон. */
:root { --поле: 16px; --скругление: 12px; }
* { box-sizing: border-box; }
body { margin: 0; font: 16px/1.5 system-ui, sans-serif; color: #1a1a1a; background: #fff; }
main { max-width: 46rem; margin: 0 auto; padding: var(--поле); }
.шапка { display: flex; justify-content: space-between; align-items: center;
         padding: var(--поле); border-bottom: 1px solid #eee; }
.лого { font-weight: 700; text-decoration: none; color: inherit; }
.карточка { padding: var(--поле) 0; border-bottom: 1px solid #eee; }
.карточка img { border-radius: var(--скругление); }
.мета { color: #666; font-size: 0.9em; }
.кнопка { display: inline-block; padding: 10px 16px; border-radius: var(--скругление);
          background: #1a1a1a; color: #fff; text-decoration: none; border: 0; cursor: pointer; }
/* Цель нажатия не меньше 44 пикселей — иначе на телефоне промахиваются. */
button { min-height: 44px; }
.реакции button { font-size: 1.1em; background: #f4f4f4; border: 0;
                  border-radius: var(--скругление); padding: 8px 14px; cursor: pointer; }
.реакции .отдана { background: #1a1a1a; color: #fff; }
.комментарий.ждёт { opacity: 0.6; }
.борд { list-style: none; padding: 0; }
.идея { display: flex; gap: var(--поле); padding: var(--поле) 0; border-bottom: 1px solid #eee; }
.голос.отдан { background: #1a1a1a; color: #fff; }
```

- [ ] **Шаг 6: Убедиться, что тесты проходят**

Выполнить: `npm test && npm run lint`
Ожидается: всё зелёное.

- [ ] **Шаг 7: Проверить критерий приёмки на живом сервере**

Настроить в кабинете Google адрес возврата
`https://<домен>/api/auth/google/callback`, у бота через `@BotFather` —
`/setdomain` на домен портала. Заполнить `.env`, поднять: `docker compose up -d --build`.

Проверка ровно по формулировке заказчика:

1. Войти через Google → `/api/auth/me` показывает пользователя.
2. Выйти (`POST /api/auth/logout`).
3. Войти через виджет Telegram → появился **второй** аккаунт (так и должно
   быть: связывать некого, сессии не было).
4. Не выходя, нажать «Войти через Google» → аккаунты **склеились**, в
   `providers` два способа, пользователей в базе по-прежнему двое, но текущий —
   один и тот же:
   ```bash
   docker exec shared-postgres-1 psql -U portal -d portal \
     -c "SELECT u.id, u.display_name, array_agg(i.provider) FROM users u
         JOIN identities i ON i.user_id = u.id GROUP BY u.id;"
   ```
5. Из инкогнито `POST /api/auth/logout` не нужен: любой защищённый маршрут
   отвечает 401 — гость писать не может.

- [ ] **Шаг 8: Коммит**

```bash
git add src/views src/lib/html.js src/routes/pages.js src/app.js src/config.js \
        public/styles.css public/app.js test/html.test.js .env.example
git commit -m "feat: страница входа с Google и виджетом Telegram"
```

---

# Этап 2 — Витрина

**Критерий приёмки заказчика:** урок виден из инкогнито; реакция засчитана;
неодобренный комментарий гостю не виден.

### Задача 13: Таблицы контента

**Файлы:**
- Создать: `migrations/003_content.sql`, `test/migrations-content.test.js`

**Интерфейсы:**
- Отдаёт дальше: `lessons` (id, slug, title, description, cover_url, status,
  published_at, duration_seconds, created_at), `news` (id, slug, title, body,
  published_at), `tags` (id, slug, title), `lesson_tags` (lesson_id, tag_id),
  `publications` (id, lesson_id, platform, external_id, url, state, mode,
  error, updated_at).

- [ ] **Шаг 1: Написать падающий тест**

`test/migrations-content.test.js`:

```js
// Проверка ограничений витрины: slug уникален (по нему строится адрес),
// черновик не может притвориться опубликованным без даты, один урок не
// публикуется дважды на одну площадку.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

test('slug урока уникален', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await pool.query(`INSERT INTO lessons (slug, title) VALUES ('docker-1', 'Docker, часть 1')`);
    await assert.rejects(
      pool.query(`INSERT INTO lessons (slug, title) VALUES ('docker-1', 'Другой')`),
      /duplicate key|unique/i
    );
  });
});

test('опубликованный урок обязан иметь дату выхода', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await assert.rejects(
      pool.query(
        `INSERT INTO lessons (slug, title, status) VALUES ('docker-2', 'Docker 2', 'published')`
      ),
      /check constraint|нарушает/i
    );
  });
});

test('одна площадка на урок — одна строка публикации', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(
      `INSERT INTO lessons (slug, title) VALUES ('docker-3', 'Docker 3') RETURNING id`
    );
    await pool.query(`INSERT INTO publications (lesson_id, platform) VALUES ($1, 'youtube')`, [
      rows[0].id
    ]);
    await assert.rejects(
      pool.query(`INSERT INTO publications (lesson_id, platform) VALUES ($1, 'youtube')`, [
        rows[0].id
      ]),
      /duplicate key|unique/i
    );
  });
});

test('удаление урока уносит его теги и публикации', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(
      `INSERT INTO lessons (slug, title) VALUES ('docker-4', 'Docker 4') RETURNING id`
    );
    await pool.query(`INSERT INTO publications (lesson_id, platform) VALUES ($1, 'vk')`, [
      rows[0].id
    ]);
    await pool.query('DELETE FROM lessons WHERE id = $1', [rows[0].id]);
    const left = await pool.query('SELECT count(*)::int AS n FROM publications');
    assert.equal(left.rows[0].n, 0);
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/migrations-content.test.js`
Ожидается: FAIL — `relation "lessons" does not exist`.

- [ ] **Шаг 3: Написать `migrations/003_content.sql`**

```sql
-- Содержимое витрины: уроки, новости, теги и следы публикаций на площадках.
--
-- Чего здесь намеренно нет — самого видео. Портал видео не раздаёт: зритель
-- смотрит через плеер площадки, а у нас живёт карточка и ссылки на неё.
-- Читается из src/services/lessons.js.

CREATE TABLE lessons (
  id               bigserial PRIMARY KEY,
  -- Часть адреса урока. Уникален, потому что адрес не может вести в два места.
  slug             text NOT NULL UNIQUE,
  title            text NOT NULL,
  description      text NOT NULL DEFAULT '',
  cover_url        text,
  status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'processing', 'review', 'published')),
  published_at     timestamptz,
  duration_seconds integer,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- Опубликованное без даты выхода сломало бы сортировку ленты и превью в
  -- мессенджерах. Проверка не даёт завести такую строку вообще.
  CONSTRAINT published_has_date CHECK (status <> 'published' OR published_at IS NOT NULL)
);

CREATE INDEX lessons_published_idx ON lessons (published_at DESC) WHERE status = 'published';

CREATE TABLE news (
  id           bigserial PRIMARY KEY,
  slug         text NOT NULL UNIQUE,
  title        text NOT NULL,
  body         text NOT NULL DEFAULT '',
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tags (
  id    bigserial PRIMARY KEY,
  slug  text NOT NULL UNIQUE,
  title text NOT NULL
);

CREATE TABLE lesson_tags (
  lesson_id bigint NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  tag_id    bigint NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (lesson_id, tag_id)
);

CREATE TABLE publications (
  id          bigserial PRIMARY KEY,
  lesson_id   bigint NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  platform    text NOT NULL CHECK (platform IN
                ('youtube', 'vk', 'telegram', 'rutube', 'tiktok', 'instagram', 'dzen', 'max')),
  -- Идентификатор ролика у площадки: по нему собираются метрики на этапе 9.
  external_id text,
  url         text,
  state       text NOT NULL DEFAULT 'planned'
                CHECK (state IN ('planned', 'queued', 'uploading', 'published', 'failed')),
  -- Режим зрелости адаптера: сам публикует, готовит черновик или отдаёт архив.
  mode        text NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'semi', 'manual')),
  -- Текст последней ошибки. Хранится, а не только логируется: упавшая
  -- публикация должна быть видна в кабинете красным, а не найдена в логах.
  error       text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lesson_id, platform)
);
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Выполнить: `node --test test/migrations-content.test.js`
Ожидается: 4 теста PASS.

- [ ] **Шаг 5: Коммит**

```bash
git add migrations/003_content.sql test/migrations-content.test.js
git commit -m "feat: таблицы уроков, новостей, тегов и публикаций"
```

### Задача 14: Сервис витрины

**Файлы:**
- Создать: `src/services/lessons.js`, `test/lessons-service.test.js`

**Интерфейсы:**
- Потребляет: таблицы из задачи 13.
- Отдаёт дальше: `listLessons(pool, { tag, limit, offset, includeDrafts })` →
  массив `{ id, slug, title, description, coverUrl, publishedAt, durationSeconds, tags }`;
  `getLessonBySlug(pool, slug, { includeDrafts })` → тот же объект плюс
  `publications: [{ platform, url, state }]`, либо `null`;
  `listNews(pool, { limit })`; `saveLesson(pool, lesson)` → сохранённый урок;
  `setLessonTags(pool, lessonId, tagSlugs)`.

- [ ] **Шаг 1: Написать падающий тест**

`test/lessons-service.test.js`:

```js
// Проверка витрины. Главное здесь — черновик не виден никому, кроме автора:
// это и есть требование «наружу ничего не уходит, пока он не нажал».
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listLessons,
  getLessonBySlug,
  saveLesson,
  setLessonTags
} from '../src/services/lessons.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

async function seed(pool) {
  await saveLesson(pool, {
    slug: 'docker-1',
    title: 'Docker, часть 1',
    description: 'Контейнеры с нуля',
    status: 'published',
    publishedAt: new Date('2026-08-01T10:00:00Z')
  });
  await saveLesson(pool, { slug: 'черновик', title: 'Ещё не готов', status: 'draft' });
}

test('в ленту попадают только опубликованные', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    const list = await listLessons(pool, {});
    assert.deepEqual(
      list.map((l) => l.slug),
      ['docker-1']
    );
  });
});

test('автор видит черновики отдельным флагом', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    const list = await listLessons(pool, { includeDrafts: true });
    assert.equal(list.length, 2);
  });
});

test('черновик не отдаётся по прямой ссылке', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    assert.equal(await getLessonBySlug(pool, 'черновик', {}), null);
    assert.ok(await getLessonBySlug(pool, 'черновик', { includeDrafts: true }));
  });
});

test('карточка несёт ссылки на площадки', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    const { rows } = await pool.query(`SELECT id FROM lessons WHERE slug = 'docker-1'`);
    await pool.query(
      `INSERT INTO publications (lesson_id, platform, url, state)
       VALUES ($1, 'youtube', 'https://youtu.be/x', 'published')`,
      [rows[0].id]
    );
    const lesson = await getLessonBySlug(pool, 'docker-1', {});
    assert.deepEqual(lesson.publications, [
      { platform: 'youtube', url: 'https://youtu.be/x', state: 'published' }
    ]);
  });
});

test('фильтр по тегу отбирает уроки', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    const { rows } = await pool.query(`SELECT id FROM lessons WHERE slug = 'docker-1'`);
    await setLessonTags(pool, rows[0].id, ['docker']);
    assert.equal((await listLessons(pool, { tag: 'docker' })).length, 1);
    assert.equal((await listLessons(pool, { tag: 'kubernetes' })).length, 0);
  });
});

test('повторное сохранение того же slug обновляет, а не двоит', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    await saveLesson(pool, { slug: 'docker-1', title: 'Docker, часть 1 (обновлён)' });
    const lesson = await getLessonBySlug(pool, 'docker-1', {});
    assert.equal(lesson.title, 'Docker, часть 1 (обновлён)');
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM lessons');
    assert.equal(rows[0].n, 2);
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/lessons-service.test.js`
Ожидается: FAIL — модуль не найден.

- [ ] **Шаг 3: Написать `src/services/lessons.js`**

```js
// Витрина: чтение и правка уроков и новостей.
//
// Задача — быть единственным местом, которое знает SQL про контент. Зачем:
// правило «черновик наружу не показываем» должно жить в одном условии, а не
// повторяться в каждом маршруте и каждом шаблоне — там его однажды забудут.
// Вызывается из src/routes/lessons.js и src/routes/pages.js.

// Сколько уроков отдаём за раз. Лента бесконечной не бывает, а без предела
// первый же год работы портала превратит главную в мегабайт HTML.
const DEFAULT_LIMIT = 20;

/** Приводит строку базы к виду, в котором её ждут шаблоны и API. */
function toLesson(row) {
  return {
    id: Number(row.id),
    slug: row.slug,
    title: row.title,
    description: row.description,
    coverUrl: row.cover_url,
    status: row.status,
    publishedAt: row.published_at,
    durationSeconds: row.duration_seconds,
    tags: row.tags ?? []
  };
}

/** Лента уроков. includeDrafts включается только для админа. */
export async function listLessons(pool, { tag = null, limit = DEFAULT_LIMIT, offset = 0, includeDrafts = false }) {
  const { rows } = await pool.query(
    `SELECT l.*, COALESCE(array_agg(t.slug) FILTER (WHERE t.slug IS NOT NULL), '{}') AS tags
       FROM lessons l
       LEFT JOIN lesson_tags lt ON lt.lesson_id = l.id
       LEFT JOIN tags t ON t.id = lt.tag_id
      WHERE ($1::boolean OR l.status = 'published')
        AND ($2::text IS NULL OR EXISTS (
              SELECT 1 FROM lesson_tags lt2
                JOIN tags t2 ON t2.id = lt2.tag_id
               WHERE lt2.lesson_id = l.id AND t2.slug = $2))
      GROUP BY l.id
      ORDER BY COALESCE(l.published_at, l.created_at) DESC
      LIMIT $3 OFFSET $4`,
    [includeDrafts, tag, limit, offset]
  );
  return rows.map(toLesson);
}

/** Карточка урока вместе со ссылками на площадки. null, если показывать нечего. */
export async function getLessonBySlug(pool, slug, { includeDrafts = false }) {
  const { rows } = await pool.query(
    `SELECT l.*, COALESCE(array_agg(t.slug) FILTER (WHERE t.slug IS NOT NULL), '{}') AS tags
       FROM lessons l
       LEFT JOIN lesson_tags lt ON lt.lesson_id = l.id
       LEFT JOIN tags t ON t.id = lt.tag_id
      WHERE l.slug = $1 AND ($2::boolean OR l.status = 'published')
      GROUP BY l.id`,
    [slug, includeDrafts]
  );
  if (!rows.length) return null;

  const lesson = toLesson(rows[0]);
  const { rows: pubs } = await pool.query(
    `SELECT platform, url, state FROM publications WHERE lesson_id = $1 ORDER BY platform`,
    [lesson.id]
  );
  lesson.publications = pubs;
  return lesson;
}

/**
 * Заводит или обновляет урок по slug.
 * Зачем один метод на оба случая: карточка урока правится многократно — при
 * загрузке, после расшифровки, после проверки автором, — и раздельные
 * create/update означали бы «сначала выясни, есть ли он уже» в каждом месте.
 */
export async function saveLesson(pool, lesson) {
  const { rows } = await pool.query(
    `INSERT INTO lessons (slug, title, description, cover_url, status, published_at, duration_seconds)
     VALUES ($1, $2, COALESCE($3, ''), $4, COALESCE($5, 'draft'), $6, $7)
     ON CONFLICT (slug) DO UPDATE SET
       title = EXCLUDED.title,
       description = COALESCE(EXCLUDED.description, lessons.description),
       cover_url = COALESCE(EXCLUDED.cover_url, lessons.cover_url),
       status = COALESCE(EXCLUDED.status, lessons.status),
       published_at = COALESCE(EXCLUDED.published_at, lessons.published_at),
       duration_seconds = COALESCE(EXCLUDED.duration_seconds, lessons.duration_seconds)
     RETURNING *`,
    [
      lesson.slug,
      lesson.title,
      lesson.description ?? null,
      lesson.coverUrl ?? null,
      lesson.status ?? null,
      lesson.publishedAt ?? null,
      lesson.durationSeconds ?? null
    ]
  );
  return toLesson(rows[0]);
}

/** Заменяет набор тегов урока целиком. Незнакомые теги заводятся на лету. */
export async function setLessonTags(pool, lessonId, tagSlugs) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM lesson_tags WHERE lesson_id = $1', [lessonId]);
    for (const slug of tagSlugs) {
      const { rows } = await client.query(
        `INSERT INTO tags (slug, title) VALUES ($1, $1)
         ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
         RETURNING id`,
        [slug]
      );
      await client.query('INSERT INTO lesson_tags (lesson_id, tag_id) VALUES ($1, $2)', [
        lessonId,
        rows[0].id
      ]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Лента новостей. Новость публикуется сразу: черновиков у неё нет. */
export async function listNews(pool, { limit = DEFAULT_LIMIT } = {}) {
  const { rows } = await pool.query(
    'SELECT id, slug, title, body, published_at FROM news ORDER BY published_at DESC LIMIT $1',
    [limit]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    slug: r.slug,
    title: r.title,
    body: r.body,
    publishedAt: r.published_at
  }));
}
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Выполнить: `node --test test/lessons-service.test.js`
Ожидается: 6 тестов PASS.

- [ ] **Шаг 5: Коммит**

```bash
git add src/services/lessons.js test/lessons-service.test.js
git commit -m "feat: сервис витрины — уроки, новости, теги"
```

### Задача 15: Таблицы и сервис обратной связи

**Файлы:**
- Создать: `migrations/004_feedback.sql`, `src/services/feedback.js`,
  `test/feedback-service.test.js`

**Интерфейсы:**
- Потребляет: `users`, `lessons`.
- Отдаёт дальше: `setReaction(pool, { userId, objectType, objectId, kind })`;
  `removeReaction(pool, { userId, objectType, objectId })`;
  `countReactions(pool, { objectType, objectId })` → `{ [kind]: n }`;
  `getViewerReaction(pool, { objectType, objectId, userId })` → вид реакции
  этого человека или `null`;
  `addComment(pool, { userId, objectType, objectId, parentId, body })` →
  комментарий со статусом `pending`;
  `listComments(pool, { objectType, objectId, viewerId, isAdmin })`;
  `moderateComment(pool, { commentId, status })`.

- [ ] **Шаг 1: Написать падающий тест**

`test/feedback-service.test.js`:

```js
// Проверка обратной связи. Два правила заказчика проверяются именно здесь:
// реакция засчитывается один раз, неодобренный комментарий гостю не виден.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  setReaction,
  removeReaction,
  countReactions,
  getViewerReaction,
  addComment,
  listComments,
  moderateComment
} from '../src/services/feedback.js';
import { saveLesson } from '../src/services/lessons.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

async function seed(pool) {
  const lesson = await saveLesson(pool, { slug: 'docker-1', title: 'Docker' });
  const { rows } = await pool.query(
    `INSERT INTO users (display_name) VALUES ('Пётр'), ('Анна') RETURNING id`
  );
  return { lessonId: lesson.id, petr: rows[0].id, anna: rows[1].id };
}

test('реакция одного человека засчитывается один раз', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, petr } = await seed(pool);
    const where = { objectType: 'lesson', objectId: lessonId };
    await setReaction(pool, { ...where, userId: petr, kind: 'like' });
    await setReaction(pool, { ...where, userId: petr, kind: 'like' });
    assert.deepEqual(await countReactions(pool, where), { like: 1 });
  });
});

test('смена реакции заменяет прежнюю, а не добавляет', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, petr } = await seed(pool);
    const where = { objectType: 'lesson', objectId: lessonId };
    await setReaction(pool, { ...where, userId: petr, kind: 'like' });
    await setReaction(pool, { ...where, userId: petr, kind: 'fire' });
    assert.deepEqual(await countReactions(pool, where), { fire: 1 });
  });
});

test('видно, какую реакцию поставил этот человек', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, petr, anna } = await seed(pool);
    const where = { objectType: 'lesson', objectId: lessonId };
    await setReaction(pool, { ...where, userId: petr, kind: 'fire' });
    assert.equal(await getViewerReaction(pool, { ...where, userId: petr }), 'fire');
    assert.equal(await getViewerReaction(pool, { ...where, userId: anna }), null);
    assert.equal(await getViewerReaction(pool, { ...where, userId: null }), null);
  });
});

test('реакцию можно снять', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, petr } = await seed(pool);
    const where = { objectType: 'lesson', objectId: lessonId };
    await setReaction(pool, { ...where, userId: petr, kind: 'like' });
    await removeReaction(pool, { ...where, userId: petr });
    assert.deepEqual(await countReactions(pool, where), {});
  });
});

test('новый комментарий ждёт модерации и гостю не виден', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, petr } = await seed(pool);
    const where = { objectType: 'lesson', objectId: lessonId };
    const comment = await addComment(pool, { ...where, userId: petr, body: 'Спасибо!' });
    assert.equal(comment.status, 'pending');
    assert.deepEqual(await listComments(pool, { ...where, viewerId: null, isAdmin: false }), []);
  });
});

test('автор комментария видит свой до одобрения', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, petr, anna } = await seed(pool);
    const where = { objectType: 'lesson', objectId: lessonId };
    await addComment(pool, { ...where, userId: petr, body: 'Спасибо!' });
    assert.equal((await listComments(pool, { ...where, viewerId: petr })).length, 1);
    assert.equal((await listComments(pool, { ...where, viewerId: anna })).length, 0);
  });
});

test('одобренный комментарий виден всем', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, petr } = await seed(pool);
    const where = { objectType: 'lesson', objectId: lessonId };
    const comment = await addComment(pool, { ...where, userId: petr, body: 'Спасибо!' });
    await moderateComment(pool, { commentId: comment.id, status: 'approved' });
    assert.equal((await listComments(pool, { ...where, viewerId: null })).length, 1);
  });
});

test('пустой комментарий не принимается', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, petr } = await seed(pool);
    await assert.rejects(
      addComment(pool, { objectType: 'lesson', objectId: lessonId, userId: petr, body: '   ' }),
      /пуст/i
    );
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/feedback-service.test.js`
Ожидается: FAIL — модуль не найден.

- [ ] **Шаг 3: Написать `migrations/004_feedback.sql`**

```sql
-- Обратная связь портала: реакции и комментарии.
--
-- Тип объекта хранится строкой рядом с идентификатором, а не отдельной
-- таблицей на каждый вид: реагировать и комментировать можно урок, новость и
-- саму идею, и заводить под это три пары таблиц значит трижды писать одно и
-- то же. Плата — отсутствие внешнего ключа на объект; чистку осиротевших строк
-- делает удаление урока в src/services/lessons.js.
-- Читается из src/services/feedback.js.

CREATE TABLE reactions (
  id          bigserial PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_type text NOT NULL CHECK (object_type IN ('lesson', 'news', 'idea')),
  object_id   bigint NOT NULL,
  kind        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Одна реакция на пару «человек — объект»: смена реакции заменяет прежнюю.
  -- Без этого счётчик накручивается двойным нажатием.
  UNIQUE (user_id, object_type, object_id)
);

CREATE INDEX reactions_object_idx ON reactions (object_type, object_id);

CREATE TABLE comments (
  id          bigserial PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_type text NOT NULL CHECK (object_type IN ('lesson', 'news', 'idea')),
  object_id   bigint NOT NULL,
  -- Ветки: ответ ссылается на родителя. Удаление родителя уносит ветку.
  parent_id   bigint REFERENCES comments(id) ON DELETE CASCADE,
  body        text NOT NULL,
  -- Премодерация: новое приходит скрытым. Так решено в спеке — портал
  -- публичный, а автор один и не может сидеть в комментариях круглые сутки.
  status      text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX comments_object_idx ON comments (object_type, object_id, created_at);
```

- [ ] **Шаг 4: Написать `src/services/feedback.js`**

```js
// Реакции и комментарии.
//
// Задача — правила обратной связи в одном месте: одна реакция на человека,
// комментарий приходит скрытым, скрытое видит только автор и админ. Зачем
// сервисом, а не в маршрутах: те же правила понадобятся борду идей на этапе 4
// и сводной ленте отзывов на этапе 9.
// Вызывается из src/routes/feedback.js и src/routes/pages.js.
import { PublicError } from '../middleware/errors.js';

// Длина комментария. Верхняя граница защищает страницу от простыни на экран,
// нижняя отсекает пустые нажатия.
const MAX_COMMENT_LENGTH = 4000;

/** Ставит или меняет реакцию. Повтор той же реакции ничего не меняет. */
export async function setReaction(pool, { userId, objectType, objectId, kind }) {
  await pool.query(
    `INSERT INTO reactions (user_id, object_type, object_id, kind)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, object_type, object_id) DO UPDATE SET kind = EXCLUDED.kind`,
    [userId, objectType, objectId, kind]
  );
}

/** Снимает реакцию. Повторный вызов безвреден. */
export async function removeReaction(pool, { userId, objectType, objectId }) {
  await pool.query(
    'DELETE FROM reactions WHERE user_id = $1 AND object_type = $2 AND object_id = $3',
    [userId, objectType, objectId]
  );
}

/** Счётчики по видам реакций. Пустой объект, если реакций нет. */
export async function countReactions(pool, { objectType, objectId }) {
  const { rows } = await pool.query(
    `SELECT kind, count(*)::int AS n FROM reactions
      WHERE object_type = $1 AND object_id = $2 GROUP BY kind`,
    [objectType, objectId]
  );
  return Object.fromEntries(rows.map((r) => [r.kind, r.n]));
}

/**
 * Какую реакцию поставил этот человек. null — никакой.
 * Зачем отдельно от счётчиков: кнопка должна показывать, что она уже нажата,
 * иначе человек жмёт её второй раз и не понимает, почему счётчик не растёт.
 * Вызывается из src/routes/pages.js при отрисовке карточки урока.
 */
export async function getViewerReaction(pool, { objectType, objectId, userId }) {
  if (!userId) return null;
  const { rows } = await pool.query(
    'SELECT kind FROM reactions WHERE user_id = $1 AND object_type = $2 AND object_id = $3',
    [userId, objectType, objectId]
  );
  return rows.length ? rows[0].kind : null;
}

/** Принимает комментарий. Он появляется скрытым и ждёт модерации. */
export async function addComment(pool, { userId, objectType, objectId, parentId = null, body }) {
  const text = String(body ?? '').trim();
  if (!text) throw new PublicError('Комментарий пуст');
  if (text.length > MAX_COMMENT_LENGTH) throw new PublicError('Комментарий слишком длинный');

  const { rows } = await pool.query(
    `INSERT INTO comments (user_id, object_type, object_id, parent_id, body)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, user_id, parent_id, body, status, created_at`,
    [userId, objectType, objectId, parentId, text]
  );
  const row = rows[0];
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    parentId: row.parent_id ? Number(row.parent_id) : null,
    body: row.body,
    status: row.status,
    createdAt: row.created_at
  };
}

/**
 * Комментарии объекта. Гость и посторонний видят только одобренные, автор —
 * ещё и свои ожидающие, админ — все: иначе ему нечего модерировать.
 */
export async function listComments(pool, { objectType, objectId, viewerId = null, isAdmin = false }) {
  const { rows } = await pool.query(
    `SELECT c.id, c.parent_id, c.body, c.status, c.created_at,
            u.id AS author_id, u.display_name, u.avatar_url
       FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.object_type = $1 AND c.object_id = $2
        AND (c.status = 'approved' OR $3::boolean OR c.user_id = $4::bigint)
      ORDER BY c.created_at`,
    [objectType, objectId, isAdmin, viewerId]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    parentId: r.parent_id ? Number(r.parent_id) : null,
    body: r.body,
    status: r.status,
    createdAt: r.created_at,
    author: { id: Number(r.author_id), displayName: r.display_name, avatarUrl: r.avatar_url }
  }));
}

/** Решение модератора. Вызывается только из-под requireAdmin. */
export async function moderateComment(pool, { commentId, status }) {
  if (!['approved', 'rejected'].includes(status)) throw new PublicError('Неизвестное решение');
  const { rowCount } = await pool.query('UPDATE comments SET status = $1 WHERE id = $2', [
    status,
    commentId
  ]);
  if (!rowCount) throw new PublicError('Комментарий не найден', 404);
}
```

- [ ] **Шаг 5: Убедиться, что тесты проходят**

Выполнить: `node --test test/feedback-service.test.js`
Ожидается: 8 тестов PASS.

- [ ] **Шаг 6: Коммит**

```bash
git add migrations/004_feedback.sql src/services/feedback.js test/feedback-service.test.js
git commit -m "feat: реакции и комментарии с премодерацией"
```

### Задача 16: JSON API витрины и обратной связи

**Файлы:**
- Создать: `src/routes/lessons.js`, `src/routes/feedback.js`,
  `test/lessons-routes.test.js`
- Изменить: `src/app.js`

**Интерфейсы:**
- Потребляет: сервисы задач 14 и 15, `requireUser`/`requireAdmin` задачи 11.
- Отдаёт дальше: `GET /api/lessons`, `GET /api/lessons/:slug`, `GET /api/news`,
  `PUT /api/lessons/:slug` (админ), `POST /api/reactions`,
  `DELETE /api/reactions`, `GET /api/comments`, `POST /api/comments`,
  `POST /api/comments/:id/moderate` (админ).

- [ ] **Шаг 1: Написать падающий тест**

`test/lessons-routes.test.js`:

```js
// Проверка API витрины поверх HTTP: что видит гость, что может вошедший,
// что доступно только автору.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveLesson } from '../src/services/lessons.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://portal.example.nip.io',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', channelId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' }
};

/** Заголовок авторизации для пользователя с заданной ролью. */
function as(userId, role) {
  return { Authorization: `Bearer ${signSession({ userId, role }, config.jwtSecret)}` };
}

async function seed(pool) {
  await saveLesson(pool, {
    slug: 'docker-1',
    title: 'Docker',
    status: 'published',
    publishedAt: new Date()
  });
  await saveLesson(pool, { slug: 'черновик', title: 'Не готов' });
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Пётр', 'user'), ('Автор', 'admin') RETURNING id`
  );
  const { rows: lesson } = await pool.query(`SELECT id FROM lessons WHERE slug = 'docker-1'`);
  return { petr: rows[0].id, admin: rows[1].id, lessonId: Number(lesson[0].id) };
}

test('гость видит опубликованное и не видит черновик', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const list = await (await fetch(`${base}/api/lessons`)).json();
      assert.deepEqual(
        list.lessons.map((l) => l.slug),
        ['docker-1']
      );
      assert.equal((await fetch(`${base}/api/lessons/черновик`)).status, 404);
    });
  });
});

test('админ видит черновики', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { admin } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/lessons?drafts=1`, { headers: as(admin, 'admin') });
      assert.equal((await res.json()).lessons.length, 2);
    });
  });
});

test('обычный пользователь черновики не выпрашивает', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/lessons?drafts=1`, { headers: as(petr, 'user') });
      assert.equal((await res.json()).lessons.length, 1);
    });
  });
});

test('гость не может поставить реакцию', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectType: 'lesson', objectId: lessonId, kind: 'like' })
      });
      assert.equal(res.status, 401);
    });
  });
});

test('вошедший ставит реакцию, счётчик растёт на единицу', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr, lessonId } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      for (let i = 0; i < 3; i += 1) {
        await fetch(`${base}/api/reactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...as(petr, 'user') },
          body: JSON.stringify({ objectType: 'lesson', objectId: lessonId, kind: 'like' })
        });
      }
      const lesson = await (await fetch(`${base}/api/lessons/docker-1`)).json();
      assert.deepEqual(lesson.lesson.reactions, { like: 1 });
    });
  });
});

test('гость не видит неодобренный комментарий', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr, lessonId } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      await fetch(`${base}/api/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...as(petr, 'user') },
        body: JSON.stringify({ objectType: 'lesson', objectId: lessonId, body: 'Спасибо!' })
      });
      const guest = await (
        await fetch(`${base}/api/comments?objectType=lesson&objectId=${lessonId}`)
      ).json();
      assert.equal(guest.comments.length, 0);
    });
  });
});

test('после одобрения комментарий виден гостю', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr, admin, lessonId } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const created = await (
        await fetch(`${base}/api/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...as(petr, 'user') },
          body: JSON.stringify({ objectType: 'lesson', objectId: lessonId, body: 'Спасибо!' })
        })
      ).json();

      const moderated = await fetch(`${base}/api/comments/${created.comment.id}/moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...as(admin, 'admin') },
        body: JSON.stringify({ status: 'approved' })
      });
      assert.equal(moderated.status, 200);

      const guest = await (
        await fetch(`${base}/api/comments?objectType=lesson&objectId=${lessonId}`)
      ).json();
      assert.equal(guest.comments.length, 1);
    });
  });
});

test('модерация закрыта для обычного пользователя', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr, lessonId } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const created = await (
        await fetch(`${base}/api/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...as(petr, 'user') },
          body: JSON.stringify({ objectType: 'lesson', objectId: lessonId, body: 'Спасибо!' })
        })
      ).json();
      const res = await fetch(`${base}/api/comments/${created.comment.id}/moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...as(petr, 'user') },
        body: JSON.stringify({ status: 'approved' })
      });
      assert.equal(res.status, 403);
    });
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/lessons-routes.test.js`
Ожидается: FAIL — модуль `src/routes/lessons.js` не найден.

- [ ] **Шаг 3: Написать `src/routes/lessons.js`**

```js
// API витрины. Задача — отдать клиентам уроки и новости и дать автору их
// править. Зачем тонкий: всё, что решает, кому что показывать, живёт в
// src/services/lessons.js; здесь только разбор запроса и коды ответа.
// Подключается в src/app.js по префиксу /api.
import { Router } from 'express';
import { listLessons, getLessonBySlug, listNews, saveLesson, setLessonTags } from '../services/lessons.js';
import { countReactions } from '../services/feedback.js';
import { requireAdmin } from '../middleware/guards.js';
import { PublicError } from '../middleware/errors.js';

export function lessonRoutes(config, pool) {
  const router = Router();

  router.get('/lessons', async (req, res) => {
    // Черновики показываются только админу и только по явной просьбе:
    // случайный ?drafts=1 от постороннего не должен ничего открывать.
    const includeDrafts = req.query.drafts === '1' && req.user?.role === 'admin';
    const lessons = await listLessons(pool, {
      tag: req.query.tag ? String(req.query.tag) : null,
      includeDrafts
    });
    res.json({ lessons });
  });

  router.get('/lessons/:slug', async (req, res) => {
    const includeDrafts = req.user?.role === 'admin';
    const lesson = await getLessonBySlug(pool, req.params.slug, { includeDrafts });
    if (!lesson) throw new PublicError('Урок не найден', 404);
    lesson.reactions = await countReactions(pool, { objectType: 'lesson', objectId: lesson.id });
    res.json({ lesson });
  });

  router.put('/lessons/:slug', requireAdmin, async (req, res) => {
    const lesson = await saveLesson(pool, { ...req.body, slug: req.params.slug });
    if (Array.isArray(req.body.tags)) await setLessonTags(pool, lesson.id, req.body.tags);
    res.json({ lesson });
  });

  router.get('/news', async (req, res) => {
    res.json({ news: await listNews(pool, {}) });
  });

  return router;
}
```

- [ ] **Шаг 4: Написать `src/routes/feedback.js`**

```js
// API обратной связи. Задача — принять реакцию и комментарий от вошедшего и
// отдать список тех комментариев, которые смотрящему положено видеть.
// Ни одно правило видимости здесь не решается: это работа services/feedback.js.
// Подключается в src/app.js по префиксу /api.
import { Router } from 'express';
import {
  setReaction,
  removeReaction,
  addComment,
  listComments,
  moderateComment
} from '../services/feedback.js';
import { requireUser, requireAdmin } from '../middleware/guards.js';

export function feedbackRoutes(config, pool) {
  const router = Router();

  router.post('/reactions', requireUser, async (req, res) => {
    const { objectType, objectId, kind } = req.body ?? {};
    await setReaction(pool, { userId: req.user.id, objectType, objectId, kind });
    res.json({ ok: true });
  });

  router.delete('/reactions', requireUser, async (req, res) => {
    const { objectType, objectId } = req.body ?? {};
    await removeReaction(pool, { userId: req.user.id, objectType, objectId });
    res.json({ ok: true });
  });

  router.get('/comments', async (req, res) => {
    const comments = await listComments(pool, {
      objectType: String(req.query.objectType),
      objectId: Number(req.query.objectId),
      viewerId: req.user?.id ?? null,
      isAdmin: req.user?.role === 'admin'
    });
    res.json({ comments });
  });

  router.post('/comments', requireUser, async (req, res) => {
    const { objectType, objectId, parentId, body } = req.body ?? {};
    const comment = await addComment(pool, {
      userId: req.user.id,
      objectType,
      objectId,
      parentId: parentId ?? null,
      body
    });
    // 201: комментарий создан, но опубликован не сразу — клиент должен
    // показать «ждёт проверки», а не сделать вид, что он уже в ленте.
    res.status(201).json({ comment });
  });

  router.post('/comments/:id/moderate', requireAdmin, async (req, res) => {
    await moderateComment(pool, {
      commentId: Number(req.params.id),
      status: req.body?.status
    });
    res.json({ ok: true });
  });

  return router;
}
```

Подключить оба в `src/app.js`:

```js
import { lessonRoutes } from './routes/lessons.js';
import { feedbackRoutes } from './routes/feedback.js';

app.use('/api', lessonRoutes(config, pool));
app.use('/api', feedbackRoutes(config, pool));
```

- [ ] **Шаг 5: Убедиться, что тесты проходят**

Выполнить: `npm test`
Ожидается: все PASS.

- [ ] **Шаг 6: Коммит**

```bash
git add src/routes/lessons.js src/routes/feedback.js src/app.js test/lessons-routes.test.js
git commit -m "feat: JSON API витрины, реакций и комментариев"
```

### Задача 17: Страницы витрины и проверка приёмки

**Файлы:**
- Создать: `src/views/feed.js`, `src/views/lesson.js`, `test/pages.test.js`
- Изменить: `src/routes/pages.js`, `public/app.js`, `public/styles.css`

**Интерфейсы:**
- Потребляет: `layout`, `escapeHtml`, сервисы витрины и обратной связи.
- Отдаёт дальше: `GET /` — лента; `GET /урок/:slug` — карточка с тегами
  Open Graph; `GET /тег/:slug` — лента по тегу.

- [ ] **Шаг 1: Написать падающий тест**

`test/pages.test.js`:

```js
// Проверка серверных страниц. Ради них серверный рендер и существует: урок
// должен открываться из инкогнито и разворачиваться превью в мессенджере.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { saveLesson } from '../src/services/lessons.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://portal.example.nip.io',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', channelId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' }
};

test('лента отдаёт HTML с заголовком урока', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveLesson(pool, {
      slug: 'docker-1',
      title: 'Docker, часть 1',
      status: 'published',
      publishedAt: new Date()
    });
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /text\/html/);
      assert.match(await res.text(), /Docker, часть 1/);
    });
  });
});

test('карточка урока несёт теги превью', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveLesson(pool, {
      slug: 'docker-1',
      title: 'Docker, часть 1',
      description: 'Контейнеры с нуля',
      status: 'published',
      publishedAt: new Date()
    });
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (await fetch(`${base}/урок/docker-1`)).text();
      assert.match(html, /<meta property="og:title" content="Docker, часть 1">/);
      assert.match(html, /Контейнеры с нуля/);
    });
  });
});

test('черновик по прямой ссылке даёт 404', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveLesson(pool, { slug: 'черновик', title: 'Не готов' });
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      assert.equal((await fetch(`${base}/урок/черновик`)).status, 404);
    });
  });
});

test('название урока с разметкой экранируется', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveLesson(pool, {
      slug: 'xss',
      title: '<script>alert(1)</script>',
      status: 'published',
      publishedAt: new Date()
    });
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (await fetch(`${base}/`)).text();
      assert.ok(!html.includes('<script>alert(1)</script>'));
      assert.match(html, /&lt;script&gt;/);
    });
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/pages.test.js`
Ожидается: FAIL — маршрут `/` отвечает 404.

- [ ] **Шаг 3: Написать `src/views/feed.js` и `src/views/lesson.js`**

`src/views/feed.js`:

```js
// Лента: уроки и новости одним списком, свежие сверху. Задача — дать
// поисковику и человеку без приложения полноценную главную страницу.
// Вызывается из src/routes/pages.js по маршрутам / и /тег/:slug.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';

/** Дата в виде, привычном читателю: «1 августа 2026». */
function датаПоРусски(value) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(new Date(value));
}

function карточка(lesson) {
  return `<article class="карточка">
  ${lesson.coverUrl ? `<img src="${escapeHtml(lesson.coverUrl)}" alt="">` : ''}
  <h2><a href="/урок/${encodeURIComponent(lesson.slug)}">${escapeHtml(lesson.title)}</a></h2>
  <p>${escapeHtml(lesson.description)}</p>
  <p class="мета">${lesson.publishedAt ? датаПоРусски(lesson.publishedAt) : 'Черновик'}</p>
</article>`;
}

export function feedPage({ config, lessons, news, user, tag = null }) {
  const заголовок = tag ? `Уроки по теме «${tag}»` : 'Портал видеоуроков';
  return layout({
    config,
    user,
    title: заголовок,
    description: 'Видеоуроки о разработке: все выпуски, новости и ссылки на площадки.',
    body: `
<h1>${escapeHtml(заголовок)}</h1>
${lessons.length ? lessons.map(карточка).join('\n') : '<p>Пока ни одного урока.</p>'}
${
  news.length
    ? `<section class="новости"><h2>Новости</h2>${news
        .map(
          (n) =>
            `<article><h3>${escapeHtml(n.title)}</h3><p>${escapeHtml(n.body)}</p></article>`
        )
        .join('')}</section>`
    : ''
}
`
  });
}
```

`src/views/lesson.js`:

```js
// Карточка урока: описание, кнопки «смотреть на», реакции и комментарии.
// Задача — быть той страницей, ссылку на которую отправляют в мессенджер;
// поэтому заголовок, описание и обложка обязаны попасть в теги превью.
// Вызывается из src/routes/pages.js по маршруту /урок/:slug.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';

// Как называются площадки на кнопках. Слаг площадки для человека не годится.
const НАЗВАНИЯ_ПЛОЩАДОК = {
  youtube: 'YouTube',
  vk: 'VK Видео',
  telegram: 'Telegram',
  rutube: 'RuTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  dzen: 'Дзен',
  max: 'MAX'
};

export function lessonPage({ config, lesson, comments, user, viewerReaction = null }) {
  const кнопки = lesson.publications
    .filter((p) => p.url && p.state === 'published')
    .map(
      (p) =>
        `<a class="кнопка" href="${escapeHtml(p.url)}" rel="noopener">Смотреть на ${
          НАЗВАНИЯ_ПЛОЩАДОК[p.platform] ?? escapeHtml(p.platform)
        }</a>`
    )
    .join(' ');

  const лентаКомментариев = comments
    .map(
      (c) => `<li class="комментарий${c.status === 'pending' ? ' ждёт' : ''}">
  <b>${escapeHtml(c.author.displayName)}</b>
  <p>${escapeHtml(c.body)}</p>
  ${c.status === 'pending' ? '<em>ждёт проверки автором</em>' : ''}
</li>`
    )
    .join('');

  return layout({
    config,
    user,
    title: lesson.title,
    description: lesson.description,
    image: lesson.coverUrl,
    body: `
<article class="урок" data-урок="${lesson.id}">
  <h1>${escapeHtml(lesson.title)}</h1>
  <p>${escapeHtml(lesson.description)}</p>
  <p class="площадки">${кнопки || 'Ссылки появятся после публикации.'}</p>
  <p class="реакции">
    <button data-реакция="like" class="${viewerReaction === 'like' ? 'отдана' : ''}">
      👍 <span>${lesson.reactions.like ?? 0}</span></button>
    <button data-реакция="fire" class="${viewerReaction === 'fire' ? 'отдана' : ''}">
      🔥 <span>${lesson.reactions.fire ?? 0}</span></button>
  </p>
  <section class="отзывы">
    <h2>Отзывы</h2>
    <ul>${лентаКомментариев || '<li>Пока никто не написал.</li>'}</ul>
    ${
      user
        ? `<form id="форма-отзыва"><textarea name="body" required></textarea>
           <button type="submit">Отправить</button>
           <p class="подсказка">Отзыв появится после проверки автором.</p></form>`
        : '<p><a href="/login">Войдите</a>, чтобы оставить отзыв.</p>'
    }
  </section>
</article>`
  });
}
```

- [ ] **Шаг 4: Дописать `src/routes/pages.js`**

```js
// (добавляется к маршруту /login из задачи 12)
import { listLessons, getLessonBySlug, listNews } from '../services/lessons.js';
import { listComments, countReactions, getViewerReaction } from '../services/feedback.js';
import { feedPage } from '../views/feed.js';
import { lessonPage } from '../views/lesson.js';
import { PublicError } from '../middleware/errors.js';

/** Текущий пользователь для шаблона: имя и роль, без похода за лишним. */
async function текущий(pool, req) {
  if (!req.user) return null;
  const { rows } = await pool.query('SELECT display_name, role FROM users WHERE id = $1', [
    req.user.id
  ]);
  return rows.length ? { displayName: rows[0].display_name, role: rows[0].role } : null;
}

router.get('/', async (req, res) => {
  const user = await текущий(pool, req);
  const lessons = await listLessons(pool, { includeDrafts: user?.role === 'admin' });
  const news = await listNews(pool, {});
  res.type('html').send(feedPage({ config, lessons, news, user }));
});

router.get('/тег/:slug', async (req, res) => {
  const user = await текущий(pool, req);
  const lessons = await listLessons(pool, { tag: req.params.slug });
  res.type('html').send(feedPage({ config, lessons, news: [], user, tag: req.params.slug }));
});

router.get('/урок/:slug', async (req, res) => {
  const user = await текущий(pool, req);
  const lesson = await getLessonBySlug(pool, req.params.slug, {
    includeDrafts: user?.role === 'admin'
  });
  if (!lesson) throw new PublicError('Урок не найден', 404);
  lesson.reactions = await countReactions(pool, { objectType: 'lesson', objectId: lesson.id });
  const comments = await listComments(pool, {
    objectType: 'lesson',
    objectId: lesson.id,
    viewerId: req.user?.id ?? null,
    isAdmin: user?.role === 'admin'
  });
  const viewerReaction = await getViewerReaction(pool, {
    objectType: 'lesson',
    objectId: lesson.id,
    userId: req.user?.id ?? null
  });
  res.type('html').send(lessonPage({ config, lesson, comments, user, viewerReaction }));
});
```

Ошибка `PublicError` со статусом 404 доходит до `errorHandler` и отдаётся
как JSON — браузеру нужна страница. Заменить тело `errorHandler` в
`src/middleware/errors.js` на:

```js
export function errorHandler(err, req, res, _next) {
  const status = err?.public ? (err.status ?? 400) : 500;
  const message = err?.public ? err.message : 'Внутренняя ошибка';
  if (!err?.public) console.error('Необработанная ошибка:', err);

  // Один и тот же сбой должен выглядеть по-разному для человека и для
  // клиента API: браузеру страница, коду JSON. Различает их заголовок Accept.
  if (req.accepts(['json', 'html']) === 'html') {
    res.status(status).type('html').send(
      `<!doctype html><html lang="ru"><head><meta charset="utf-8">` +
        `<title>${status}</title><link rel="stylesheet" href="/styles.css"></head>` +
        `<body><main><h1>${status}</h1><p>${escapeHtml(message)}</p>` +
        `<p><a href="/">На главную</a></p></main></body></html>`
    );
    return;
  }
  res.status(status).json({ error: message });
}
```

Импорт вверху файла: `import { escapeHtml } from '../lib/html.js';`.

- [ ] **Шаг 5: Дописать клиент `public/app.js`**

```js
// Реакции и отзывы на карточке урока. Дописывается к public/app.js.
const урок = document.querySelector('[data-урок]');
if (урок) {
  const objectId = Number(урок.dataset.урок);

  for (const кнопка of урок.querySelectorAll('[data-реакция]')) {
    кнопка.addEventListener('click', async () => {
      const kind = кнопка.dataset.реакция;
      // Нажатие по уже отданной реакции снимает её: иначе передумать нельзя,
      // а сервер всё равно хранит одну реакцию на человека.
      const отдана = кнопка.classList.contains('отдана');
      await запрос('/api/reactions', {
        method: отдана ? 'DELETE' : 'POST',
        body: JSON.stringify({ objectType: 'lesson', objectId, kind })
      });
      location.reload();
    });
  }

  const форма = document.querySelector('#форма-отзыва');
  форма?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = new FormData(форма).get('body');
    const ответ = await запрос('/api/comments', {
      method: 'POST',
      body: JSON.stringify({ objectType: 'lesson', objectId, body })
    });
    if (!ответ) return;
    форма.reset();
    // Перезагружать не за чем: отзыв всё равно скрыт до проверки автором,
    // и в ленте его не появится. Честнее сказать это прямо.
    форма.insertAdjacentHTML('afterend', '<p class="подсказка">Отзыв отправлен и ждёт проверки.</p>');
  });
}
```

- [ ] **Шаг 6: Убедиться, что тесты проходят**

Выполнить: `npm test && npm run lint`
Ожидается: всё зелёное.

- [ ] **Шаг 7: Проверить критерий приёмки на живом сервере**

```bash
docker compose up -d --build
```

1. Завести урок: `PUT /api/lessons/docker-1` с телом
   `{"title":"Docker, часть 1","description":"...","status":"published","publishedAt":"2026-09-02T10:00:00Z"}`
   под админской сессией.
2. Открыть `https://<домен>/урок/docker-1` **в инкогнито** — урок виден.
3. Войти, нажать 👍 дважды — счётчик показывает 1.
4. Отправить отзыв, открыть страницу в инкогнито — отзыва **нет**.
5. Одобрить (`POST /api/comments/<id>/moderate` со `status: approved`),
   обновить инкогнито — отзыв появился.
6. Отправить ссылку на урок себе в Telegram — развернулось превью с
   заголовком и описанием.

- [ ] **Шаг 8: Коммит**

```bash
git add src/views/feed.js src/views/lesson.js src/routes/pages.js \
        src/middleware/errors.js public/app.js public/styles.css test/pages.test.js
git commit -m "feat: страницы ленты и карточки урока с превью для мессенджеров"
```

---

# Этап 3 — PWA и уведомления

**Критерий приёмки заказчика:** поставил приложение с домашнего экрана,
опубликовал урок с ноутбука — пуш пришёл. Проверка на Android **и** на iPhone
отдельно.

Здесь же появляется слой уведомлений: он выбирает канал сам, а вызывающий код
о каналах ничего не знает. Это заготовка под этапы 4, 7 и 9 — там уведомлять
придётся о смене статуса идеи, об упавшей публикации и о новых комментариях.

### Задача 18: Манифест, service worker, офлайн

**Файлы:**
- Создать: `public/sw.js`, `public/icons/icon-192.png`,
  `public/icons/icon-512.png`, `public/icons/icon-180.png`,
  `src/routes/pwa.js`, `test/pwa.test.js`
- Изменить: `src/app.js`, `src/views/layout.js`

**Интерфейсы:**
- Отдаёт дальше: `GET /manifest.webmanifest` — манифест, собранный из
  `PUBLIC_BASE_URL`; `GET /sw.js` — service worker; офлайн-страница `/офлайн`.

- [ ] **Шаг 1: Написать падающий тест**

`test/pwa.test.js`:

```js
// Проверка манифеста. Он собирается на сервере, а не лежит файлом, ровно по
// одной причине: адрес портала живёт в окружении, а манифест обязан его знать.
// Файл-константа заставил бы править репозиторий при смене адреса.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { withServer } from './helpers/http.js';

const config = {
  publicBaseUrl: 'https://portal.example.nip.io',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', channelId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: 'mailto:a@b' }
};

test('манифест собран из адреса портала', async () => {
  const app = finalize(createApp({ config, pool: null }));
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/manifest.webmanifest`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /manifest\+json/);
    const manifest = await res.json();
    assert.equal(manifest.start_url, 'https://portal.example.nip.io/');
    assert.equal(manifest.display, 'standalone');
    assert.ok(manifest.icons.some((i) => i.sizes === '512x512'));
  });
});

test('service worker отдаётся с корня', async () => {
  const app = finalize(createApp({ config, pool: null }));
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/sw.js`);
    assert.equal(res.status, 200);
    // Область действия worker'а ограничена каталогом, откуда он отдан:
    // из /public/sw.js он не смог бы обслуживать корень сайта.
    assert.match(res.headers.get('content-type'), /javascript/);
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/pwa.test.js`
Ожидается: FAIL — 404 на манифесте.

- [ ] **Шаг 3: Написать `src/routes/pwa.js`**

```js
// Обвязка приложения: манифест и service worker.
//
// Задача — отдать оба файла с корня сайта и с правильными типами. Зачем
// манифест собирается кодом: в нём есть адрес портала, а адрес живёт только в
// окружении — статический файл пришлось бы править руками при каждом переезде.
// Зачем sw.js отдаётся маршрутом, а не статикой: область действия worker'а
// равна каталогу, из которого он отдан, и из /public/ он не смог бы
// перехватывать запросы к корню.
// Подключается в src/app.js до статики.
import { Router } from 'express';
import { readFile } from 'node:fs/promises';

export function pwaRoutes(config) {
  const router = Router();

  router.get('/manifest.webmanifest', (req, res) => {
    res.type('application/manifest+json').json({
      name: 'Портал видеоуроков',
      short_name: 'Уроки',
      description: 'Видеоуроки о разработке, новости и борд идей.',
      start_url: `${config.publicBaseUrl}/`,
      scope: `${config.publicBaseUrl}/`,
      // standalone — приложение открывается без адресной строки браузера.
      // Без этого iOS не считает страницу приложением и не даёт Web Push.
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#1a1a1a',
      lang: 'ru',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        // maskable нужен Android: без него иконку обрежут в круг по-своему.
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    });
  });

  router.get('/sw.js', async (req, res) => {
    const code = await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8');
    res.type('application/javascript').send(code);
  });

  return router;
}
```

- [ ] **Шаг 4: Написать `public/sw.js`**

За основу берётся `myproject/public/sw.js` — он работает в бою. Отличия:
своё имя кеша и офлайн-страница.

```js
/* Service worker портала: офлайн-оболочка и приём пушей.
 *
 * Задача — показать что-то осмысленное без сети и превратить пуш в уведомление
 * на экране. Зачем оболочка, а не кеш всего: уроки живут на площадках, кешировать
 * тут нечего — а вот пустой белый экран в метро выглядит как сломанное приложение.
 * Регистрируется из public/app.js при загрузке любой страницы.
 */
const КЕШ = 'портал-оболочка-v1';
const ОБОЛОЧКА = ['/', '/офлайн', '/styles.css', '/app.js', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(КЕШ).then((c) => c.addAll(ОБОЛОЧКА)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== КЕШ).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Сеть в приоритете: содержимое портала меняется, и показывать вчерашнюю ленту
// вместо сегодняшней хуже, чем секунда ожидания. Кеш — только запасной выход.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const копия = response.clone();
        caches.open(КЕШ).then((c) => c.put(event.request, копия));
        return response;
      })
      .catch(() => caches.match(event.request).then((c) => c ?? caches.match('/офлайн')))
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data && event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Портал видеоуроков', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/' }
    })
  );
});

// Нажатие на уведомление открывает уже открытую вкладку, если она есть, и
// только иначе новую: иначе у человека копятся вкладки одного и того же портала.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const адрес = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((список) => {
      const открытая = список.find((c) => c.url.includes(адрес));
      return открытая ? открытая.focus() : self.clients.openWindow(адрес);
    })
  );
});
```

- [ ] **Шаг 5: Иконки, офлайн-страница, регистрация**

- Нарисовать три иконки (192, 512, 180) — можно временные, с буквой; заменяются
  позже без правки кода.
- В `src/routes/pages.js` добавить `GET /офлайн` — страница «нет сети».
- Регистрация service worker уже добавлена в `public/app.js` задачей 12 —
  проверить, что строка на месте, и ничего не дублировать.
- В `src/app.js` подключить `app.use('/', pwaRoutes(config))` **до** статики.

- [ ] **Шаг 6: Убедиться, что тесты проходят**

Выполнить: `node --test test/pwa.test.js`
Ожидается: 2 теста PASS.

- [ ] **Шаг 7: Коммит**

```bash
git add public/sw.js public/icons src/routes/pwa.js src/routes/pages.js \
        src/app.js public/app.js test/pwa.test.js
git commit -m "feat: манифест, service worker и офлайн-оболочка"
```

### Задача 19: Подписки Web Push и журнал уведомлений

**Файлы:**
- Создать: `migrations/005_notifications.sql`, `src/routes/push.js`,
  `test/push-routes.test.js`
- Изменить: `src/app.js`, `public/app.js`

**Интерфейсы:**
- Отдаёт дальше: таблицы `push_subscriptions` (id, user_id, endpoint, p256dh,
  auth, created_at) и `notifications` (id, user_id, kind, payload, channel,
  dedup_key, sent_at); маршруты `GET /api/push/key`, `POST /api/push/subscribe`,
  `POST /api/push/unsubscribe`.

- [ ] **Шаг 1: Написать падающий тест**

`test/push-routes.test.js`:

```js
// Проверка подписки на пуши: гость подписаться не может, повторная подписка с
// того же устройства не двоится, отписка убирает.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://portal.example.nip.io',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', channelId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: 'ПУБЛИЧНЫЙ', privateKey: 'ЗАКРЫТЫЙ', subject: 'mailto:a@b' }
};

const подписка = {
  endpoint: 'https://push.example/abc',
  keys: { p256dh: 'ключ', auth: 'соль' }
};

function as(userId) {
  return { Authorization: `Bearer ${signSession({ userId, role: 'user' }, config.jwtSecret)}` };
}

test('публичный ключ отдаётся всем', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await (await fetch(`${base}/api/push/key`)).json();
      assert.equal(res.key, 'ПУБЛИЧНЫЙ');
    });
  });
});

test('гость подписаться не может', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/push/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(подписка)
      });
      assert.equal(res.status, 401);
    });
  });
});

test('повторная подписка того же устройства не двоится', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(`INSERT INTO users (display_name) VALUES ('Пётр') RETURNING id`);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      for (let i = 0; i < 2; i += 1) {
        await fetch(`${base}/api/push/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...as(rows[0].id) },
          body: JSON.stringify(подписка)
        });
      }
      const { rows: subs } = await pool.query('SELECT count(*)::int AS n FROM push_subscriptions');
      assert.equal(subs[0].n, 1);
    });
  });
});

test('отписка убирает подписку', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(`INSERT INTO users (display_name) VALUES ('Пётр') RETURNING id`);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      await fetch(`${base}/api/push/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...as(rows[0].id) },
        body: JSON.stringify(подписка)
      });
      await fetch(`${base}/api/push/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...as(rows[0].id) },
        body: JSON.stringify({ endpoint: подписка.endpoint })
      });
      const { rows: subs } = await pool.query('SELECT count(*)::int AS n FROM push_subscriptions');
      assert.equal(subs[0].n, 0);
    });
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/push-routes.test.js`
Ожидается: FAIL — 404 на `/api/push/key`.

- [ ] **Шаг 3: Написать `migrations/005_notifications.sql`**

```sql
-- Подписки на пуши и журнал отправленного.
--
-- Зачем журнал: одно событие может дойти до человека тремя каналами, а задача
-- в очереди на этапе 5 может повториться после сбоя. Ключ dedup_key делает
-- повтор невозможным на уровне базы, а не на честном слове кода.
-- Читается из src/services/notify/index.js и src/routes/push.js.

CREATE TABLE push_subscriptions (
  id         bigserial PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Адрес, выданный браузером. Уникален глобально: одно устройство — одна
  -- строка, даже если человек переподписался.
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

CREATE TABLE notifications (
  id         bigserial PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Повод: lesson_published, comment_reply, idea_status.
  kind       text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Каким каналом ушло: webpush, telegram, max. NULL — не ушло никуда,
  -- человеку нечем доставить.
  channel    text,
  -- «Это уведомление уже отправляли». Складывается из повода и объекта.
  dedup_key  text NOT NULL UNIQUE,
  sent_at    timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Шаг 4: Написать `src/routes/push.js`**

```js
// Подписка на Web Push. Задача — принять от браузера адрес его канала пушей и
// запомнить его за человеком. Зачем ключ отдаётся отдельным маршрутом: браузер
// требует публичный ключ VAPID до оформления подписки, а в HTML его вшивать
// незачем — он и так меняется вместе с перевыпуском ключей.
// Подключается в src/app.js по префиксу /api/push.
import { Router } from 'express';
import { requireUser } from '../middleware/guards.js';

export function pushRoutes(config, pool) {
  const router = Router();

  router.get('/key', (req, res) => {
    // Пустая строка, если пуши не настроены: клиент по ней понимает, что
    // предлагать подписку не нужно, и не показывает мёртвую кнопку.
    res.json({ key: config.vapid.publicKey });
  });

  router.post('/subscribe', requireUser, async (req, res) => {
    const { endpoint, keys } = req.body ?? {};
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id,
                                            p256dh = EXCLUDED.p256dh,
                                            auth = EXCLUDED.auth`,
      [req.user.id, endpoint, keys?.p256dh, keys?.auth]
    );
    res.json({ ok: true });
  });

  router.post('/unsubscribe', requireUser, async (req, res) => {
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [
      req.body?.endpoint,
      req.user.id
    ]);
    res.json({ ok: true });
  });

  return router;
}
```

Подключить в `src/app.js`: `app.use('/api/push', pushRoutes(config, pool));`.

В `public/app.js` дописать подписку:

```js
/**
 * Переводит публичный ключ VAPID из base64url в байты.
 * Зачем: браузер принимает applicationServerKey только массивом байт, а
 * сервер отдаёт строку. Это самое частое место, где подписка молча не
 * оформляется. Вызывается только из включитьУведомления.
 */
function ключВБайты(base64url) {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/**
 * Оформляет подписку на пуши. Вызывается по нажатию кнопки, а не сама:
 * запрос разрешения без действия человека браузеры отклоняют, а Safari
 * запоминает отказ надолго.
 */
async function включитьУведомления() {
  const { key } = await запрос('/api/push/key');
  if (!key) return;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    // Без этого флага браузер разрешил бы «тихие» пуши без уведомления —
    // и отозвал бы подписку, заметив, что мы ничего не показываем.
    userVisibleOnly: true,
    applicationServerKey: ключВБайты(key)
  });
  await запрос('/api/push/subscribe', { method: 'POST', body: JSON.stringify(subscription) });
}

document.querySelector('#включить-уведомления')?.addEventListener('click', включитьУведомления);
```

В `src/views/layout.js` добавить кнопку в шапку для вошедшего пользователя:
`<button id="включить-уведомления">🔔</button>`.

- [ ] **Шаг 5: Убедиться, что тесты проходят**

Выполнить: `node --test test/push-routes.test.js`
Ожидается: 4 теста PASS.

- [ ] **Шаг 6: Коммит**

```bash
git add migrations/005_notifications.sql src/routes/push.js src/app.js \
        public/app.js test/push-routes.test.js
git commit -m "feat: подписки Web Push и журнал уведомлений"
```

### Задача 20: Слой уведомлений с выбором канала

**Файлы:**
- Создать: `src/services/notify/index.js`, `src/services/notify/webpush.js`,
  `src/services/notify/telegram.js`, `test/notify.test.js`

**Интерфейсы:**
- Потребляет: таблицы задачи 19, `identities` задачи 6.
- Отдаёт дальше:
  `notify(pool, { userId, kind, dedupKey, title, body, url }, channels)` →
  `{ channel }` или `{ channel: null, reason }`. `channels` — объект
  `{ webpush, telegram, max }` из функций `async (adres, message) => void`;
  `createWebPushChannel(config)`; `createTelegramChannel(config, fetchImpl)`.

- [ ] **Шаг 1: Написать падающий тест**

`test/notify.test.js`:

```js
// Проверка слоя уведомлений. Главное правило заказчика: один человек получает
// ОДНО уведомление, а не три по трём каналам, и повтор задачи его не задваивает.
import test from 'node:test';
import assert from 'node:assert/strict';
import { notify } from '../src/services/notify/index.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

/** Каналы-заглушки: запоминают, что и куда ушло. */
function каналы() {
  const отправлено = [];
  return {
    отправлено,
    channels: {
      webpush: async (адреса, message) => отправлено.push({ канал: 'webpush', message }),
      telegram: async (чат, message) => отправлено.push({ канал: 'telegram', чат, message })
    }
  };
}

async function человекСПушем(pool) {
  const { rows } = await pool.query(`INSERT INTO users (display_name) VALUES ('Пётр') RETURNING id`);
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, 'https://push.example/a', 'k', 's')`,
    [rows[0].id]
  );
  return Number(rows[0].id);
}

async function человекСТелеграмом(pool) {
  const { rows } = await pool.query(`INSERT INTO users (display_name) VALUES ('Анна') RETURNING id`);
  await pool.query(
    `INSERT INTO identities (user_id, provider, external_id) VALUES ($1, 'tg_widget', '777')`,
    [rows[0].id]
  );
  return Number(rows[0].id);
}

const событие = { kind: 'lesson_published', title: 'Новый урок', body: 'Docker, часть 1', url: '/' };

test('есть подписка на пуш — уходит пушем', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const userId = await человекСПушем(pool);
    const { channels, отправлено } = каналы();
    const result = await notify(pool, { ...событие, userId, dedupKey: 'урок:1:польз:1' }, channels);
    assert.equal(result.channel, 'webpush');
    assert.equal(отправлено.length, 1);
  });
});

test('пуша нет, телеграм есть — уходит ботом', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const userId = await человекСТелеграмом(pool);
    const { channels, отправлено } = каналы();
    const result = await notify(pool, { ...событие, userId, dedupKey: 'урок:1:польз:2' }, channels);
    assert.equal(result.channel, 'telegram');
    assert.equal(отправлено[0].чат, '777');
  });
});

test('человек получает одно уведомление, а не три', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const userId = await человекСПушем(pool);
    await pool.query(
      `INSERT INTO identities (user_id, provider, external_id) VALUES ($1, 'tg_widget', '888')`,
      [userId]
    );
    const { channels, отправлено } = каналы();
    await notify(pool, { ...событие, userId, dedupKey: 'урок:1:польз:3' }, channels);
    assert.equal(отправлено.length, 1);
    assert.equal(отправлено[0].канал, 'webpush');
  });
});

test('повтор с тем же ключом ничего не отправляет', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const userId = await человекСПушем(pool);
    const { channels, отправлено } = каналы();
    const ключ = 'урок:1:польз:4';
    await notify(pool, { ...событие, userId, dedupKey: ключ }, channels);
    const второй = await notify(pool, { ...событие, userId, dedupKey: ключ }, channels);
    assert.equal(отправлено.length, 1);
    assert.equal(второй.reason, 'уже отправляли');
  });
});

test('связаться нечем — молчим и записываем это', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(
      `INSERT INTO users (display_name) VALUES ('Молчун') RETURNING id`
    );
    const { channels, отправлено } = каналы();
    const result = await notify(
      pool,
      { ...событие, userId: Number(rows[0].id), dedupKey: 'урок:1:польз:5' },
      channels
    );
    assert.equal(result.channel, null);
    assert.equal(отправлено.length, 0);
    const { rows: журнал } = await pool.query('SELECT channel FROM notifications');
    assert.equal(журнал[0].channel, null);
  });
});

test('упавшая отправка не оставляет ложной записи в журнале', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const userId = await человекСПушем(pool);
    const падающие = {
      webpush: async () => {
        throw new Error('канал недоступен');
      }
    };
    await assert.rejects(
      notify(pool, { ...событие, userId, dedupKey: 'урок:1:польз:6' }, падающие),
      /недоступен/
    );
    // Иначе повтор задачи после сбоя решил бы, что уже отправлено, и человек
    // не получил бы ничего вообще.
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM notifications');
    assert.equal(rows[0].n, 0);
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/notify.test.js`
Ожидается: FAIL — модуль не найден.

- [ ] **Шаг 3: Написать `src/services/notify/index.js`**

```js
// Слой уведомлений: выбор канала и защита от повторов.
//
// Задача — избавить вызывающий код от знания о каналах. Он говорит «уведомить
// такого-то о таком-то», а куда это уйдёт — пушем, ботом Telegram, ботом MAX
// или никуда — решается здесь, по тому, что у человека есть. Зачем так: поводов
// уведомить будет много (новый урок, ответ на комментарий, статус идеи, упавшая
// публикация), и если каждый из них начнёт сам перебирать каналы, правило
// «одно событие — одно уведомление» разойдётся на первом же новом поводе.
// Вызывается из src/routes/lessons.js, src/routes/ideas.js и с этапа 5 — из воркера.

/**
 * Отправляет уведомление одним каналом — первым доступным по приоритету:
 * пуш в приложение → бот Telegram → бот MAX → молчим.
 *
 * Запись в журнал делается ДО отправки и снимается при неудаче: так повтор
 * задачи после сбоя доотправит, а повтор после успеха — нет.
 */
export async function notify(pool, { userId, kind, dedupKey, title, body, url }, channels) {
  // Занимаем ключ. Не занялся — значит это уведомление уже отправляли.
  const занято = await pool.query(
    `INSERT INTO notifications (user_id, kind, payload, dedup_key)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (dedup_key) DO NOTHING
     RETURNING id`,
    [userId, kind, JSON.stringify({ title, body, url }), dedupKey]
  );
  if (!занято.rowCount) return { channel: null, reason: 'уже отправляли' };
  const notificationId = занято.rows[0].id;

  const message = { title, body, url };

  try {
    const { rows: подписки } = await pool.query(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
      [userId]
    );
    if (подписки.length && channels.webpush) {
      await channels.webpush(подписки, message);
      await pool.query('UPDATE notifications SET channel = $1 WHERE id = $2', [
        'webpush',
        notificationId
      ]);
      return { channel: 'webpush' };
    }

    const { rows: привязки } = await pool.query(
      `SELECT provider, external_id FROM identities
        WHERE user_id = $1 AND provider IN ('tg_widget', 'tg_miniapp', 'max_miniapp')`,
      [userId]
    );
    const телеграм = привязки.find((i) => i.provider.startsWith('tg_'));
    if (телеграм && channels.telegram) {
      await channels.telegram(телеграм.external_id, message);
      await pool.query('UPDATE notifications SET channel = $1 WHERE id = $2', [
        'telegram',
        notificationId
      ]);
      return { channel: 'telegram' };
    }

    const max = привязки.find((i) => i.provider === 'max_miniapp');
    if (max && channels.max) {
      await channels.max(max.external_id, message);
      await pool.query('UPDATE notifications SET channel = $1 WHERE id = $2', ['max', notificationId]);
      return { channel: 'max' };
    }

    // Связаться нечем. Запись остаётся с channel = NULL: это не ошибка, а факт,
    // и он пригодится, когда автор спросит, до скольких человек дошло.
    return { channel: null, reason: 'нет доступного канала' };
  } catch (err) {
    await pool.query('DELETE FROM notifications WHERE id = $1', [notificationId]);
    throw err;
  }
}
```

- [ ] **Шаг 4: Написать каналы**

`src/services/notify/webpush.js`:

```js
// Канал Web Push. Задача — разослать сообщение по всем устройствам человека и
// убрать те подписки, которые браузер объявил мёртвыми. Зачем убирать: отписки
// при удалении приложения не происходит, и без чистки таблица за год
// наполнится адресами, в которые никто не смотрит.
// Вызывается из слоя уведомлений (src/services/notify/index.js).
import webpush from 'web-push';

// Сутки жизни у сообщения на сервере проталкивания: телефон в самолёте должен
// получить уведомление о новом уроке, когда включится, а не потерять его.
const TTL_SECONDS = 86_400;

// Коды, которыми браузер сообщает «этой подписки больше нет».
const МЁРТВЫЕ_КОДЫ = [404, 410];

export function createWebPushChannel(config, pool) {
  // Необязательные поля читаются через ?. намеренно: приложение должно
  // подниматься и без настроенных пушей — например, в тестах витрины, где
  // уведомления ни при чём. Нет ключей — канала нет, и слой уведомлений
  // просто перейдёт к следующему.
  if (!config.vapid?.publicKey || !config.vapid?.privateKey) return null;
  webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);

  return async (подписки, message) => {
    const payload = JSON.stringify(message);
    for (const s of подписки) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: TTL_SECONDS }
        );
      } catch (err) {
        if (МЁРТВЫЕ_КОДЫ.includes(err.statusCode)) {
          await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [s.endpoint]);
        } else {
          throw err;
        }
      }
    }
  };
}
```

`src/services/notify/telegram.js`:

```js
// Канал телеграм-бота. Задача — доставить уведомление тому, у кого нет
// установленного приложения, но есть привязанный телеграм. Зачем через тот же
// токен, что и вход: бот один, и человек, вошедший его виджетом, уже разрешил
// ему писать (data-request-access="write").
// Вызывается из слоя уведомлений (src/services/notify/index.js).

export function createTelegramChannel(config, fetchImpl = fetch) {
  // Как и у Web Push: не настроен бот — канала нет, приложение работает.
  if (!config.telegram?.botToken) return null;

  return async (chatId, message) => {
    const res = await fetchImpl(
      `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `${message.title}\n\n${message.body}\n${config.publicBaseUrl}${message.url ?? '/'}`,
          // Превью ссылки в боте раздувает сообщение на пол-экрана: заголовок
          // и так есть в тексте.
          disable_web_page_preview: true
        })
      }
    );
    if (!res.ok) throw new Error(`Telegram не принял сообщение: ${res.status}`);
  };
}
```

Добавить зависимость: `npm install web-push`.

- [ ] **Шаг 5: Убедиться, что тесты проходят**

Выполнить: `node --test test/notify.test.js`
Ожидается: 6 тестов PASS.

- [ ] **Шаг 6: Коммит**

```bash
git add src/services/notify test/notify.test.js package.json package-lock.json
git commit -m "feat: слой уведомлений — один канал на человека, без повторов"
```

### Задача 21: Рассылка о новом уроке и проверка на телефонах

**Файлы:**
- Изменить: `src/app.js` (собрать каналы один раз), `src/routes/lessons.js`
  (публикация урока рассылает уведомления)
- Создать: `test/lesson-published.test.js`

**Интерфейсы:**
- Потребляет: `notify`, `createWebPushChannel`, `createTelegramChannel`.
- Отдаёт дальше: `app.locals.channels`; при переводе урока в `published`
  уведомление уходит каждому, у кого есть хоть один канал.

- [ ] **Шаг 1: Написать падающий тест**

`test/lesson-published.test.js`:

```js
// Проверка события «вышел урок» — это ровно то, что заказчик будет проверять
// руками с ноутбука, глядя на телефон.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://portal.example.nip.io',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', channelId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: 'mailto:a@b' }
};

test('публикация урока рассылает уведомления подписчикам', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(
      `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin'), ('Пётр', 'user') RETURNING id`
    );
    const admin = rows[0].id;
    const petr = rows[1].id;
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, 'https://push.example/a', 'k', 's')`,
      [petr]
    );

    const отправлено = [];
    const app = createApp({ config, pool });
    // Каналы подменяются целиком: тест не должен ходить в сеть.
    app.locals.channels = { webpush: async (_, m) => отправлено.push(m) };
    finalize(app);

    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/lessons/docker-1`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${signSession({ userId: admin, role: 'admin' }, config.jwtSecret)}`
        },
        body: JSON.stringify({
          title: 'Docker, часть 1',
          description: 'Контейнеры',
          status: 'published',
          publishedAt: new Date().toISOString()
        })
      });
      assert.equal(res.status, 200);
    });

    assert.equal(отправлено.length, 1);
    assert.match(отправлено[0].title, /Docker/);
  });
});

test('повторное сохранение опубликованного урока не шлёт второй раз', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(
      `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin'), ('Пётр', 'user') RETURNING id`
    );
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, 'https://push.example/a', 'k', 's')`,
      [rows[1].id]
    );

    const отправлено = [];
    const app = createApp({ config, pool });
    app.locals.channels = { webpush: async (_, m) => отправлено.push(m) };
    finalize(app);

    await withServer(app, async (base) => {
      const тело = JSON.stringify({
        title: 'Docker, часть 1',
        status: 'published',
        publishedAt: new Date().toISOString()
      });
      const заголовки = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${signSession({ userId: rows[0].id, role: 'admin' }, config.jwtSecret)}`
      };
      await fetch(`${base}/api/lessons/docker-1`, { method: 'PUT', headers: заголовки, body: тело });
      await fetch(`${base}/api/lessons/docker-1`, { method: 'PUT', headers: заголовки, body: тело });
    });

    // Правка описания вышедшего урока — обычное дело; будить людей повторно
    // из-за неё нельзя. Защищает dedup_key вида lesson:<id>:published:<user>.
    assert.equal(отправлено.length, 1);
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/lesson-published.test.js`
Ожидается: FAIL — уведомления не отправляются, массив пуст.

- [ ] **Шаг 3: Собрать каналы в `src/app.js`**

```js
import { createWebPushChannel } from './services/notify/webpush.js';
import { createTelegramChannel } from './services/notify/telegram.js';

// ...внутри createApp, после app.locals.pool:
// Каналы собираются один раз на приложение: web-push настраивается глобально,
// а повторная настройка на каждый запрос — лишняя работа и лишний повод
// разойтись конфигурациям. Тест подменяет app.locals.channels целиком.
app.locals.channels = {
  webpush: createWebPushChannel(config, pool),
  telegram: createTelegramChannel(config)
};
```

- [ ] **Шаг 4: Разослать при публикации в `src/routes/lessons.js`**

```js
import { notify } from '../services/notify/index.js';

/**
 * Рассылает уведомление о вышедшем уроке всем, до кого есть чем достучаться.
 * Зачем отдельной функцией: то же самое понадобится воркеру на этапе 5, когда
 * урок будет публиковаться не руками, а концом конвейера.
 * Вызывается из обработчика PUT /api/lessons/:slug.
 */
async function разослатьОУроке(pool, channels, lesson, config) {
  const { rows } = await pool.query(
    `SELECT DISTINCT u.id FROM users u
      WHERE EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = u.id)
         OR EXISTS (SELECT 1 FROM identities i
                     WHERE i.user_id = u.id AND i.provider IN ('tg_widget', 'tg_miniapp', 'max_miniapp'))`
  );
  for (const { id } of rows) {
    await notify(
      pool,
      {
        userId: Number(id),
        kind: 'lesson_published',
        // Ключ несёт и урок, и человека: повторное сохранение карточки не
        // разбудит людей во второй раз.
        dedupKey: `lesson:${lesson.id}:published:${id}`,
        title: 'Новый урок',
        body: lesson.title,
        url: `/урок/${lesson.slug}`
      },
      channels
    );
  }
}

// ...в обработчике PUT /api/lessons/:slug, после сохранения:
if (lesson.status === 'published') {
  await разослатьОУроке(pool, req.app.locals.channels, lesson, config);
}
```

- [ ] **Шаг 5: Убедиться, что тесты проходят**

Выполнить: `npm test && npm run lint`
Ожидается: всё зелёное.

- [ ] **Шаг 6: Сгенерировать ключи VAPID и поднять**

```bash
npx web-push generate-vapid-keys
```

Положить в `.env` (`VAPID_PUBLIC`, `VAPID_PRIVATE`, `VAPID_SUBJECT`),
`docker compose up -d --build`.

Смена этих ключей обнуляет **все** подписки — генерируем один раз и больше
не трогаем.

- [ ] **Шаг 7: Проверить критерий приёмки на двух телефонах**

**Android:** открыть портал в Chrome → меню → «Установить приложение» →
запустить с домашнего экрана → войти → «включить уведомления» → разрешить.

**iPhone (проверять отдельно, там свои правила):** открыть в Safari →
«Поделиться» → «На экран Домой» → запустить **с домашнего экрана**. В Safari
Web Push работает только у установленного приложения — из браузера кнопка
подписки не сработает, и это не поломка.

С ноутбука опубликовать урок (`PUT /api/lessons/...` со `status: published`).
Пуш должен прийти на оба телефона.

Если не пришло: `docker compose logs api | grep -i push`, затем
`SELECT user_id, channel, kind FROM notifications ORDER BY id DESC LIMIT 10;`
— видно, выбран ли канал; `SELECT count(*) FROM push_subscriptions;` — видно,
дошла ли подписка вообще.

- [ ] **Шаг 8: Коммит**

```bash
git add src/app.js src/routes/lessons.js test/lesson-published.test.js
git commit -m "feat: уведомление о новом уроке подписчикам"
```

### Задача 21а: Уведомления об ответе на отзыв и о модерации

Добавлена 2026-09-02 по замечанию заказчика. Спека (§7) требует уведомлять
человека, когда ему **ответили на его комментарий**, а автора портала — когда
**пришёл комментарий на модерацию**. В первой редакции плана задачи под это не
было: этап 3 закрывал только «вышел новый урок». Пропуск закрывается здесь.

**Файлы:**
- Изменить: `src/routes/feedback.js`
- Создать: `test/comment-notify.test.js`

**Интерфейсы:**
- Потребляет: `notify` задачи 20, `addComment` задачи 15.
- Отдаёт дальше: при ответе на отзыв уведомление уходит автору родительского
  отзыва; при любом новом отзыве — каждому администратору.

- [ ] **Шаг 1: Написать падающий тест**

`test/comment-notify.test.js`:

```js
// Проверка второго и третьего поводов уведомить из спеки: ответили на отзыв —
// узнал автор отзыва; пришёл отзыв — узнал автор портала. Это тот сценарий,
// который заказчик описал словами «заполнил форму обратной связи, при ответе
// на его запрос пришло уведомление».
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveLesson } from '../src/services/lessons.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://portal.example.online',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', channelId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: 'mailto:a@b' }
};

function as(userId, role = 'user') {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${signSession({ userId, role }, config.jwtSecret)}`
  };
}

/** Три человека, урок и подписки на пуш у всех: канал должен найтись. */
async function seed(pool) {
  const lesson = await saveLesson(pool, {
    slug: 'docker-1',
    title: 'Docker',
    status: 'published',
    publishedAt: new Date()
  });
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role)
     VALUES ('Пётр', 'user'), ('Анна', 'user'), ('Автор', 'admin') RETURNING id`
  );
  const [petr, anna, admin] = rows.map((r) => Number(r.id));
  for (const [i, id] of [petr, anna, admin].entries()) {
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, 'k', 's')`,
      [id, `https://push.example/${i}`]
    );
  }
  return { lessonId: lesson.id, petr, anna, admin };
}

/** Приложение с подменёнными каналами: тест не ходит в сеть. */
function приложение(pool, отправлено) {
  const app = createApp({ config, pool });
  app.locals.channels = {
    webpush: async (подписки, message) =>
      отправлено.push({ endpoint: подписки[0].endpoint, message })
  };
  return finalize(app);
}

test('автор отзыва узнаёт об ответе на него', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, petr, admin } = await seed(pool);
    const отправлено = [];
    const app = приложение(pool, отправлено);

    await withServer(app, async (base) => {
      const первый = await (
        await fetch(`${base}/api/comments`, {
          method: 'POST',
          headers: as(petr),
          body: JSON.stringify({ objectType: 'lesson', objectId: lessonId, body: 'Вопрос' })
        })
      ).json();

      отправлено.length = 0; // Уведомления о самом отзыве проверяются отдельно.

      await fetch(`${base}/api/comments`, {
        method: 'POST',
        headers: as(admin, 'admin'),
        body: JSON.stringify({
          objectType: 'lesson',
          objectId: lessonId,
          parentId: первый.comment.id,
          body: 'Ответ'
        })
      });

      // Ушло автору вопроса, а не Анне, которая тут вообще ни при чём.
      const адресаты = отправлено.map((о) => о.endpoint);
      assert.ok(адресаты.includes('https://push.example/0'));
      assert.ok(!адресаты.includes('https://push.example/1'));
    });
  });
});

test('ответ самому себе не будит автора', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, petr } = await seed(pool);
    const отправлено = [];
    const app = приложение(pool, отправлено);

    await withServer(app, async (base) => {
      const первый = await (
        await fetch(`${base}/api/comments`, {
          method: 'POST',
          headers: as(petr),
          body: JSON.stringify({ objectType: 'lesson', objectId: lessonId, body: 'Вопрос' })
        })
      ).json();
      отправлено.length = 0;

      await fetch(`${base}/api/comments`, {
        method: 'POST',
        headers: as(petr),
        body: JSON.stringify({
          objectType: 'lesson',
          objectId: lessonId,
          parentId: первый.comment.id,
          body: 'Сам себе'
        })
      });

      assert.ok(!отправлено.some((о) => о.endpoint === 'https://push.example/0'));
    });
  });
});

test('новый отзыв уведомляет автора портала о модерации', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, petr } = await seed(pool);
    const отправлено = [];
    const app = приложение(pool, отправлено);

    await withServer(app, async (base) => {
      await fetch(`${base}/api/comments`, {
        method: 'POST',
        headers: as(petr),
        body: JSON.stringify({ objectType: 'lesson', objectId: lessonId, body: 'Вопрос' })
      });
    });

    assert.ok(отправлено.some((о) => о.endpoint === 'https://push.example/2'));
    assert.match(отправлено.find((о) => о.endpoint === 'https://push.example/2').message.title, /модерац/i);
  });
});

test('свой отзыв не зовёт автора портала на модерацию самого себя', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, admin } = await seed(pool);
    const отправлено = [];
    const app = приложение(pool, отправлено);

    await withServer(app, async (base) => {
      await fetch(`${base}/api/comments`, {
        method: 'POST',
        headers: as(admin, 'admin'),
        body: JSON.stringify({ objectType: 'lesson', objectId: lessonId, body: 'Заметка' })
      });
    });

    assert.equal(отправлено.length, 0);
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/comment-notify.test.js`
Ожидается: FAIL — массив уведомлений пуст, никто ничего не получил.

- [ ] **Шаг 3: Дописать `src/routes/feedback.js`**

```js
import { notify } from '../services/notify/index.js';

/**
 * Разбирает, кого затронул новый отзыв, и уведомляет их.
 *
 * Двое: автор отзыва, на который ответили, и автор портала — ему отзыв пришёл
 * на модерацию. Зачем в одной функции: оба уведомления рождаются из одного
 * события, и разнесённые по разным местам они разойдутся при первой же правке.
 * Себя не уведомляем ни в одной роли: человек знает, что он сейчас написал.
 * Вызывается из обработчика POST /api/comments.
 */
async function разослатьОбОтзыве(pool, channels, comment, объект) {
  if (comment.parentId) {
    const { rows } = await pool.query('SELECT user_id FROM comments WHERE id = $1', [
      comment.parentId
    ]);
    const адресат = rows.length ? Number(rows[0].user_id) : null;
    if (адресат && адресат !== comment.userId) {
      await notify(
        pool,
        {
          userId: адресат,
          kind: 'comment_reply',
          dedupKey: `comment:${comment.id}:reply:${адресат}`,
          title: 'Вам ответили',
          body: comment.body.slice(0, 200),
          url: объект.url
        },
        channels
      );
    }
  }

  const { rows: админы } = await pool.query(`SELECT id FROM users WHERE role = 'admin'`);
  for (const { id } of админы) {
    if (Number(id) === comment.userId) continue;
    await notify(
      pool,
      {
        userId: Number(id),
        kind: 'comment_moderation',
        dedupKey: `comment:${comment.id}:moderation:${id}`,
        title: 'Отзыв на модерацию',
        body: comment.body.slice(0, 200),
        url: объект.url
      },
      channels
    );
  }
}
```

В обработчике `POST /api/comments`, после создания комментария и до ответа:

```js
    // Адрес объекта нужен, чтобы нажатие на уведомление открыло ту самую
    // страницу, а не главную. Для урока это его карточка, для идеи — борд.
    const объект =
      objectType === 'lesson'
        ? await (async () => {
            const { rows } = await pool.query('SELECT slug FROM lessons WHERE id = $1', [objectId]);
            return { url: rows.length ? `/урок/${rows[0].slug}` : '/' };
          })()
        : { url: '/идеи' };

    await разослатьОбОтзыве(pool, req.app.locals.channels, comment, объект);
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Выполнить: `node --test test/comment-notify.test.js`
Ожидается: 4 теста PASS.

- [ ] **Шаг 5: Коммит**

```bash
git add src/routes/feedback.js test/comment-notify.test.js
git commit -m "feat: уведомления об ответе на отзыв и о новом отзыве на модерацию"
```


---

# Этап 4 — Борд идей

**Критерий приёмки заказчика:** с телефона предложил, со второго аккаунта
проголосовал, сменил статус — уведомление пришло.

Самый дешёвый в реализации кусок и лучший способ вернуть человека на портал:
всё нужное — таблицы, правило «один голос», слой уведомлений — уже готово
предыдущими этапами.

### Задача 22: Таблицы и сервис борда идей

**Файлы:**
- Создать: `migrations/006_ideas.sql`, `src/services/ideas.js`,
  `test/ideas-service.test.js`

**Интерфейсы:**
- Потребляет: `users`, `lessons`.
- Отдаёт дальше: `createIdea(pool, { userId, title, body })` → идея;
  `listIdeas(pool, { status, viewerId })` → массив
  `{ id, title, body, status, votes, votedByViewer, author, lessonSlug }`;
  `voteIdea(pool, { ideaId, userId })`, `unvoteIdea(pool, { ideaId, userId })`;
  `setIdeaStatus(pool, { ideaId, status, lessonSlug })` →
  `{ idea, voterIds }` — список проголосовавших нужен, чтобы их уведомить.

- [ ] **Шаг 1: Написать падающий тест**

`test/ideas-service.test.js`:

```js
// Проверка борда идей: один голос на человека, статусы меняются только по
// разрешённому списку, при закрытии идеи известно, кого уведомить.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createIdea,
  listIdeas,
  voteIdea,
  unvoteIdea,
  setIdeaStatus
} from '../src/services/ideas.js';
import { saveLesson } from '../src/services/lessons.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

async function seed(pool) {
  const { rows } = await pool.query(
    `INSERT INTO users (display_name) VALUES ('Пётр'), ('Анна') RETURNING id`
  );
  return { petr: Number(rows[0].id), anna: Number(rows[1].id) };
}

test('идея заводится со статусом «новая»', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr } = await seed(pool);
    const idea = await createIdea(pool, { userId: petr, title: 'Урок про очереди', body: '' });
    assert.equal(idea.status, 'new');
  });
});

test('голос считается один раз на человека', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr, anna } = await seed(pool);
    const idea = await createIdea(pool, { userId: petr, title: 'Про очереди', body: '' });
    await voteIdea(pool, { ideaId: idea.id, userId: anna });
    await voteIdea(pool, { ideaId: idea.id, userId: anna });
    const [сИдеей] = await listIdeas(pool, { viewerId: anna });
    assert.equal(сИдеей.votes, 1);
    assert.equal(сИдеей.votedByViewer, true);
  });
});

test('голос можно отозвать', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr, anna } = await seed(pool);
    const idea = await createIdea(pool, { userId: petr, title: 'Про очереди', body: '' });
    await voteIdea(pool, { ideaId: idea.id, userId: anna });
    await unvoteIdea(pool, { ideaId: idea.id, userId: anna });
    const [сИдеей] = await listIdeas(pool, { viewerId: anna });
    assert.equal(сИдеей.votes, 0);
    assert.equal(сИдеей.votedByViewer, false);
  });
});

test('смена статуса возвращает список проголосовавших', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr, anna } = await seed(pool);
    const idea = await createIdea(pool, { userId: petr, title: 'Про очереди', body: '' });
    await voteIdea(pool, { ideaId: idea.id, userId: anna });
    const { idea: обновлённая, voterIds } = await setIdeaStatus(pool, {
      ideaId: idea.id,
      status: 'accepted'
    });
    assert.equal(обновлённая.status, 'accepted');
    assert.deepEqual(voterIds, [anna]);
  });
});

test('вышедшая идея связывается с уроком', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr } = await seed(pool);
    await saveLesson(pool, {
      slug: 'очереди',
      title: 'Очереди',
      status: 'published',
      publishedAt: new Date()
    });
    const idea = await createIdea(pool, { userId: petr, title: 'Про очереди', body: '' });
    const { idea: закрытая } = await setIdeaStatus(pool, {
      ideaId: idea.id,
      status: 'released',
      lessonSlug: 'очереди'
    });
    assert.equal(закрытая.lessonSlug, 'очереди');
  });
});

test('неизвестный статус не принимается', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr } = await seed(pool);
    const idea = await createIdea(pool, { userId: petr, title: 'Про очереди', body: '' });
    await assert.rejects(setIdeaStatus(pool, { ideaId: idea.id, status: 'придумал' }), /статус/i);
  });
});

test('идея без темы не принимается', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr } = await seed(pool);
    await assert.rejects(createIdea(pool, { userId: petr, title: '  ', body: '' }), /тем/i);
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/ideas-service.test.js`
Ожидается: FAIL — модуль не найден.

- [ ] **Шаг 3: Написать `migrations/006_ideas.sql`**

```sql
-- Борд идей: что люди хотят увидеть в следующих уроках.
--
-- Зачем отдельно от комментариев: у идеи есть жизненный цикл (предложена →
-- принята → в работе → вышла) и голоса, а у комментария нет ни того, ни
-- другого. Втискивать это в comments значило бы завести там половину
-- неиспользуемых колонок.
-- Читается из src/services/ideas.js.

CREATE TABLE ideas (
  id         bigserial PRIMARY KEY,
  author_id  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      text NOT NULL,
  body       text NOT NULL DEFAULT '',
  status     text NOT NULL DEFAULT 'new'
               CHECK (status IN ('new', 'accepted', 'in_progress', 'released')),
  -- Урок, которым идея закрыта. Появляется вместе со статусом released:
  -- человеку, голосовавшему за тему, нужна ссылка, а не слово «вышло».
  lesson_id  bigint REFERENCES lessons(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE idea_votes (
  idea_id    bigint NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Первичный ключ из пары и есть правило «один голос на человека»:
  -- накрутить голоса повторными нажатиями нельзя даже в обход кода.
  PRIMARY KEY (idea_id, user_id)
);
```

- [ ] **Шаг 4: Написать `src/services/ideas.js`**

```js
// Борд идей: предложить, проголосовать, сменить статус.
//
// Задача — вести список тем для будущих уроков и знать, кого касается каждое
// изменение. Зачем setIdeaStatus возвращает проголосовавших: уведомление о
// смене статуса — обещание, данное людям в спеке, и список адресатов известен
// только здесь; собирать его отдельным запросом в маршруте значит однажды
// поменять статус и забыть уведомить.
// Вызывается из src/routes/ideas.js и src/routes/pages.js.
import { PublicError } from '../middleware/errors.js';

// Порядок соответствует пути идеи от предложения до вышедшего урока.
const СТАТУСЫ = ['new', 'accepted', 'in_progress', 'released'];

const MAX_TITLE_LENGTH = 200;

function toIdea(row) {
  return {
    id: Number(row.id),
    title: row.title,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
    votes: Number(row.votes ?? 0),
    votedByViewer: Boolean(row.voted_by_viewer),
    lessonSlug: row.lesson_slug ?? null,
    author: row.display_name ? { id: Number(row.author_id), displayName: row.display_name } : null
  };
}

/** Принимает идею от вошедшего человека. */
export async function createIdea(pool, { userId, title, body }) {
  const тема = String(title ?? '').trim();
  if (!тема) throw new PublicError('У идеи должна быть тема');
  if (тема.length > MAX_TITLE_LENGTH) throw new PublicError('Тема слишком длинная');

  const { rows } = await pool.query(
    `INSERT INTO ideas (author_id, title, body) VALUES ($1, $2, COALESCE($3, ''))
     RETURNING id, title, body, status, created_at, author_id`,
    [userId, тема, String(body ?? '').trim()]
  );
  return toIdea({ ...rows[0], display_name: null });
}

/** Борд целиком: свежие сверху, самые желанные видно по счётчику голосов. */
export async function listIdeas(pool, { status = null, viewerId = null } = {}) {
  const { rows } = await pool.query(
    `SELECT i.id, i.title, i.body, i.status, i.created_at, i.author_id,
            u.display_name, l.slug AS lesson_slug,
            count(v.user_id)::int AS votes,
            bool_or(v.user_id = $2::bigint) AS voted_by_viewer
       FROM ideas i
       JOIN users u ON u.id = i.author_id
       LEFT JOIN lessons l ON l.id = i.lesson_id
       LEFT JOIN idea_votes v ON v.idea_id = i.id
      WHERE ($1::text IS NULL OR i.status = $1)
      GROUP BY i.id, u.display_name, l.slug
      ORDER BY count(v.user_id) DESC, i.created_at DESC`,
    [status, viewerId]
  );
  return rows.map(toIdea);
}

/** Голос за идею. Повтор безвреден: пара уже есть, вставка ничего не меняет. */
export async function voteIdea(pool, { ideaId, userId }) {
  await pool.query(
    'INSERT INTO idea_votes (idea_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [ideaId, userId]
  );
}

/** Отзыв голоса. */
export async function unvoteIdea(pool, { ideaId, userId }) {
  await pool.query('DELETE FROM idea_votes WHERE idea_id = $1 AND user_id = $2', [ideaId, userId]);
}

/**
 * Меняет статус идеи и говорит, кого об этом надо уведомить.
 * lessonSlug задаётся вместе со статусом released — идея закрывается ссылкой
 * на вышедший урок.
 */
export async function setIdeaStatus(pool, { ideaId, status, lessonSlug = null }) {
  if (!СТАТУСЫ.includes(status)) throw new PublicError('Неизвестный статус идеи');

  const { rows } = await pool.query(
    `UPDATE ideas
        SET status = $2,
            lesson_id = COALESCE((SELECT id FROM lessons WHERE slug = $3), lesson_id)
      WHERE id = $1
      RETURNING id, title, body, status, created_at, author_id`,
    [ideaId, status, lessonSlug]
  );
  if (!rows.length) throw new PublicError('Идея не найдена', 404);

  const { rows: голоса } = await pool.query(
    'SELECT user_id FROM idea_votes WHERE idea_id = $1 ORDER BY user_id',
    [ideaId]
  );

  return {
    idea: toIdea({ ...rows[0], display_name: null, lesson_slug: lessonSlug }),
    voterIds: голоса.map((r) => Number(r.user_id))
  };
}
```

- [ ] **Шаг 5: Убедиться, что тесты проходят**

Выполнить: `node --test test/ideas-service.test.js`
Ожидается: 7 тестов PASS.

- [ ] **Шаг 6: Коммит**

```bash
git add migrations/006_ideas.sql src/services/ideas.js test/ideas-service.test.js
git commit -m "feat: борд идей — предложения, голоса, статусы"
```

### Задача 23: API борда и уведомления голосовавшим

**Файлы:**
- Создать: `src/routes/ideas.js`, `test/ideas-routes.test.js`
- Изменить: `src/app.js`

**Интерфейсы:**
- Потребляет: сервис задачи 22, `notify` задачи 20, защиты задачи 11.
- Отдаёт дальше: `GET /api/ideas`, `POST /api/ideas`, `POST /api/ideas/:id/vote`,
  `DELETE /api/ideas/:id/vote`, `POST /api/ideas/:id/status` (админ).

- [ ] **Шаг 1: Написать падающий тест**

`test/ideas-routes.test.js`:

```js
// Проверка борда поверх HTTP. Последний тест — дословный критерий приёмки:
// предложил, проголосовал вторым аккаунтом, сменил статус — уведомление ушло.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://portal.example.nip.io',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', channelId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: 'mailto:a@b' }
};

function as(userId, role = 'user') {
  return { Authorization: `Bearer ${signSession({ userId, role }, config.jwtSecret)}` };
}

async function seed(pool) {
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role)
     VALUES ('Пётр', 'user'), ('Анна', 'user'), ('Автор', 'admin') RETURNING id`
  );
  // У Анны есть подписка на пуш — значит уведомление ей есть чем доставить.
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, 'https://push.example/anna', 'k', 's')`,
    [rows[1].id]
  );
  return { petr: Number(rows[0].id), anna: Number(rows[1].id), admin: Number(rows[2].id) };
}

test('гость идею не предлагает', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/ideas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Про очереди' })
      });
      assert.equal(res.status, 401);
    });
  });
});

test('статус меняет только автор портала', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const created = await (
        await fetch(`${base}/api/ideas`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...as(petr) },
          body: JSON.stringify({ title: 'Про очереди' })
        })
      ).json();
      const res = await fetch(`${base}/api/ideas/${created.idea.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...as(petr) },
        body: JSON.stringify({ status: 'accepted' })
      });
      assert.equal(res.status, 403);
    });
  });
});

test('предложил, проголосовал, сменил статус — уведомление ушло', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr, anna, admin } = await seed(pool);
    const отправлено = [];
    const app = createApp({ config, pool });
    app.locals.channels = { webpush: async (_, m) => отправлено.push(m) };
    finalize(app);

    await withServer(app, async (base) => {
      const created = await (
        await fetch(`${base}/api/ideas`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...as(petr) },
          body: JSON.stringify({ title: 'Урок про очереди' })
        })
      ).json();

      await fetch(`${base}/api/ideas/${created.idea.id}/vote`, {
        method: 'POST',
        headers: as(anna)
      });

      const res = await fetch(`${base}/api/ideas/${created.idea.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...as(admin, 'admin') },
        body: JSON.stringify({ status: 'accepted' })
      });
      assert.equal(res.status, 200);
    });

    assert.equal(отправлено.length, 1);
    assert.match(отправлено[0].body, /Урок про очереди/);
  });
});

test('повторная смена статуса на тот же не будит людей снова', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr, anna, admin } = await seed(pool);
    const отправлено = [];
    const app = createApp({ config, pool });
    app.locals.channels = { webpush: async (_, m) => отправлено.push(m) };
    finalize(app);

    await withServer(app, async (base) => {
      const created = await (
        await fetch(`${base}/api/ideas`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...as(petr) },
          body: JSON.stringify({ title: 'Урок про очереди' })
        })
      ).json();
      await fetch(`${base}/api/ideas/${created.idea.id}/vote`, { method: 'POST', headers: as(anna) });
      const заголовки = { 'Content-Type': 'application/json', ...as(admin, 'admin') };
      const тело = JSON.stringify({ status: 'accepted' });
      await fetch(`${base}/api/ideas/${created.idea.id}/status`, { method: 'POST', headers: заголовки, body: тело });
      await fetch(`${base}/api/ideas/${created.idea.id}/status`, { method: 'POST', headers: заголовки, body: тело });
    });

    assert.equal(отправлено.length, 1);
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/ideas-routes.test.js`
Ожидается: FAIL — 404 на `/api/ideas`.

- [ ] **Шаг 3: Написать `src/routes/ideas.js`**

```js
// API борда идей. Задача — принять идею и голос от вошедшего, дать автору
// портала менять статус и не забыть уведомить тех, кто голосовал. Зачем
// уведомление живёт здесь, а не в сервисе: сервис не знает про каналы, а
// маршрут знает — каналы лежат в app.locals.
// Подключается в src/app.js по префиксу /api.
import { Router } from 'express';
import { createIdea, listIdeas, voteIdea, unvoteIdea, setIdeaStatus } from '../services/ideas.js';
import { notify } from '../services/notify/index.js';
import { requireUser, requireAdmin } from '../middleware/guards.js';

// Что человек прочитает в уведомлении о смене статуса. Слово «accepted» на
// экране телефона не объясняет ничего.
const ПОДПИСИ_СТАТУСОВ = {
  new: 'снова открыта',
  accepted: 'принята в работу',
  in_progress: 'уже снимается',
  released: 'вышла уроком'
};

export function ideaRoutes(config, pool) {
  const router = Router();

  router.get('/ideas', async (req, res) => {
    const ideas = await listIdeas(pool, {
      status: req.query.status ? String(req.query.status) : null,
      viewerId: req.user?.id ?? null
    });
    res.json({ ideas });
  });

  router.post('/ideas', requireUser, async (req, res) => {
    const idea = await createIdea(pool, {
      userId: req.user.id,
      title: req.body?.title,
      body: req.body?.body
    });
    res.status(201).json({ idea });
  });

  router.post('/ideas/:id/vote', requireUser, async (req, res) => {
    await voteIdea(pool, { ideaId: Number(req.params.id), userId: req.user.id });
    res.json({ ok: true });
  });

  router.delete('/ideas/:id/vote', requireUser, async (req, res) => {
    await unvoteIdea(pool, { ideaId: Number(req.params.id), userId: req.user.id });
    res.json({ ok: true });
  });

  router.post('/ideas/:id/status', requireAdmin, async (req, res) => {
    const { idea, voterIds } = await setIdeaStatus(pool, {
      ideaId: Number(req.params.id),
      status: req.body?.status,
      lessonSlug: req.body?.lessonSlug ?? null
    });

    for (const userId of voterIds) {
      await notify(
        pool,
        {
          userId,
          kind: 'idea_status',
          // Ключ включает статус: каждая смена уведомляет один раз, а повтор
          // того же статуса — ни разу.
          dedupKey: `idea:${idea.id}:${idea.status}:${userId}`,
          title: `Идея ${ПОДПИСИ_СТАТУСОВ[idea.status]}`,
          body: idea.title,
          url: idea.lessonSlug ? `/урок/${idea.lessonSlug}` : '/идеи'
        },
        req.app.locals.channels
      );
    }

    res.json({ idea });
  });

  return router;
}
```

Подключить в `src/app.js`: `app.use('/api', ideaRoutes(config, pool));`.

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Выполнить: `npm test && npm run lint`
Ожидается: всё зелёное.

- [ ] **Шаг 5: Коммит**

```bash
git add src/routes/ideas.js src/app.js test/ideas-routes.test.js
git commit -m "feat: API борда идей с уведомлением голосовавших"
```

### Задача 24: Страница борда и сдача этапа

**Файлы:**
- Создать: `src/views/ideas.js`, `test/ideas-page.test.js`
- Изменить: `src/routes/pages.js`, `public/app.js`, `public/styles.css`

**Интерфейсы:**
- Отдаёт дальше: `GET /идеи` — борд с формой предложения и кнопками голосования.

- [ ] **Шаг 1: Написать падающий тест**

`test/ideas-page.test.js`:

```js
// Проверка страницы борда: идеи видны всем, форма предложения — только
// вошедшим, тексты от людей экранируются.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { createIdea } from '../src/services/ideas.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://portal.example.nip.io',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', channelId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: 'mailto:a@b' }
};

test('борд виден гостю, но форма ему не предлагается', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(`INSERT INTO users (display_name) VALUES ('Пётр') RETURNING id`);
    await createIdea(pool, { userId: rows[0].id, title: 'Урок про очереди', body: '' });
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (await fetch(`${base}/идеи`)).text();
      assert.match(html, /Урок про очереди/);
      assert.match(html, /Войдите/);
      assert.ok(!html.includes('id="форма-идеи"'));
    });
  });
});

test('вошедшему показывается форма', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(`INSERT INTO users (display_name) VALUES ('Пётр') RETURNING id`);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (
        await fetch(`${base}/идеи`, {
          headers: {
            Authorization: `Bearer ${signSession({ userId: rows[0].id, role: 'user' }, config.jwtSecret)}`
          }
        })
      ).text();
      assert.match(html, /id="форма-идеи"/);
    });
  });
});

test('тема идеи с разметкой экранируется', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(`INSERT INTO users (display_name) VALUES ('Пётр') RETURNING id`);
    await createIdea(pool, { userId: rows[0].id, title: '<img src=x onerror=alert(1)>', body: '' });
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (await fetch(`${base}/идеи`)).text();
      assert.ok(!html.includes('<img src=x'));
      assert.match(html, /&lt;img/);
    });
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/ideas-page.test.js`
Ожидается: FAIL — 404 на `/идеи`.

- [ ] **Шаг 3: Написать `src/views/ideas.js`**

```js
// Страница борда идей. Задача — показать список тем с голосами и дать
// вошедшему предложить свою. Зачем статус подписывается словами: «accepted»
// в списке ничего не говорит человеку, который зашёл проголосовать.
// Вызывается из src/routes/pages.js по маршруту /идеи.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';

const ПОДПИСИ_СТАТУСОВ = {
  new: 'новая',
  accepted: 'принята',
  in_progress: 'в работе',
  released: 'вышла'
};

function карточкаИдеи(idea) {
  const ссылкаНаУрок = idea.lessonSlug
    ? ` — <a href="/урок/${encodeURIComponent(idea.lessonSlug)}">смотреть урок</a>`
    : '';
  return `<li class="идея" data-идея="${idea.id}">
  <button class="голос${idea.votedByViewer ? ' отдан' : ''}" data-голос="${idea.id}">
    ▲ <span>${idea.votes}</span>
  </button>
  <div>
    <h3>${escapeHtml(idea.title)}</h3>
    ${idea.body ? `<p>${escapeHtml(idea.body)}</p>` : ''}
    <p class="мета">${ПОДПИСИ_СТАТУСОВ[idea.status]}${ссылкаНаУрок}</p>
  </div>
</li>`;
}

export function ideasPage({ config, ideas, user }) {
  return layout({
    config,
    user,
    title: 'Идеи для уроков',
    description: 'Предложите тему следующего урока и поддержите чужие идеи голосом.',
    body: `
<h1>Идеи для уроков</h1>
<p>Предложите тему или поддержите чужую. За идею, которая вышла уроком, приходит уведомление.</p>
${
  user
    ? `<form id="форма-идеи">
         <input name="title" placeholder="О чём снять урок?" maxlength="200" required>
         <textarea name="body" placeholder="Подробности, если нужны"></textarea>
         <button type="submit">Предложить</button>
       </form>`
    : '<p><a href="/login">Войдите</a>, чтобы предлагать идеи и голосовать.</p>'
}
<ul class="борд">${ideas.map(карточкаИдеи).join('') || '<li>Пока пусто. Будьте первым.</li>'}</ul>
`
  });
}
```

- [ ] **Шаг 4: Дописать маршрут и клиент**

В `src/routes/pages.js`:

```js
import { listIdeas } from '../services/ideas.js';
import { ideasPage } from '../views/ideas.js';

router.get('/идеи', async (req, res) => {
  const user = await текущий(pool, req);
  const ideas = await listIdeas(pool, { viewerId: req.user?.id ?? null });
  res.type('html').send(ideasPage({ config, ideas, user }));
});
```

В `public/app.js` дописать:

```js
// Борд идей. Счётчик правится на месте, без перезагрузки: голосуют подряд за
// несколько идей, и перезагрузка на каждый голос сбрасывала бы прокрутку.
for (const кнопка of document.querySelectorAll('[data-голос]')) {
  кнопка.addEventListener('click', async () => {
    const отдан = кнопка.classList.contains('отдан');
    const ответ = await запрос(`/api/ideas/${кнопка.dataset.голос}/vote`, {
      method: отдан ? 'DELETE' : 'POST'
    });
    if (!ответ) return;
    const счётчик = кнопка.querySelector('span');
    счётчик.textContent = Number(счётчик.textContent) + (отдан ? -1 : 1);
    кнопка.classList.toggle('отдан');
  });
}

const формаИдеи = document.querySelector('#форма-идеи');
формаИдеи?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const данные = new FormData(формаИдеи);
  const ответ = await запрос('/api/ideas', {
    method: 'POST',
    body: JSON.stringify({ title: данные.get('title'), body: данные.get('body') })
  });
  // Здесь перезагрузка уместна: идея видна сразу, и человек должен увидеть
  // её в списке на своём месте по числу голосов.
  if (ответ) location.reload();
});
```

- [ ] **Шаг 5: Убедиться, что тесты проходят**

Выполнить: `npm test && npm run lint`
Ожидается: всё зелёное, ни одного пропущенного теста при заданном
`TEST_DATABASE_URL`.

- [ ] **Шаг 6: Проверить критерий приёмки**

```bash
docker compose up -d --build
```

Дословно по формулировке заказчика:

1. **С телефона** (из установленного приложения) предложить идею.
2. **Со второго аккаунта** (другой браузер или инкогнито, вход другим
   способом) проголосовать за неё.
3. С ноутбука под админом сменить статус:
   `POST /api/ideas/<id>/status` с `{"status":"accepted"}`.
4. На втором аккаунте приходит уведомление. Если у второго аккаунта нет
   подписки на пуш, но есть привязанный Telegram — приходит сообщение ботом;
   это и есть работа слоя каналов.
5. Повторить шаг 3 с тем же статусом — второго уведомления **нет**.

- [ ] **Шаг 7: Коммит и отметка сдачи**

```bash
git add src/views/ideas.js src/routes/pages.js public/app.js public/styles.css \
        test/ideas-page.test.js
git commit -m "feat: страница борда идей"

git tag -a этап-4 -m "Портал и приложение: витрина, вход, PWA, борд идей"
```

---

## Что после этапа 4

У заказчика на руках живой портал с приложением на телефоне. Дальше —
автоматизация, и она начинается с новой порции плана: этапы 5–6 (конвейер
обработки видео). Писать её нужно **после** сдачи этого плана, опираясь на то,
что уже проверено руками, а не на предположения.

К моменту начала этапа 5 понадобится:

- поднять контейнер `worker` и подключить общий `redis` (`REDIS_URL`,
  `REDIS_PREFIX` уже есть в `.env.example`);
- решить открытый вопрос спеки — чем расшифровывать речь и генерировать тексты.
  По умолчанию заложены Яндекс SpeechKit и YandexGPT; решение принимается
  после прогона настоящего урока и оценки результата глазами.

**Точка невозврата, о которой стоит помнить уже сейчас.** Установленная PWA и
подписки Web Push привязаны к origin. День, когда приложение уйдёт людям, —
последний день, когда домен можно сменить бесплатно: после смены адреса
приложение и подписки обрываются у всех разом, и переустанавливать придётся
каждому вручную. Домен стоит купить до того, как портал покажут аудитории.

---

## Проверка плана на полноту

Сверено со спекой после написания.

**Покрытие спеки этапами 0–4.** Разделы 3 (ограничения среды), 4 (архитектура,
кроме воркера), 5 (модель данных в части пользователей, контента, обратной
связи, уведомлений и идей), 6 (авторизация — две механики из трёх), 7
(уведомления целиком), 10 (борд идей), 11 (соглашения по коду) закрыты
задачами 1–24.

**Осознанно не закрыто на этих этапах** — по самой спеке это работа этапов 5–10:

| Из спеки | Когда |
|---|---|
| `transcripts`, `transcript_segments`, `assets`, поиск по урокам | Этап 5 |
| `platform_accounts`, `metrics`, `external_comments`, `short_links`, `link_hits` | Этапы 7 и 9 |
| Контейнер `worker`, очередь BullMQ, Redis | Этап 5 |
| Адаптеры площадок и три режима публикации | Этапы 7–8 |
| Вход через VK и Яндекс | Отдельная задача после этапа 4: механика та же, что у Google, — адреса и названия полей другие |
| Мини-приложения Telegram и MAX (`tg_miniapp`, `max_miniapp`) | Этап 10; провайдеры уже заведены в таблице `identities`, канал MAX уже предусмотрен слоем уведомлений |

**Сквозная проверка имён.** `createApp`/`finalize`, `loadConfig`, `createPool`,
`runMigrations`, `withServer`/`withTestDb`/`skipWithoutDb`, `PublicError`,
`resolveIdentity`, `signSession`/`verifySession`/`signShortLived`/
`verifyShortLived`, `verifyTelegramWidget`, `googleRedirectUri`/
`buildConsentUrl`/`fetchGoogleProfile`, `escapeHtml`/`layout`,
`listLessons`/`getLessonBySlug`/`saveLesson`/`setLessonTags`/`listNews`,
`setReaction`/`removeReaction`/`countReactions`/`getViewerReaction`/`addComment`/
`listComments`/`moderateComment`, `notify`/`createWebPushChannel`/`createTelegramChannel`,
`createIdea`/`listIdeas`/`voteIdea`/`unvoteIdea`/`setIdeaStatus` —
названия и сигнатуры совпадают между задачей, где объявлены, и задачами,
где используются.
