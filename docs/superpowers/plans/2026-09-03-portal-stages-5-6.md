# Портал видеоуроков, этапы 5–6 — план работ

> **Для исполнителя (агента или человека):** ОБЯЗАТЕЛЬНАЯ ПОДСКИЛЛ:
> `superpowers:subagent-driven-development` (рекомендуется) или
> `superpowers:executing-plans`. Задачи выполняются по одной, шаги отмечаются
> галочками `- [ ]`. Не переходить к следующей задаче, пока тесты текущей не
> зелёные и коммит не сделан.

**Цель.** Автор загружает исходник урока один раз — система сама делает
расшифровку, субтитры, тексты, вертикальные нарезки и кадр на обложку, а затем
показывает всё это автору на экране проверки. Наружу до его нажатия не уходит
ничего.

**Архитектура.** Появляется второй контейнер — `worker`: тот же образ, что и
`api`, но с ffmpeg и другой командой запуска. Работа идёт очередью **BullMQ**
поверх общего Redis с префиксом `portal:`. Каждый шаг конвейера — отдельная
задача, результат которой сразу ложится в базу: упавшая на середине расшифровка
при повторе доделывается с места обрыва, а не начинается заново. На двух ядрах
иначе неприемлемо.

**Стек.** К уже работающему добавляются: `bullmq`, `ioredis`, ffmpeg и
whisper.cpp в образе воркера. Внешних платных сервисов в конвейере нет —
расшифровка считается на самой машине.

**Спека.** `docs/superpowers/specs/2026-09-01-portal-design.md` — разделы 3
(ограничения среды), 5 (модель данных), 8 (путь урока). План опирается на неё
и спорит с ней только там, где это записано ниже.

**Предыдущая порция.** `docs/superpowers/plans/2026-09-02-portal-stages-0-4.md`
— этапы 0–4 сданы 2026-09-03, кроме отмеченного там непроверенным.

---

## Глобальные требования

Действуют в каждой задаче, повторяться в них не будут. Дополняют, а не
заменяют требования плана этапов 0–4.

- **Имена — только латиницей**: переменные, функции, классы CSS, `data-`
  атрибуты, переменные CSS, ветки, файлы. **Комментарии и тексты для человека
  — на русском.** Правило записано в `CLAUDE.md` после того, как первая
  редакция была написана русскими именами и её пришлось переводить целиком.
- **Комментарии по трём вопросам**: какую задачу выполняет, зачем нужен, кто
  вызывает. Обязателен для файла, функции, сервиса; для настроек и чисел с
  неочевидным смыслом.
- Тесты — `node:test`, запуск `npm test` **в несколько потоков**: гонки между
  файлами на двух ядрах не проявляются, а на сборщике GitHub роняют прогон.
- Проверка перед фиксацией — обе команды разом, как записано в `CLAUDE.md`.
- Секреты только из окружения; новая переменная добавляется в `.env.example`
  тем же коммитом, что и код, который её читает.
- Миграции — версионированные файлы, применяются при старте. Следующая
  свободная — `008`.
- **Клиентский код с первой строки снабжается обратной связью.** Полоска
  сообщений (`toast`) и отправка текста сбоя в журнал (`reportError`) уже
  есть — пользоваться ими везде, где действие человека может не получиться.
  Молчащий отказ на этапах 0–4 стоил трёх кругов переписки.

## Ограничения машины — не пожелания, а рамки

| Ресурс | Есть | Следствие для плана |
|---|---|---|
| Ядра | 2 | Воркер обрабатывает **одну** задачу за раз (`concurrency: 1`). Параллельная нарезка двух уроков положит и портал, и соседние проекты |
| Память | 3.9 ГБ, свободно ~1.5 ГБ | ffmpeg запускается с `nice`, потоковой обработкой, без промежуточных распаковок в память |
| Диск | 34 ГБ свободно | Буфер чистится по сроку (`MEDIA_TTL_HOURS`, по умолчанию неделя). Исходник часового урока — 1–3 ГБ, поэтому больше двух-трёх уроков в буфере не держим |
| GPU | нет | Расшифровка только внешним сервисом. Локальный Whisper на двух ядрах идёт со скоростью реального времени и выводит машину из строя на час |

## Решения, принятые до написания плана

| Вопрос | Решение | Почему |
|---|---|---|
| Как исходник попадает на сервер | **Два пути: Яндекс Диск по OAuth и загрузка из браузера.** Кусками по 8 МБ, с продолжением после обрыва | Решение заказчика от 2026-09-03, оба пути. Диск снимает главное узкое место — домашний исходящий канал: сервер забирает файл из дата-центра, а не с домашнего интернета. Он же даёт архив исходников, которого у портала нет и быть не должно, и делает автоудаление буфера безопасным — оригинал остаётся у заказчика. Загрузка из браузера остаётся запасным путём |
| Доступ к Диску — OAuth или публичная ссылка | **OAuth.** Заказчик завёл приложение 2026-09-03 | Изначально в плане стояла публичная ссылка — чтобы не просить доступ ко всему Диску. Заказчик выбрал OAuth, и это оказалось правильнее: публичная ссылка делает **невышедший** урок доступным всякому, кто её увидит, а токен — нет. Плюс появляется выбор файла списком прямо в кабинете. Цена: токен нужно хранить, а значит шифровать |
| Где хранится токен Диска | В базе, зашифрованным ключом `TOKEN_ENCRYPTION_KEY` | Требование спеки к токенам площадок, здесь то же самое: чужой долгоживущий токен открытым текстом в базе — это доступ к диску заказчика для всякого, кто получит дамп |
| Чем расшифровывать | **whisper.cpp на самом сервере** | Решение заказчика от 2026-09-03: платного облака не будет, только хранилища. Спека этот путь отвергала — «на двух ядрах идёт со скоростью реального времени и выводит машину из строя на час», — но тот запрет писался в предположении, что расшифровка блокирует работу. У нас очередь, одна задача за раз и пониженный приоритет; уроки выходят раз в неделю, и ночная обработка никому не мешает. Цена: качество ниже облачного, особенно на терминах и именах |
| Какая модель | **small, квантованная (q5_1)**, ~190 МБ | На машине 1,4 ГБ свободной памяти. `medium` не влезает вовсе, `base` заметно хуже на русском. Квантованная `small` — единственная точка, где качество ещё приемлемо, а память ещё есть |
| Где живёт модель | В томе, скачивается при первом запуске | В образе она добавила бы 190 МБ к каждой сборке и к каждой выкатке |
| Чем генерировать тексты | **Пока ничем: заголовок и описание пишет автор** | Модель для этого требует того же облака, которого не будет. Экран проверки даёт расшифровку и главы, размеченные по паузам, — по ним человек пишет заголовок быстрее, чем правит машинный. Генерацию добавим, когда заказчик решит, чем |
| Где хранятся файлы | Каталог из `MEDIA_DIR`, том docker | Буфер, а не архив: спека прямо запрещает хранить видеоархив |

Поставщик скрыт за тонким слоем: смена — правка одного файла, а не переделка
конвейера. Окончательное решение по спеке принимается **после прогона
настоящего урока и оценки результата глазами** — то есть после задачи 9.

## Структура файлов

```
Dockerfile                       + установка ffmpeg в образ
docker-compose.yml               + сервис worker
migrations/
  008_pipeline.sql               assets, transcripts, transcript_segments, поля урока
  009_transcript_search.sql      полнотекстовый индекс по сегментам

src/
  queue.js                       подключение к очереди, имена задач
  worker.js                      точка входа воркера
  jobs/
    extract-audio.js             исходник → звуковая дорожка
    transcribe.js                звук → транскрипт и сегменты
    subtitles.js                 сегменты → .srt и .vtt
    generate-texts.js            транскрипт → заголовки, описание, теги, главы
    make-clips.js                главы → вертикальные нарезки со субтитрами
    make-cover.js                кадр на обложку
    cleanup-media.js             удаление файлов, переживших срок
  lib/
    ffmpeg.js                    запуск ffmpeg: аргументы, ограничения, разбор ошибок
    media-token.js               временная ссылка на файл буфера
    srt.js                       сборка .srt и .vtt из сегментов
  services/
    speech/index.js              тонкий слой: расшифровка и генерация текстов
    speech/yandex.js             реализация для Яндекса
    media.js                     учёт файлов буфера: путь, вид, срок
    pipeline.js                  состояния урока и порядок шагов
  routes/
    upload.js                    загрузка кусками
    admin.js                     экран проверки, запуск и повтор шагов
    search.js                    поиск по транскриптам
  views/
    admin-upload.js              страница загрузки
    admin-review.js              экран проверки
    search.js                    страница результатов поиска
public/
  admin.js                       загрузка кусками и экран проверки в браузере

test/                            по файлу на модуль
```

---

# Этап 5 — конвейер, текст

**Критерий приёмки заказчика:** залил настоящий урок — через минуты есть
субтитры и три заголовка; поиск слова из середины урока ведёт на нужную секунду.

### Задача 1: Воркер и очередь

**Файлы:**
- Создать: `src/queue.js`, `src/worker.js`, `test/queue.test.js`
- Изменить: `Dockerfile`, `docker-compose.yml`, `.env.example`

**Интерфейсы:**
- Отдаёт дальше: `createQueue(config)` → объект BullMQ `Queue`;
  `createWorker(config, handlers)` → `Worker`; `JOBS` — словарь имён задач
  (`extractAudio`, `transcribe`, `subtitles`, `generateTexts`, `makeClips`,
  `makeCover`, `cleanupMedia`).

- [ ] **Шаг 1: Написать падающий тест**

`test/queue.test.js`:

```js
// Проверка очереди. Очередь — единственное место, где приложение и воркер
// договариваются: перепутанное имя задачи означает, что она никогда не
// выполнится, и заметить это можно только по неработающему уроку.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JOBS, queueName } from '../src/queue.js';

test('имена задач заданы явно и не повторяются', () => {
  const names = Object.values(JOBS);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes('extractAudio'));
  assert.ok(names.includes('transcribe'));
});

test('очередь живёт под префиксом портала', () => {
  // Redis общий на весь сервер: без префикса задачи портала смешались бы с
  // чужими, и `redis-cli keys *` перестал бы что-либо значить.
  assert.equal(queueName({ redis: { prefix: 'portal:' } }), 'portal:pipeline');
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/queue.test.js`
Ожидается: FAIL — `Cannot find module .../src/queue.js`.

- [ ] **Шаг 3: Написать `src/queue.js`**

```js
// Очередь обработки уроков.
//
// Задача — дать приложению и воркеру одно место, где записаны имена задач и
// параметры подключения. Зачем очередь вообще: шаги конвейера идут минутами
// и часами, а HTTP-запрос столько не живёт; кроме того, упавший шаг должен
// повторяться сам, с нарастающей паузой.
// Вызывается из src/app.js (постановка задач) и src/worker.js (исполнение).
import { Queue, Worker } from 'bullmq';

/**
 * Имена шагов конвейера. Строками, а не свободным текстом по месту:
 * опечатка в имени означает задачу, которая никогда не выполнится.
 */
export const JOBS = {
  extractAudio: 'extractAudio',
  transcribe: 'transcribe',
  subtitles: 'subtitles',
  generateTexts: 'generateTexts',
  makeClips: 'makeClips',
  makeCover: 'makeCover',
  cleanupMedia: 'cleanupMedia',
  fetchSource: 'fetchSource'
};

/** Одна очередь на весь конвейер: шаги идут по очереди, а не наперегонки. */
export function queueName(config) {
  return `${config.redis.prefix}pipeline`;
}

/** Параметры подключения к общему Redis. */
function connection(config) {
  return { url: config.redis.url, maxRetriesPerRequest: null };
}

/**
 * Настройки повторов. Шаги конвейера падают из-за чужой сети и чужих квот,
 * поэтому повтор обязателен, а пауза растёт: три попытки с 30 секунд.
 */
const RETRY = { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } };

export function createQueue(config) {
  return new Queue(queueName(config), { connection: connection(config), defaultJobOptions: RETRY });
}

/**
 * Создаёт исполнителя задач.
 * concurrency: 1 — не оптимизация, а рамка: на двух ядрах параллельная
 * обработка двух уроков положит и портал, и соседние проекты на этом сервере.
 */
export function createWorker(config, handlers) {
  return new Worker(
    queueName(config),
    async (job) => {
      const handler = handlers[job.name];
      if (!handler) throw new Error(`Неизвестная задача: ${job.name}`);
      return handler(job.data, job);
    },
    { connection: connection(config), concurrency: 1 }
  );
}
```

- [ ] **Шаг 4: Написать `src/worker.js`**

```js
// Точка входа воркера. Задача — поднять исполнителя очереди и держать его
// живым. Зачем отдельный процесс, а не поток внутри api: ffmpeg на часовом
// ролике занимает ядро целиком, и внутри api он тормозил бы каждую страницу.
// Запускается командой `node src/worker.js` из CMD образа воркера.
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createWorker, JOBS } from './queue.js';

const config = loadConfig();
const pool = createPool(config.db);

// Обработчики появляются по мере готовности шагов; пустой список означает,
// что воркер поднят, но делать ему пока нечего.
const handlers = {};

const worker = createWorker(config, handlers);

worker.on('failed', (job, err) => {
  console.error(`Задача ${job?.name} упала: ${err.message}`);
});
worker.on('completed', (job) => {
  console.log(`Задача ${job.name} выполнена`);
});

console.log(`Воркер поднят, известные шаги: ${Object.values(JOBS).join(', ')}`);

// Закрываем аккуратно: docker шлёт SIGTERM, и незакрытая задача иначе
// останется висеть в очереди «в работе» до истечения блокировки.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    await worker.close();
    await pool.end();
    process.exit(0);
  });
}
```

- [ ] **Шаг 5: Добавить ffmpeg в образ и воркер в компоуз**

`Dockerfile` — во второй ступени, до `USER node`:

```dockerfile
# ffmpeg нужен воркеру: извлечение звука, нарезка, кадр на обложку. В образе
# api он лишний, но два разных образа ради 135 МБ — лишняя сущность в сборке
# и в CI; проще один образ с двумя командами запуска.
RUN apk add --no-cache ffmpeg
```

`docker-compose.yml` — новый сервис:

```yaml
  worker:
    build: .
    restart: unless-stopped
    env_file: .env
    # Тот же образ, другая команда: воркер не слушает порт, он разбирает очередь.
    command: ["node", "src/worker.js"]
    volumes:
      # Буфер общий с api: api принимает загрузку, воркер её обрабатывает.
      - portal_media:/app/media
```

Сервису `api` добавить тот же том:

```yaml
    volumes:
      - portal_media:/app/media
```

И в конец файла:

```yaml
volumes:
  portal_db:
  portal_media:
```

В `ClaudeDocker/projects/my_portal/docker-compose.yml` — воркеру те же сети:

```yaml
  worker:
    networks:
      - claude-net
      - data
```

- [ ] **Шаг 6: Убедиться, что тесты проходят и воркер поднимается**

```bash
docker run --rm -v "$PWD":/app -w /app node:24-alpine sh -c 'npm install bullmq ioredis --silent && npm test'
docker compose up -d --build
docker compose logs worker | tail -3
```

Ожидается: тесты зелёные; в журнале воркера — «Воркер поднят, известные шаги: …».

- [ ] **Шаг 7: Коммит**

```bash
git add src/queue.js src/worker.js test/queue.test.js Dockerfile docker-compose.yml \
        package.json package-lock.json
git commit -m "feat: воркер и очередь обработки уроков"
```

### Задача 2: Таблицы конвейера

**Файлы:**
- Создать: `migrations/008_pipeline.sql`, `test/migrations-pipeline.test.js`

**Интерфейсы:**
- Отдаёт дальше: `assets` (id, lesson_id, kind, path, bytes, expires_at,
  created_at), `transcripts` (lesson_id, text, provider, created_at),
  `transcript_segments` (id, lesson_id, started_ms, ended_ms, text),
  поля урока `pipeline_state`, `pipeline_error`, `source_asset_id`,
  `generated` (jsonb с вариантами заголовков, описанием, тегами, главами).

- [ ] **Шаг 1: Написать падающий тест**

`test/migrations-pipeline.test.js`:

```js
// Проверка таблиц конвейера. Здесь важны две вещи: срок жизни файла
// обязателен (буфер обязан чиститься сам) и удаление урока не оставляет
// осиротевших файлов и сегментов.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

async function lesson(pool) {
  const { rows } = await pool.query(
    `INSERT INTO lessons (slug, title) VALUES ('urok', 'Урок') RETURNING id`
  );
  return rows[0].id;
}

test('у файла буфера обязателен срок жизни', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const id = await lesson(pool);
    await assert.rejects(
      pool.query(
        `INSERT INTO assets (lesson_id, kind, path, bytes) VALUES ($1, 'source', '/a', 1)`,
        [id]
      ),
      /null value|not-null/i
    );
  });
});

test('вид файла ограничен списком', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const id = await lesson(pool);
    await assert.rejects(
      pool.query(
        `INSERT INTO assets (lesson_id, kind, path, bytes, expires_at)
         VALUES ($1, 'что-то', '/a', 1, now())`,
        [id]
      ),
      /check constraint|нарушает/i
    );
  });
});

test('удаление урока уносит файлы, транскрипт и сегменты', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const id = await lesson(pool);
    await pool.query(
      `INSERT INTO assets (lesson_id, kind, path, bytes, expires_at)
       VALUES ($1, 'source', '/a', 1, now() + interval '1 day')`,
      [id]
    );
    await pool.query(`INSERT INTO transcripts (lesson_id, text) VALUES ($1, 'текст')`, [id]);
    await pool.query(
      `INSERT INTO transcript_segments (lesson_id, started_ms, ended_ms, text)
       VALUES ($1, 0, 1000, 'слово')`,
      [id]
    );
    await pool.query('DELETE FROM lessons WHERE id = $1', [id]);
    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM assets) + (SELECT count(*) FROM transcripts)
            + (SELECT count(*) FROM transcript_segments) AS n`
    );
    assert.equal(Number(rows[0].n), 0);
  });
});

test('транскрипт у урока один', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const id = await lesson(pool);
    await pool.query(`INSERT INTO transcripts (lesson_id, text) VALUES ($1, 'раз')`, [id]);
    await assert.rejects(
      pool.query(`INSERT INTO transcripts (lesson_id, text) VALUES ($1, 'два')`, [id]),
      /duplicate key|unique/i
    );
  });
});

test('состояние конвейера ограничено списком', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const id = await lesson(pool);
    await assert.rejects(
      pool.query(`UPDATE lessons SET pipeline_state = 'летит' WHERE id = $1`, [id]),
      /check constraint|нарушает/i
    );
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/migrations-pipeline.test.js`
Ожидается: FAIL — `relation "assets" does not exist`.

- [ ] **Шаг 3: Написать `migrations/008_pipeline.sql`**

```sql
-- Конвейер обработки урока: файлы буфера, расшифровка, состояние.
--
-- Главное решение здесь — срок жизни у каждого файла. Портал видеоархива не
-- держит: исходник часового урока весит гигабайты, а на машине 34 ГБ. Файл без
-- срока однажды переполнит диск и положит все проекты сервера, поэтому колонка
-- обязательна на уровне базы, а не на честном слове кода.
-- Читается из src/services/media.js и задач в src/jobs/.

CREATE TABLE assets (
  id         bigserial PRIMARY KEY,
  lesson_id  bigint NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('source', 'audio', 'clip', 'subtitles', 'cover')),
  -- Путь внутри буфера, относительно MEDIA_DIR. Абсолютный сюда не кладём:
  -- каталог задаётся окружением и на другой машине будет другим.
  path       text NOT NULL,
  bytes      bigint NOT NULL,
  -- Срок жизни. Исходник переживает публикацию на несколько дней — на случай
  -- переделки нарезок; обложка и субтитры живут дольше, они лёгкие.
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX assets_lesson_idx ON assets (lesson_id);
CREATE INDEX assets_expires_idx ON assets (expires_at);

-- Цельный текст расшифровки. Один на урок: вторая расшифровка того же урока
-- заменяет первую, а не копится рядом.
CREATE TABLE transcripts (
  lesson_id  bigint PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,
  text       text NOT NULL,
  -- Кем расшифровано: пригодится, когда поставщик сменится и понадобится
  -- понять, почему старые уроки распознаны иначе.
  provider   text NOT NULL DEFAULT 'yandex',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Отрезки с таймкодами. Ради них расшифровка и нужна: поиск слова ведёт на
-- нужную секунду урока, а не на урок целиком.
CREATE TABLE transcript_segments (
  id         bigserial PRIMARY KEY,
  lesson_id  bigint NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  started_ms integer NOT NULL,
  ended_ms   integer NOT NULL,
  text       text NOT NULL,
  CONSTRAINT segment_order CHECK (ended_ms >= started_ms)
);

CREATE INDEX transcript_segments_lesson_idx ON transcript_segments (lesson_id, started_ms);

ALTER TABLE lessons
  -- Где урок сейчас. Отдельно от status: status — это то, что видит зритель,
  -- а pipeline_state — что происходит внутри, и путать их нельзя.
  ADD COLUMN pipeline_state text NOT NULL DEFAULT 'idle'
    CHECK (pipeline_state IN ('idle', 'uploading', 'processing', 'review', 'failed')),
  -- Текст последней ошибки конвейера: в кабинете он показывается автору, а не
  -- прячется в журнале контейнера.
  ADD COLUMN pipeline_error text,
  ADD COLUMN source_asset_id bigint REFERENCES assets(id) ON DELETE SET NULL,
  -- Что придумала модель: три заголовка, описание, теги, главы с таймкодами.
  -- Одним полем jsonb, потому что это черновик для человека, а не данные, по
  -- которым мы ищем и соединяем.
  ADD COLUMN generated jsonb NOT NULL DEFAULT '{}'::jsonb;
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Выполнить: `node --test test/migrations-pipeline.test.js`
Ожидается: 5 тестов PASS.

- [ ] **Шаг 5: Коммит**

```bash
git add migrations/008_pipeline.sql test/migrations-pipeline.test.js
git commit -m "feat: таблицы конвейера — файлы буфера, расшифровка, состояние"
```

### Задача 3: Учёт файлов буфера

**Файлы:**
- Создать: `src/services/media.js`, `test/media-service.test.js`
- Изменить: `.env.example`

**Интерфейсы:**
- Потребляет: таблицу `assets`, `config.media`.
- Отдаёт дальше: `mediaPath(config, relative)` → абсолютный путь;
  `registerAsset(pool, config, { lessonId, kind, relativePath, bytes })` →
  `{ id, path, expiresAt }`; `listExpired(pool)` → массив просроченных;
  `forgetAsset(pool, id)`; `assetById(pool, id)`.
  Сроки: `source` — `MEDIA_TTL_HOURS`, `audio` — вдвое меньше, `clip` —
  `MEDIA_TTL_HOURS`, `subtitles` и `cover` — вдесятеро дольше.

- [ ] **Шаг 1: Написать падающий тест**

`test/media-service.test.js`:

```js
// Проверка учёта буфера. Срок жизни считается здесь, и ошибка в нём означает
// либо переполненный диск, либо файлы, исчезнувшие раньше, чем автор успел
// ими воспользоваться.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mediaPath,
  registerAsset,
  listExpired,
  forgetAsset,
  assetById
} from '../src/services/media.js';
import { saveLesson } from '../src/services/lessons.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = { media: { dir: '/app/media', ttlHours: 168 } };

test('путь собирается от каталога буфера', () => {
  assert.equal(mediaPath(config, 'lesson-1/source.mp4'), '/app/media/lesson-1/source.mp4');
});

test('выход за пределы буфера не допускается', () => {
  // Иначе имя файла из запроса могло бы увести запись в любое место диска.
  assert.throws(() => mediaPath(config, '../../etc/passwd'), /за пределы/i);
});

test('лёгкие файлы живут дольше тяжёлых', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'u', title: 'Урок' });
    const source = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'source',
      relativePath: 'u/source.mp4',
      bytes: 1_000_000_000
    });
    const cover = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'cover',
      relativePath: 'u/cover.jpg',
      bytes: 100_000
    });
    // Исходник весит гигабайты и уходит первым; обложка лёгкая и нужна
    // карточке урока долго после публикации.
    assert.ok(cover.expiresAt > source.expiresAt);
  });
});

test('просроченные находятся, живые — нет', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'u', title: 'Урок' });
    const live = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'source',
      relativePath: 'u/live.mp4',
      bytes: 1
    });
    await pool.query(`INSERT INTO assets (lesson_id, kind, path, bytes, expires_at)
                      VALUES ($1, 'source', 'u/old.mp4', 1, now() - interval '1 hour')`,
                     [lesson.id]);
    const expired = await listExpired(pool);
    assert.equal(expired.length, 1);
    assert.equal(expired[0].path, 'u/old.mp4');
    assert.ok(await assetById(pool, live.id));
  });
});

test('забытый файл исчезает из учёта', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'u', title: 'Урок' });
    const asset = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'audio',
      relativePath: 'u/audio.ogg',
      bytes: 1
    });
    await forgetAsset(pool, asset.id);
    assert.equal(await assetById(pool, asset.id), null);
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/media-service.test.js`
Ожидается: FAIL — модуль не найден.

- [ ] **Шаг 3: Написать `src/services/media.js`**

```js
// Учёт файлов рабочего буфера.
//
// Задача — знать, какой файл к какому уроку относится и когда его удалять.
// Зачем отдельным сервисом: срок жизни считается в одном месте, иначе
// исходники начнут переживать нарезки, а диск на 34 ГБ переполнится за
// десяток уроков и положит все проекты сервера.
// Вызывается из src/routes/upload.js и задач в src/jobs/.
import path from 'node:path';
import { PublicError } from '../middleware/errors.js';

/**
 * Сколько живёт файл каждого вида, в долях от MEDIA_TTL_HOURS.
 * Исходник и нарезки весят гигабайты — уходят первыми. Субтитры и обложка
 * лёгкие и нужны карточке урока долго после публикации.
 */
const TTL_SHARE = { source: 1, audio: 0.5, clip: 1, subtitles: 10, cover: 10 };

/**
 * Абсолютный путь к файлу буфера.
 * Проверка на выход за пределы обязательна: имя файла приходит из запроса, и
 * без неё «../../» увело бы запись в любое место диска.
 */
export function mediaPath(config, relative) {
  const root = path.resolve(config.media.dir);
  const full = path.resolve(root, relative);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new PublicError('Путь ведёт за пределы буфера', 400);
  }
  return full;
}

/** Записывает файл в учёт и назначает ему срок. */
export async function registerAsset(pool, config, { lessonId, kind, relativePath, bytes }) {
  const hours = config.media.ttlHours * (TTL_SHARE[kind] ?? 1);
  const { rows } = await pool.query(
    `INSERT INTO assets (lesson_id, kind, path, bytes, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' hours')::interval)
     RETURNING id, path, expires_at`,
    [lessonId, kind, relativePath, bytes, String(hours)]
  );
  return { id: Number(rows[0].id), path: rows[0].path, expiresAt: rows[0].expires_at };
}

/** Файлы, переживших свой срок. Их удаляет задача cleanupMedia. */
export async function listExpired(pool) {
  const { rows } = await pool.query(
    'SELECT id, lesson_id, kind, path FROM assets WHERE expires_at < now() ORDER BY id'
  );
  return rows.map((r) => ({
    id: Number(r.id),
    lessonId: Number(r.lesson_id),
    kind: r.kind,
    path: r.path
  }));
}

/** Убирает файл из учёта. Сам файл удаляет вызывающий. */
export async function forgetAsset(pool, id) {
  await pool.query('DELETE FROM assets WHERE id = $1', [id]);
}

/** Один файл по номеру. null, если его уже нет. */
export async function assetById(pool, id) {
  const { rows } = await pool.query(
    'SELECT id, lesson_id, kind, path, bytes, expires_at FROM assets WHERE id = $1',
    [id]
  );
  if (!rows.length) return null;
  return {
    id: Number(rows[0].id),
    lessonId: Number(rows[0].lesson_id),
    kind: rows[0].kind,
    path: rows[0].path,
    bytes: Number(rows[0].bytes),
    expiresAt: rows[0].expires_at
  };
}
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Выполнить: `node --test test/media-service.test.js`
Ожидается: 5 тестов PASS.

- [ ] **Шаг 5: Коммит**

```bash
git add src/services/media.js test/media-service.test.js
git commit -m "feat: учёт файлов буфера со сроком жизни"
```

### Задача 4: Загрузка исходника кусками

**Файлы:**
- Создать: `src/routes/upload.js`, `test/upload-routes.test.js`
- Изменить: `src/app.js`

**Интерфейсы:**
- Потребляет: `registerAsset`, `mediaPath`, `requireAdmin`.
- Отдаёт дальше: `POST /api/upload/init` → `{ uploadId, chunkSize, received }`;
  `PUT /api/upload/:uploadId/:index` — кусок; `POST /api/upload/:uploadId/finish`
  → `{ asset: { id, bytes } }`; `GET /api/upload/:uploadId` → `{ received }`
  для продолжения после обрыва.

- [ ] **Шаг 1: Написать падающий тест**

`test/upload-routes.test.js`:

```js
// Проверка загрузки кусками. Гигабайтный файл одним запросом рвётся на первой
// же потере связи и начинается заново — поэтому куски и учёт принятого.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveLesson } from '../src/services/lessons.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

async function makeConfig() {
  return {
    publicBaseUrl: 'https://soloaijourney.online',
    jwtSecret: 'x'.repeat(32),
    adminIdentities: [],
    telegram: { botToken: '', botId: '', botUsername: '' },
    google: { clientId: '', clientSecret: '' },
    vapid: { publicKey: '', privateKey: '', subject: '' },
    redis: { url: 'redis://redis:6379', prefix: 'portal:' },
    media: { dir: await mkdtemp(path.join(tmpdir(), 'portal-media-')), ttlHours: 168 }
  };
}

function asAdmin(config, userId) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${signSession({ userId, role: 'admin' }, config.jwtSecret)}`
  };
}

async function seed(pool) {
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  return { lessonId: lesson.id, adminId: Number(rows[0].id) };
}

test('гость загрузить не может', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/upload/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ lessonId: 1, fileName: 'a.mp4', bytes: 10 })
      });
      assert.equal(res.status, 401);
    });
  });
});

test('файл собирается из кусков в правильном порядке', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lessonId, adminId } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const parts = ['первый-', 'второй-', 'третий'];
      const bytes = parts.join('').length;

      const init = await (
        await fetch(`${base}/api/upload/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...asAdmin(config, adminId) },
          body: JSON.stringify({ lessonId, fileName: 'урок.mp4', bytes })
        })
      ).json();
      assert.ok(init.uploadId);

      for (const [index, part] of parts.entries()) {
        const res = await fetch(`${base}/api/upload/${init.uploadId}/${index}`, {
          method: 'PUT',
          headers: asAdmin(config, adminId),
          body: part
        });
        assert.equal(res.status, 200);
      }

      const done = await (
        await fetch(`${base}/api/upload/${init.uploadId}/finish`, {
          method: 'POST',
          headers: asAdmin(config, adminId)
        })
      ).json();

      assert.equal(done.asset.bytes, bytes);
      const { rows } = await pool.query('SELECT path FROM assets WHERE id = $1', [done.asset.id]);
      const собранное = await readFile(path.join(config.media.dir, rows[0].path), 'utf8');
      assert.equal(собранное, parts.join(''));
    });
  });
});

test('после обрыва видно, сколько кусков уже принято', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lessonId, adminId } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const init = await (
        await fetch(`${base}/api/upload/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...asAdmin(config, adminId) },
          body: JSON.stringify({ lessonId, fileName: 'урок.mp4', bytes: 30 })
        })
      ).json();

      await fetch(`${base}/api/upload/${init.uploadId}/0`, {
        method: 'PUT',
        headers: asAdmin(config, adminId),
        body: 'кусок'
      });

      const state = await (
        await fetch(`${base}/api/upload/${init.uploadId}`, { headers: asAdmin(config, adminId) })
      ).json();
      // Клиент по этому списку понимает, с какого куска продолжать.
      assert.deepEqual(state.received, [0]);
    });
  });
});

test('чужое имя файла не уводит запись за пределы буфера', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lessonId, adminId } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/upload/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...asAdmin(config, adminId) },
        body: JSON.stringify({ lessonId, fileName: '../../../etc/passwd', bytes: 10 })
      });
      const init = await res.json();
      // Имя обеззараживается, а не отвергается: человек не виноват, что его
      // файл называется странно.
      assert.ok(!init.fileName?.includes('..'));
      assert.equal(res.status, 200);
    });
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/upload-routes.test.js`
Ожидается: FAIL — 404 на `/api/upload/init`.

- [ ] **Шаг 3: Написать `src/routes/upload.js`**

```js
// Загрузка исходника кусками.
//
// Задача — принять гигабайтный файл так, чтобы обрыв связи не начинал всё
// заново. Куски пишутся в отдельный каталог, а на finish склеиваются в один
// файл. Зачем не одним запросом: на часовом ролике потеря связи почти
// гарантирована, а повтор с нуля по мобильной сети — час впустую.
//
// Зачем свой велосипед вместо готовой библиотеки: протокол здесь — три
// маршрута и счётчик принятых кусков, а любая библиотека тянет своё
// хранилище, свои сессии и свои представления о путях.
// Подключается в src/app.js по префиксу /api/upload.
import { Router } from 'express';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat, open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { requireAdmin } from '../middleware/guards.js';
import { PublicError } from '../middleware/errors.js';
import { mediaPath, registerAsset } from '../services/media.js';

// Размер куска. Восемь мегабайт: меньше — слишком много запросов на часовой
// ролик, больше — обрыв стоит дороже, а память nginx и node расходуется зря.
const CHUNK_SIZE = 8 * 1024 * 1024;

/**
 * Приводит имя файла к безопасному виду.
 * Имя приходит из браузера и попадает в путь на диске: без обеззараживания
 * «../../» увёл бы запись куда угодно. Зачем сохранять расширение: по нему
 * ffmpeg понимает формат без лишних догадок.
 * Вызывается из обработчика init.
 */
function safeName(raw) {
  const base = path.basename(String(raw ?? 'source'));
  const clean = base.replace(/[^\w.\-]+/g, '_').slice(-80);
  return clean || 'source';
}

export function uploadRoutes(config, pool) {
  const router = Router();

  // Все маршруты загрузки только для автора портала: исходники грузит он один.
  router.use(requireAdmin);

  router.post('/init', async (req, res) => {
    const { lessonId, fileName, bytes } = req.body ?? {};
    if (!lessonId || !bytes) throw new PublicError('Не указан урок или размер файла');

    const uploadId = randomUUID();
    const name = safeName(fileName);
    await mkdir(mediaPath(config, `uploads/${uploadId}`), { recursive: true });
    // Имя файла и урок держим рядом с кусками: перезапуск приложения не должен
    // терять начатую загрузку.
    await mkdir(mediaPath(config, `uploads/${uploadId}/meta`), { recursive: true });
    const meta = await open(mediaPath(config, `uploads/${uploadId}/meta/info.json`), 'w');
    await meta.writeFile(JSON.stringify({ lessonId, fileName: name, bytes }));
    await meta.close();

    res.json({ uploadId, chunkSize: CHUNK_SIZE, fileName: name, received: [] });
  });

  router.get('/:uploadId', async (req, res) => {
    res.json({ received: await receivedChunks(config, req.params.uploadId) });
  });

  router.put('/:uploadId/:index', async (req, res) => {
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0) throw new PublicError('Неверный номер куска');

    const target = mediaPath(config, `uploads/${req.params.uploadId}/${index}.part`);
    // Пишем потоком: кусок в восемь мегабайт незачем держать в памяти целиком,
    // особенно когда её полтора гигабайта на всю машину.
    await pipeline(req, createWriteStream(target));
    res.json({ ok: true });
  });

  router.post('/:uploadId/finish', async (req, res) => {
    const { uploadId } = req.params;
    const info = JSON.parse(
      await (await open(mediaPath(config, `uploads/${uploadId}/meta/info.json`), 'r')).readFile(
        'utf8'
      )
    );

    const dir = `lesson-${info.lessonId}`;
    await mkdir(mediaPath(config, dir), { recursive: true });
    const relative = `${dir}/${info.fileName}`;
    const full = mediaPath(config, relative);

    // Склейка потоком, кусок за куском по возрастанию номера: держать
    // гигабайтный файл в памяти нельзя.
    const indexes = await receivedChunks(config, uploadId);
    const out = createWriteStream(full);
    for (const index of indexes) {
      const part = await open(mediaPath(config, `uploads/${uploadId}/${index}.part`), 'r');
      await pipeline(part.createReadStream(), out, { end: false });
      await part.close();
    }
    out.end();
    await new Promise((resolve) => out.on('close', resolve));

    await rm(mediaPath(config, `uploads/${uploadId}`), { recursive: true, force: true });

    const { size } = await stat(full);
    const asset = await registerAsset(pool, config, {
      lessonId: info.lessonId,
      kind: 'source',
      relativePath: relative,
      bytes: size
    });
    await pool.query(
      `UPDATE lessons SET source_asset_id = $1, pipeline_state = 'processing', pipeline_error = NULL
        WHERE id = $2`,
      [asset.id, info.lessonId]
    );

    res.json({ asset: { id: asset.id, bytes: size } });
  });

  return router;
}

/**
 * Номера уже принятых кусков, по возрастанию.
 * Нужны дважды: клиенту — чтобы продолжить с места обрыва, и склейке — чтобы
 * собрать файл в правильном порядке. Вызывается из обоих мест.
 */
async function receivedChunks(config, uploadId) {
  try {
    const names = await readdir(mediaPath(config, `uploads/${uploadId}`));
    return names
      .filter((n) => n.endsWith('.part'))
      .map((n) => Number(n.replace('.part', '')))
      .filter(Number.isInteger)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}
```

Подключить в `src/app.js`, до `express.json` для этого префикса — тело кусков
не JSON:

```js
import { uploadRoutes } from './routes/upload.js';

// Куски загрузки приходят потоком, а не JSON: разбор тела здесь только
// помешал бы. Поэтому маршруты загрузки идут ДО express.json.
app.use('/api/upload', express.json({ limit: '4kb' }), uploadRoutes(config, pool));
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Выполнить: `node --test test/upload-routes.test.js`
Ожидается: 4 теста PASS.

Если тест склейки падает с пустым файлом — `express.json` перехватил тело
куска. Проверить порядок: `uploadRoutes` подключается со своим разбором тела,
а глобальный `express.json` в `createApp` не должен стоять раньше.

- [ ] **Шаг 5: Коммит**

```bash
git add src/routes/upload.js src/app.js test/upload-routes.test.js
git commit -m "feat: загрузка исходника кусками с продолжением после обрыва"
```

### Задача 5: Страница загрузки в кабинете

**Файлы:**
- Создать: `src/views/admin-upload.js`, `public/admin.js`, `test/admin-upload.test.js`
- Изменить: `src/routes/pages.js`, `public/styles.css`

**Интерфейсы:**
- Потребляет: маршруты загрузки задачи 4.
- Отдаёт дальше: `GET /admin/upload` — страница с выбором файла и полосой
  выполнения; функция `uploadFile(file, lessonId, onProgress)` в `public/admin.js`.

- [ ] **Шаг 1: Написать падающий тест**

`test/admin-upload.test.js`:

```js
// Страница загрузки доступна только автору портала: исходники грузит он один,
// а гостю здесь нечего делать даже посмотреть.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://soloaijourney.online',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', botId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: '' },
  media: { dir: '/tmp', ttlHours: 168 }
};

async function open(pool, role) {
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Кто-то', $1) RETURNING id`,
    [role]
  );
  const app = finalize(createApp({ config, pool }));
  return withServer(app, async (base) => {
    const res = await fetch(`${base}/admin/upload`, {
      headers: {
        Accept: 'text/html',
        Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role }, config.jwtSecret)}`
      }
    });
    return { status: res.status, html: await res.text() };
  });
}

test('автор портала видит страницу загрузки', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const r = await open(pool, 'admin');
    assert.equal(r.status, 200);
    assert.match(r.html, /id="upload-form"/);
    assert.match(r.html, /accept="video\//);
  });
});

test('обычному пользователю страница закрыта', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const r = await open(pool, 'user');
    assert.equal(r.status, 403);
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/admin-upload.test.js`
Ожидается: FAIL — 404 на `/admin/upload`.

- [ ] **Шаг 3: Написать `src/views/admin-upload.js`**

```js
// Страница загрузки исходника.
//
// Задача — дать автору выбрать файл на компьютере и увидеть, как идёт
// загрузка. Зачем полоса выполнения обязательна: гигабайтный файл идёт
// минутами, и страница без признаков жизни выглядит зависшей — человек
// закрывает вкладку и теряет уже загруженное.
// Вызывается из src/routes/pages.js по адресу /admin/upload.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';

export function adminUploadPage({ config, user, lessons }) {
  const options = lessons
    .map((l) => `<option value="${l.id}">${escapeHtml(l.title)}</option>`)
    .join('');

  return layout({
    config,
    user,
    path: '/admin/upload',
    title: 'Загрузка урока — Solo AI Journey',
    description: 'Загрузка исходника урока в обработку.',
    body: `
<h1>Загрузка урока</h1>
<p class="lead">Файл идёт кусками: если связь оборвётся, загрузка продолжится
с места обрыва, а не с начала. Вкладку можно свернуть, но не закрывать.</p>

<form id="upload-form" class="card">
  <label>Урок
    <select name="lessonId" required>${options || '<option value="">сначала заведите урок</option>'}</select>
  </label>
  <label>Файл
    <input type="file" name="file" accept="video/*" required>
  </label>
  <div class="form-row">
    <span class="hint" id="upload-status">Файл не выбран</span>
    <button class="button-brand" type="submit">Загрузить</button>
  </div>
  <progress id="upload-progress" max="100" value="0" hidden></progress>
</form>`
  });
}
```

- [ ] **Шаг 4: Написать клиент `public/admin.js`**

```js
/* Кабинет автора: загрузка исходника кусками.
 *
 * Задача — переслать файл по частям и показать, сколько уже ушло. Зачем не
 * одним запросом: гигабайтный файл рвётся на первой потере связи, и повтор с
 * нуля стоит человеку часа.
 * Подключается из src/views/admin-upload.js.
 */
import { toast } from './app.js';

/**
 * Отправляет файл кусками, продолжая с места обрыва.
 * onProgress получает долю от 0 до 1 — им живёт полоса выполнения.
 * Вызывается из обработчика формы ниже.
 */
export async function uploadFile(file, lessonId, onProgress) {
  const init = await fetch('/api/upload/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lessonId, fileName: file.name, bytes: file.size })
  }).then((r) => r.json());

  const total = Math.ceil(file.size / init.chunkSize);
  // Уже принятые куски пропускаем: это и есть продолжение после обрыва.
  const done = new Set(init.received ?? []);

  for (let index = 0; index < total; index += 1) {
    if (done.has(index)) continue;
    const from = index * init.chunkSize;
    const chunk = file.slice(from, from + init.chunkSize);
    const res = await fetch(`/api/upload/${init.uploadId}/${index}`, {
      method: 'PUT',
      body: chunk
    });
    if (!res.ok) throw new Error(`кусок ${index + 1} из ${total} не принят`);
    onProgress((index + 1) / total);
  }

  const finished = await fetch(`/api/upload/${init.uploadId}/finish`, { method: 'POST' });
  if (!finished.ok) throw new Error('файл не собрался на сервере');
  return finished.json();
}

const form = document.querySelector('#upload-form');
form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = form.querySelector('input[type=file]').files[0];
  const lessonId = Number(form.querySelector('select').value);
  if (!file || !lessonId) return;

  const status = document.querySelector('#upload-status');
  const progress = document.querySelector('#upload-progress');
  const button = form.querySelector('button');
  button.disabled = true;
  progress.hidden = false;

  try {
    await uploadFile(file, lessonId, (share) => {
      progress.value = Math.round(share * 100);
      status.textContent = `Загружено ${progress.value}%`;
    });
    status.textContent = 'Загружено. Урок ушёл в обработку.';
    toast('Файл принят, обработка началась.');
  } catch (error) {
    status.textContent = `Не дошло: ${error.message}`;
    toast(`Загрузка прервалась: ${error.message}. Выберите тот же файл — продолжим с места обрыва.`, true);
  } finally {
    button.disabled = false;
  }
});
```

- [ ] **Шаг 5: Подключить страницу**

В `src/routes/pages.js`:

```js
import { adminUploadPage } from '../views/admin-upload.js';
import { requireAdmin } from '../middleware/guards.js';
import { listLessons } from '../services/lessons.js';

router.get('/admin/upload', requireAdmin, async (req, res) => {
  const user = await currentUser(pool, req);
  const lessons = await listLessons(pool, { includeDrafts: true });
  res.type('html').send(adminUploadPage({ config, user, lessons }));
});
```

В `src/views/admin-upload.js` подключить второй скрипт, дописав в `layout`
поддержку дополнительных скриптов, либо добавив прямо в тело страницы:
`<script src="/admin.js" type="module"></script>`.

В `public/styles.css` добавить оформление формы:

```css
#upload-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 34rem;
}
#upload-form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
  color: var(--muted);
}
#upload-form select,
#upload-form input[type='file'] {
  font: inherit;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 10px;
  min-height: var(--tap-target);
}
#upload-progress {
  width: 100%;
  height: 8px;
}
```

- [ ] **Шаг 6: Убедиться, что тесты проходят**

Выполнить: `npm test`
Ожидается: все PASS.

- [ ] **Шаг 7: Коммит**

```bash
git add src/views/admin-upload.js public/admin.js src/routes/pages.js \
        public/styles.css test/admin-upload.test.js
git commit -m "feat: страница загрузки исходника в кабинете"
```

### Задача 5а: Подключение Яндекс Диска и выбор файла

Переписана 2026-09-03: заказчик завёл приложение в Яндекс OAuth, поэтому вместо
публичной ссылки — доступ по токену. Так невышедший урок не приходится делать
доступным всякому, кто увидит ссылку.

**Файлы:**
- Создать: `migrations/010_integrations.sql`, `src/lib/secrets.js`,
  `src/services/disk.js`, `src/routes/integrations.js`,
  `src/jobs/fetch-source.js`, `test/secrets.test.js`, `test/disk.test.js`
- Изменить: `src/config.js`, `src/app.js`, `src/views/admin-upload.js`,
  `public/admin.js`, `.env.example`

**Интерфейсы:**
- Отдаёт дальше: `encryptSecret(text, key)` / `decryptSecret(box, key)`;
  `saveIntegration(pool, config, { name, token, expiresAt })`,
  `loadIntegration(pool, config, name)` → `{ token }` или `null`;
  `listDiskFiles(token, path, fetchImpl)` → `[{ name, path, bytes, modified }]`;
  `diskDownloadUrl(token, path, fetchImpl)` → прямой адрес;
  `GET /api/integrations/yandex-disk/connect`,
  `GET /api/integrations/yandex-disk/callback`,
  `GET /api/integrations/yandex-disk/files?path=…`;
  обработчик `fetchSource({ lessonId, diskPath })`.

- [ ] **Шаг 1: Написать падающий тест на шифрование**

`test/secrets.test.js`:

```js
// Шифрование чужих токенов. Токен Диска — это доступ ко всему диску
// заказчика: открытым текстом в базе он превращает любой дамп в утечку.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret } from '../src/lib/secrets.js';

const key = 'a'.repeat(64); // 32 байта в hex

test('зашифрованное расшифровывается обратно', () => {
  const box = encryptSecret('секретный токен', key);
  assert.equal(decryptSecret(box, key), 'секретный токен');
});

test('в шифротексте нет исходного текста', () => {
  assert.ok(!encryptSecret('секретный токен', key).includes('секретный'));
});

test('два шифрования одного текста дают разное', () => {
  // Одинаковый шифротекст выдавал бы, что два урока используют один токен.
  assert.notEqual(encryptSecret('один', key), encryptSecret('один', key));
});

test('чужой ключ не расшифровывает', () => {
  const box = encryptSecret('секрет', key);
  assert.throws(() => decryptSecret(box, 'b'.repeat(64)));
});

test('подмена шифротекста замечается', () => {
  // Без проверки подлинности можно было бы подменить токен на свой.
  const box = encryptSecret('секрет', key);
  const broken = box.slice(0, -4) + 'ffff';
  assert.throws(() => decryptSecret(broken, key));
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/secrets.test.js`
Ожидается: FAIL — модуль не найден.

- [ ] **Шаг 3: Написать `src/lib/secrets.js`**

```js
// Шифрование чужих токенов перед записью в базу.
//
// Задача — хранить токен доступа так, чтобы дамп базы не был утечкой. Токен
// Яндекс Диска — это доступ ко всему диску заказчика; на этапе 7 рядом лягут
// токены площадок, и правило спеки для них то же.
//
// AES-256-GCM: он одновременно шифрует и подписывает, поэтому подмена
// шифротекста замечается, а не расшифровывается в мусор. Случайный вектор на
// каждое шифрование — иначе одинаковые токены давали бы одинаковый шифротекст.
// Вызывается из src/services/disk.js и, с этапа 7, из адаптеров площадок.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // Рекомендованная длина вектора для GCM.

function keyBytes(hexKey) {
  const key = Buffer.from(String(hexKey), 'hex');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY должен быть 32 байта в hex');
  return key;
}

/** Возвращает строку вида вектор:метка:шифротекст, всё в hex. */
export function encryptSecret(text, hexKey) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyBytes(hexKey), iv);
  const encrypted = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join(
    ':'
  );
}

/** Обратная операция. Бросает, если ключ чужой или шифротекст подменён. */
export function decryptSecret(box, hexKey) {
  const [iv, tag, data] = String(box).split(':');
  const decipher = createDecipheriv(ALGORITHM, keyBytes(hexKey), Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]).toString(
    'utf8'
  );
}
```

- [ ] **Шаг 4: Миграция для хранения подключений**

`migrations/010_integrations.sql`:

```sql
-- Подключения к чужим сервисам: Яндекс Диск сейчас, площадки с этапа 7.
--
-- Токен лежит зашифрованным: он даёт доступ к диску заказчика, и открытым
-- текстом любой дамп базы становится утечкой. Ключ живёт в окружении, поэтому
-- дамп без него бесполезен.
-- Читается из src/services/disk.js.
CREATE TABLE integrations (
  -- Имя сервиса: одно подключение на сервис, потому что автор один.
  name         text PRIMARY KEY,
  token        text NOT NULL,
  refresh_token text,
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Шаг 5: Написать падающий тест на Диск**

`test/disk.test.js`:

```js
// Работа с Яндекс Диском по токену. В сеть не ходим: fetch подставляется.
// Проверяем разбор ответов и то, что токен не утекает в разметку и в журнал.
import test from 'node:test';
import assert from 'node:assert/strict';
import { listDiskFiles, diskDownloadUrl, isVideo } from '../src/services/disk.js';

test('из списка отбираются только видео', () => {
  assert.equal(isVideo({ name: 'urok.mp4', media_type: 'video' }), true);
  assert.equal(isVideo({ name: 'zametki.txt', media_type: 'text' }), false);
  // Диск не всегда проставляет media_type — тогда судим по расширению.
  assert.equal(isVideo({ name: 'urok.mkv' }), true);
});

test('список файлов разбирается', async () => {
  const fetchStub = async (url, options) => {
    assert.match(options.headers.Authorization, /^OAuth /);
    assert.match(String(url), /resources\?path=/);
    return {
      ok: true,
      json: async () => ({
        _embedded: {
          items: [
            { name: 'urok.mp4', path: 'disk:/video/urok.mp4', size: 100, media_type: 'video',
              modified: '2026-09-03T10:00:00Z', type: 'file' },
            { name: 'zametki.txt', path: 'disk:/video/zametki.txt', size: 10,
              media_type: 'text', type: 'file' }
          ]
        }
      })
    };
  };
  const files = await listDiskFiles('токен', 'disk:/video', fetchStub);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'urok.mp4');
  assert.equal(files[0].bytes, 100);
});

test('прямая ссылка на скачивание берётся у Диска', async () => {
  const fetchStub = async (url) => {
    assert.match(String(url), /resources\/download\?path=/);
    return { ok: true, json: async () => ({ href: 'https://downloader/file?t=1' }) };
  };
  assert.equal(await diskDownloadUrl('токен', 'disk:/video/urok.mp4', fetchStub), 'https://downloader/file?t=1');
});

test('отказ Диска объясняется, но токен в объяснение не попадает', async () => {
  const fetchStub = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' });
  await assert.rejects(listDiskFiles('секретный-токен', 'disk:/', fetchStub), (error) => {
    assert.match(error.message, /401/);
    // Текст ошибки уходит в журнал и на экран: токена там быть не должно.
    assert.ok(!error.message.includes('секретный-токен'));
    return true;
  });
});
```

- [ ] **Шаг 6: Написать `src/services/disk.js`**

```js
// Доступ к Яндекс Диску заказчика.
//
// Задача — показать список видео и отдать прямую ссылку на скачивание. Зачем
// по токену, а не по публичной ссылке: публичная ссылка делает невышедший
// урок доступным всякому, кто её увидит. Токен этого не требует, а заодно
// позволяет выбирать файл списком, а не копировать адреса.
// Вызывается из src/routes/integrations.js и src/jobs/fetch-source.js.
import { encryptSecret, decryptSecret } from '../lib/secrets.js';

const API = 'https://cloud-api.yandex.net/v1/disk';

// Расширения, по которым узнаём видео, когда Диск не проставил media_type.
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v'];

/** Видео ли это. Диск не всегда проставляет тип — тогда судим по расширению. */
export function isVideo(item) {
  if (item.media_type === 'video') return true;
  return VIDEO_EXTENSIONS.some((ext) => String(item.name).toLowerCase().endsWith(ext));
}

/**
 * Общий разбор отказа.
 * Токен в сообщение не попадает намеренно: оно уходит и в журнал, и на экран.
 */
async function failure(response, what) {
  const body = await response.text().catch(() => '');
  throw new Error(`${what}: ${response.status} ${body.slice(0, 200)}`);
}

function headers(token) {
  return { Authorization: `OAuth ${token}` };
}

/** Список видео в папке Диска. */
export async function listDiskFiles(token, diskPath, fetchImpl = fetch) {
  const url = `${API}/resources?path=${encodeURIComponent(diskPath)}&limit=200&sort=-modified`;
  const response = await fetchImpl(url, { headers: headers(token) });
  if (!response.ok) await failure(response, 'Диск не отдал список файлов');

  const body = await response.json();
  return (body._embedded?.items ?? [])
    .filter((item) => item.type === 'file' && isVideo(item))
    .map((item) => ({
      name: item.name,
      path: item.path,
      bytes: Number(item.size ?? 0),
      modified: item.modified ?? null
    }));
}

/** Прямая ссылка на скачивание. Живёт недолго — берём её перед самой закачкой. */
export async function diskDownloadUrl(token, diskPath, fetchImpl = fetch) {
  const url = `${API}/resources/download?path=${encodeURIComponent(diskPath)}`;
  const response = await fetchImpl(url, { headers: headers(token) });
  if (!response.ok) await failure(response, 'Диск не отдал ссылку на скачивание');
  const body = await response.json();
  if (!body.href) throw new Error('Диск не вернул прямой ссылки');
  return body.href;
}

/** Сохраняет токен подключения зашифрованным. */
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
```

- [ ] **Шаг 7: Маршруты подключения**

`src/routes/integrations.js` — три маршрута под `requireAdmin`:

```js
// Подключение чужих сервисов к порталу.
//
// Задача — провести автора через согласие Яндекса и сохранить токен. Зачем
// отдельным файлом от routes/auth.js: там вход людей на портал, здесь доступ
// портала к чужому хранилищу — разные вещи с разными правилами.
// Подключается в src/app.js по префиксу /api/integrations.
import { Router } from 'express';
import { requireAdmin } from '../middleware/guards.js';
import { PublicError } from '../middleware/errors.js';
import { signShortLived, verifyShortLived } from '../lib/jwt.js';
import { saveIntegration, loadIntegration, listDiskFiles } from '../services/disk.js';

const AUTHORIZE_URL = 'https://oauth.yandex.ru/authorize';
const TOKEN_URL = 'https://oauth.yandex.ru/token';
const STATE_TTL_SECONDS = 600;

export function integrationRoutes(config, pool) {
  const router = Router();
  router.use(requireAdmin);

  router.get('/yandex-disk/connect', (req, res) => {
    if (!config.yandexOauth.clientId) throw new PublicError('Приложение Яндекса не настроено', 503);
    const state = signShortLived({ purpose: 'yandex-disk' }, config.jwtSecret, STATE_TTL_SECONDS);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.yandexOauth.clientId,
      redirect_uri: `${config.publicBaseUrl}/api/integrations/yandex-disk/callback`,
      state
    });
    res.redirect(`${AUTHORIZE_URL}?${params}`);
  });

  router.get('/yandex-disk/callback', async (req, res) => {
    const state = verifyShortLived(String(req.query.state ?? ''), config.jwtSecret);
    if (state?.purpose !== 'yandex-disk') throw new PublicError('Ссылка возврата устарела', 400);

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(req.query.code ?? ''),
        client_id: config.yandexOauth.clientId,
        client_secret: config.yandexOauth.clientSecret
      })
    });
    if (!response.ok) throw new PublicError('Яндекс не выдал токен', 502);
    const body = await response.json();

    await saveIntegration(pool, config, {
      name: 'yandex-disk',
      token: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : null
    });
    res.redirect('/admin/upload');
  });

  router.get('/yandex-disk/files', async (req, res) => {
    const integration = await loadIntegration(pool, config, 'yandex-disk');
    if (!integration) throw new PublicError('Диск не подключён', 409);
    const path = String(req.query.path ?? 'disk:/');
    res.json({ files: await listDiskFiles(integration.token, path) });
  });

  return router;
}
```

- [ ] **Шаг 8: Шаг скачивания `src/jobs/fetch-source.js`**

```js
// Шаг конвейера: забрать исходник с Диска.
//
// Задача — положить файл в буфер и запустить обработку. Зачем отдельным
// шагом, а не прямо в маршруте: скачивание гигабайтного файла идёт минутами, а
// HTTP-запрос столько не живёт — человек закроет вкладку и не узнает, чем
// кончилось.
// Вызывается воркером по имени JOBS.fetchSource.
import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { mediaPath, registerAsset } from '../services/media.js';
import { loadIntegration, diskDownloadUrl } from '../services/disk.js';

export function makeFetchSource(config, pool, queue, fetchImpl = fetch) {
  return async ({ lessonId, diskPath }) => {
    const integration = await loadIntegration(pool, config, 'yandex-disk');
    if (!integration) throw new Error('Яндекс Диск не подключён');

    // Ссылку берём перед самой закачкой: она живёт недолго.
    const href = await diskDownloadUrl(integration.token, diskPath, fetchImpl);
    const response = await fetchImpl(href);
    if (!response.ok) throw new Error(`Файл не скачался: ${response.status}`);

    const dir = `lesson-${lessonId}`;
    await mkdir(mediaPath(config, dir), { recursive: true });
    const relative = `${dir}/${path.basename(diskPath).replace(/[^\w.-]+/g, '_')}`;

    // Потоком: гигабайтный файл в память не помещается, а её здесь полтора
    // гигабайта на всю машину.
    await pipeline(Readable.fromWeb(response.body), createWriteStream(mediaPath(config, relative)));

    const { size } = await stat(mediaPath(config, relative));
    const asset = await registerAsset(pool, config, {
      lessonId,
      kind: 'source',
      relativePath: relative,
      bytes: size
    });
    await pool.query(
      `UPDATE lessons SET source_asset_id = $1, pipeline_state = 'processing', pipeline_error = NULL
        WHERE id = $2`,
      [asset.id, lessonId]
    );

    await queue.add('extractAudio', { lessonId });
    return { bytes: size };
  };
}
```

- [ ] **Шаг 9: Выбор файла в кабинете**

В `src/views/admin-upload.js` — вкладка «С Яндекс Диска»: кнопка «Подключить»,
если не подключён, иначе список видео с кнопкой «Взять в обработку». Список
подтягивается запросом к `/api/integrations/yandex-disk/files`.

В `public/admin.js` — обработчик выбора файла: `POST /api/upload/from-disk`
с `{ lessonId, diskPath }`, который ставит задачу `fetchSource`.

- [ ] **Шаг 10: Убедиться, что тесты проходят**

Выполнить: `npm test && npm run lint`
Ожидается: всё зелёное.

- [ ] **Шаг 11: Проверить на живом Диске**

1. В кабинете приложения Яндекса указать адрес возврата
   `https://<адрес портала>/api/integrations/yandex-disk/callback`.
2. Открыть `/admin/upload`, нажать «Подключить Диск», согласиться.
3. Убедиться, что в базе токен лежит **зашифрованным**:
   `SELECT left(token, 40) FROM integrations;` — должно быть три группы hex
   через двоеточие, а не читаемая строка.
4. Выбрать короткий ролик из списка, запустить обработку, посмотреть журнал
   воркера.

- [ ] **Шаг 12: Коммит**

```bash
git add migrations/010_integrations.sql src/lib/secrets.js src/services/disk.js \
        src/routes/integrations.js src/jobs/fetch-source.js src/views/admin-upload.js \
        public/admin.js src/config.js src/app.js test/secrets.test.js test/disk.test.js
git commit -m "feat: подключение Яндекс Диска и выбор исходника списком"
```

### Задача 6: Запуск ffmpeg и извлечение звука

**Файлы:**
- Создать: `src/lib/ffmpeg.js`, `src/jobs/extract-audio.js`, `test/ffmpeg.test.js`
- Изменить: `src/worker.js`

**Интерфейсы:**
- Потребляет: `mediaPath`, `registerAsset`, `assetById`.
- Отдаёт дальше: `runFfmpeg(args, { onProgress })` → `Promise<void>`, бросает
  `Error` с последними строками вывода; `probeDuration(file)` → секунды;
  обработчик `extractAudio({ lessonId })`.

- [ ] **Шаг 1: Написать падающий тест**

`test/ffmpeg.test.js`:

```js
// Проверка обёртки над ffmpeg. Сам ffmpeg не проверяем — он чужой и рабочий;
// проверяем то, что вокруг: понятную ошибку вместо пустого кода возврата и
// разбор длительности.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ffmpegArgsForAudio, parseDuration, describeFailure } from '../src/lib/ffmpeg.js';

test('звук извлекается в опус 16 кГц моно', () => {
  const args = ffmpegArgsForAudio('/media/in.mp4', '/media/out.ogg');
  // 16 кГц моно — то, что просят сервисы распознавания. Больше не нужно:
  // лишние килогерцы увеличивают файл и время загрузки, но не точность.
  assert.ok(args.includes('-ar'));
  assert.ok(args.includes('16000'));
  assert.ok(args.includes('-ac'));
  assert.ok(args.includes('1'));
  // Видео выбрасываем: сервису распознавания оно не нужно, а весит всё.
  assert.ok(args.includes('-vn'));
  assert.equal(args.at(-1), '/media/out.ogg');
});

test('длительность разбирается из вывода ffprobe', () => {
  assert.equal(parseDuration('3599.984000\n'), 3599.984);
  assert.equal(parseDuration('N/A'), null);
  assert.equal(parseDuration(''), null);
});

test('ошибка ffmpeg объясняется последними строками вывода', () => {
  const text = describeFailure(1, ['первая строка', 'Invalid data found when processing input']);
  assert.match(text, /Invalid data/);
  // Код возврата сам по себе ничего не объясняет человеку в кабинете.
  assert.match(text, /1/);
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/ffmpeg.test.js`
Ожидается: FAIL — модуль не найден.

- [ ] **Шаг 3: Написать `src/lib/ffmpeg.js`**

```js
// Запуск ffmpeg.
//
// Задача — собрать аргументы, запустить процесс и превратить его отказ в
// понятную человеку ошибку. Зачем обёрткой: ffmpeg пишет диагностику в поток
// ошибок и возвращает голый код возврата — без разбора в кабинете было бы
// написано «код 1», и автор не узнал бы, что файл повреждён.
// Вызывается из задач в src/jobs/.
import { spawn } from 'node:child_process';

// Сколько последних строк вывода сохраняем для объяснения. Больше незачем:
// причина отказа всегда в конце, а начало — это список кодеков на экран.
const TAIL_LINES = 12;

/** Аргументы для извлечения звуковой дорожки под распознавание. */
export function ffmpegArgsForAudio(input, output) {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', input,
    // Видео выбрасываем: сервису распознавания оно не нужно, а весит всё.
    '-vn',
    // 16 кГц моно — то, что просят сервисы распознавания. Больше не нужно:
    // лишние килогерцы увеличивают файл, но не точность.
    '-ar', '16000',
    '-ac', '1',
    '-c:a', 'libopus',
    '-b:a', '24k',
    '-y',
    output
  ];
}

/** Разбирает вывод ffprobe. null, если длительность неизвестна. */
export function parseDuration(text) {
  const value = Number.parseFloat(String(text).trim());
  return Number.isFinite(value) ? value : null;
}

/** Складывает объяснение отказа из кода возврата и хвоста вывода. */
export function describeFailure(code, lines) {
  const tail = lines.slice(-TAIL_LINES).join('\n').trim();
  return `ffmpeg завершился с кодом ${code}${tail ? `:\n${tail}` : ''}`;
}

/**
 * Запускает ffmpeg и ждёт завершения.
 * nice повышает уступчивость процесса: на двух ядрах ffmpeg иначе съедает
 * оба, и портал перестаёт отвечать на запросы, пока идёт обработка.
 */
export function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('nice', ['-n', '10', 'ffmpeg', ...args]);
    const lines = [];
    child.stderr.on('data', (chunk) => {
      lines.push(...String(chunk).split('\n').filter(Boolean));
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(describeFailure(code, lines)));
    });
  });
}

/** Длительность файла в секундах через ffprobe. */
export function probeDuration(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      file
    ]);
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.on('error', reject);
    child.on('close', () => resolve(parseDuration(out)));
  });
}
```

- [ ] **Шаг 4: Написать `src/jobs/extract-audio.js`**

```js
// Шаг конвейера: исходник → звуковая дорожка.
//
// Задача — получить лёгкий файл, который можно отдать сервису распознавания.
// Зачем отдельным шагом, а не частью расшифровки: извлечение занимает минуты,
// и при повторе после сбоя сети переделывать его незачем — результат уже
// лежит в буфере и записан в базу.
// Вызывается воркером по имени JOBS.extractAudio.
import { mkdir } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { runFfmpeg, ffmpegArgsForAudio, probeDuration } from '../lib/ffmpeg.js';
import { mediaPath, registerAsset, assetById } from '../services/media.js';

/**
 * Создаёт обработчик. Замыкание нужно, чтобы задача видела пул и конфиг, не
 * доставая их из глобальных переменных. Вызывается из src/worker.js.
 */
export function makeExtractAudio(config, pool, queue) {
  return async ({ lessonId }) => {
    const { rows } = await pool.query('SELECT source_asset_id FROM lessons WHERE id = $1', [
      lessonId
    ]);
    const sourceId = rows[0]?.source_asset_id;
    if (!sourceId) throw new Error('у урока нет исходника');

    const source = await assetById(pool, sourceId);
    const input = mediaPath(config, source.path);
    const relative = `${path.dirname(source.path)}/audio.ogg`;
    const output = mediaPath(config, relative);
    await mkdir(path.dirname(output), { recursive: true });

    await runFfmpeg(ffmpegArgsForAudio(input, output));

    const { size } = await stat(output);
    const asset = await registerAsset(pool, config, {
      lessonId,
      kind: 'audio',
      relativePath: relative,
      bytes: size
    });

    // Длительность урока пригодится карточке и нарезке: узнаём один раз здесь.
    const duration = await probeDuration(input);
    if (duration) {
      await pool.query('UPDATE lessons SET duration_seconds = $1 WHERE id = $2', [
        Math.round(duration),
        lessonId
      ]);
    }

    // Следующий шаг ставим сами: конвейер идёт по порядку, и знание о порядке
    // живёт в шагах, а не размазано по вызывающим.
    await queue.add('transcribe', { lessonId, audioAssetId: asset.id });
    return { audioAssetId: asset.id };
  };
}
```

Подключить в `src/worker.js`:

```js
import { createQueue } from './queue.js';
import { makeExtractAudio } from './jobs/extract-audio.js';

const queue = createQueue(config);
const handlers = {
  extractAudio: makeExtractAudio(config, pool, queue)
};
```

- [ ] **Шаг 5: Убедиться, что тесты проходят**

Выполнить: `node --test test/ffmpeg.test.js && npm test`
Ожидается: 3 теста ffmpeg PASS, остальные не сломаны.

- [ ] **Шаг 6: Проверить на настоящем файле**

```bash
# Короткий ролик для проверки: пять секунд тишины с картинкой.
docker compose exec worker sh -c 'ffmpeg -f lavfi -i color=c=black:s=320x240:d=5 \
  -f lavfi -i anullsrc -shortest /app/media/proba.mp4 -y'
docker compose exec worker node -e "
import('/app/src/lib/ffmpeg.js').then(async (m) => {
  await m.runFfmpeg(m.ffmpegArgsForAudio('/app/media/proba.mp4', '/app/media/proba.ogg'));
  console.log('длительность:', await m.probeDuration('/app/media/proba.mp4'));
});"
docker compose exec worker ls -l /app/media/proba.ogg
```

Ожидается: файл `proba.ogg` создан, длительность около 5.

- [ ] **Шаг 7: Коммит**

```bash
git add src/lib/ffmpeg.js src/jobs/extract-audio.js src/worker.js test/ffmpeg.test.js
git commit -m "feat: извлечение звуковой дорожки из исходника"
```

### Задача 7: Временная ссылка на файл буфера

**Файлы:**
- Создать: `src/lib/media-token.js`, `src/routes/media.js`, `test/media-token.test.js`
- Изменить: `src/app.js`

**Интерфейсы:**
- Потребляет: `config.jwtSecret`, `assetById`, `mediaPath`.
- Отдаёт дальше: `mediaLink(config, assetId, seconds)` → полный адрес;
  `GET /media/:token` — отдаёт файл, пока ссылка жива.

- [ ] **Шаг 1: Написать падающий тест**

`test/media-token.test.js`:

```js
// Временная ссылка на файл буфера. Она нужна сервису распознавания: он
// забирает звук по HTTPS сам. Ссылка обязана протухать — иначе исходник урока
// останется доступным всему интернету навсегда.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaLink, readMediaToken } from '../src/lib/media-token.js';

const config = { publicBaseUrl: 'https://soloaijourney.online', jwtSecret: 'x'.repeat(32) };

test('ссылка ведёт на наш адрес и несёт токен', () => {
  const link = mediaLink(config, 42, 3600);
  assert.match(link, /^https:\/\/soloaijourney\.online\/media\//);
  assert.equal(readMediaToken(config, link.split('/media/')[1]), 42);
});

test('чужой токен не принимается', () => {
  const link = mediaLink({ ...config, jwtSecret: 'y'.repeat(32) }, 42, 3600);
  assert.equal(readMediaToken(config, link.split('/media/')[1]), null);
});

test('просроченный токен не принимается', async () => {
  const link = mediaLink(config, 42, 0);
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(readMediaToken(config, link.split('/media/')[1]), null);
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/media-token.test.js`
Ожидается: FAIL — модуль не найден.

- [ ] **Шаг 3: Написать `src/lib/media-token.js`**

```js
// Временная ссылка на файл рабочего буфера.
//
// Задача — дать внешнему сервису распознавания забрать звуковую дорожку по
// HTTPS. Зачем не отдать файл напрямую: тогда исходники уроков лежали бы в
// открытом доступе по угадываемым адресам. Зачем не через Object Storage
// Яндекса: это лишний сервис и лишний счёт ради одного файла, который и так
// лежит на нашем диске.
//
// Ссылка живёт час: распознавание часового урока идёт минуты, а ссылка,
// живущая дольше, — это исходник, доступный всему интернету.
// Вызывается из src/jobs/transcribe.js и src/routes/media.js.
import { signShortLived, verifyShortLived } from './jwt.js';

export function mediaLink(config, assetId, seconds = 3600) {
  const token = signShortLived({ assetId }, config.jwtSecret, seconds);
  return `${config.publicBaseUrl}/media/${token}`;
}

/** Номер файла из токена. null на любой неудаче — чужой, просроченный, мусор. */
export function readMediaToken(config, token) {
  const payload = verifyShortLived(String(token ?? ''), config.jwtSecret);
  return payload?.assetId ?? null;
}
```

- [ ] **Шаг 4: Написать `src/routes/media.js`**

```js
// Отдача файла буфера по временной ссылке.
//
// Задача — позволить внешнему сервису забрать звук, не открывая буфер целиком.
// Проверяется только подпись и срок: кто именно пришёл, знать не нужно —
// сервис распознавания не умеет ни входить, ни носить куки.
// Подключается в src/app.js по префиксу /media.
import { Router } from 'express';
import { readMediaToken } from '../lib/media-token.js';
import { assetById, mediaPath } from '../services/media.js';
import { PublicError } from '../middleware/errors.js';

export function mediaRoutes(config, pool) {
  const router = Router();

  router.get('/:token', async (req, res) => {
    const assetId = readMediaToken(config, req.params.token);
    if (!assetId) throw new PublicError('Ссылка недействительна или устарела', 403);

    const asset = await assetById(pool, assetId);
    if (!asset) throw new PublicError('Файл уже удалён из буфера', 404);

    // Файл частный и временный: поисковикам и кешам его хранить незачем.
    res.set('Cache-Control', 'private, no-store');
    res.sendFile(mediaPath(config, asset.path));
  });

  return router;
}
```

Подключить в `src/app.js`: `app.use('/media', mediaRoutes(config, pool));`

- [ ] **Шаг 5: Убедиться, что тесты проходят**

Выполнить: `npm test`
Ожидается: все PASS.

- [ ] **Шаг 6: Коммит**

```bash
git add src/lib/media-token.js src/routes/media.js src/app.js test/media-token.test.js
git commit -m "feat: временная ссылка на файл буфера для внешнего сервиса"
```

### Задача 8: Тонкий слой распознавания и адаптер Яндекса

**Файлы:**
- Создать: `src/services/speech/index.js`, `src/services/speech/yandex.js`,
  `test/speech.test.js`
- Изменить: `src/config.js`, `.env.example`

**Внимание исполнителю.** Точные имена полей в ответах Яндекса взяты из
документации, а не проверены боем. Первый настоящий прогон (задача 9, шаг 7)
может показать другую форму ответа — тогда правится **только разбор в
`yandex.js`**, остальной конвейер не трогается. Ради этого слой и тонкий.

**Интерфейсы:**
- Потребляет: `config.yandex` (`apiKey`, `folderId`).
- Отдаёт дальше: `createSpeech(config, fetchImpl)` → `null` или объект
  `{ transcribe(audioUrl) → { text, segments: [{ startedMs, endedMs, text }] },
  generate(prompt) → строка }`; `parseYandexRecognition(body)` — разбор ответа,
  вынесен отдельно ради теста без сети.

- [ ] **Шаг 1: Написать падающий тест**

`test/speech.test.js`:

```js
// Проверка слоя распознавания. В сеть не ходим: fetch подставляется. Главное
// здесь — разбор ответа и то, что без ключей слой отсутствует, а не падает.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeech } from '../src/services/speech/index.js';
import { parseYandexRecognition } from '../src/services/speech/yandex.js';

const config = {
  yandex: { apiKey: 'ключ', folderId: 'папка' },
  publicBaseUrl: 'https://soloaijourney.online'
};

test('без ключей слоя нет, и это не ошибка', () => {
  // Портал должен подниматься и работать без настроенного распознавания:
  // витрина, вход и отзывы от него не зависят.
  assert.equal(createSpeech({ yandex: { apiKey: '', folderId: '' } }), null);
});

test('ответ распознавания разбирается в сегменты с таймкодами', () => {
  const body = {
    result: {
      chunks: [
        {
          alternatives: [{ text: 'первый кусок' }],
          startTimeMs: '0',
          endTimeMs: '2500'
        },
        {
          alternatives: [{ text: 'второй кусок' }],
          startTimeMs: '2500',
          endTimeMs: '5000'
        }
      ]
    }
  };
  const parsed = parseYandexRecognition(body);
  assert.equal(parsed.segments.length, 2);
  assert.deepEqual(parsed.segments[0], { startedMs: 0, endedMs: 2500, text: 'первый кусок' });
  // Цельный текст — это склейка сегментов: отдельного поля у сервиса нет.
  assert.equal(parsed.text, 'первый кусок второй кусок');
});

test('пустой ответ не роняет разбор', () => {
  assert.deepEqual(parseYandexRecognition({}), { text: '', segments: [] });
  assert.deepEqual(parseYandexRecognition({ result: { chunks: [] } }), { text: '', segments: [] });
});

test('распознавание отправляет ссылку и ждёт готовности', async () => {
  const calls = [];
  const fetchStub = async (url, options) => {
    calls.push(String(url));
    if (String(url).includes('recognizeFileAsync')) {
      assert.match(options.headers.Authorization, /^Api-Key /);
      assert.match(options.body, /https:\/\/soloaijourney\.online\/media\//);
      return { ok: true, json: async () => ({ id: 'операция-1' }) };
    }
    if (String(url).includes('/operations/')) {
      return { ok: true, json: async () => ({ done: true }) };
    }
    return {
      ok: true,
      json: async () => ({
        result: { chunks: [{ alternatives: [{ text: 'слово' }], startTimeMs: '0', endTimeMs: '100' }] }
      })
    };
  };

  const speech = createSpeech(config, fetchStub);
  const result = await speech.transcribe('https://soloaijourney.online/media/токен');
  assert.equal(result.text, 'слово');
  // Три обращения: поставить задачу, дождаться, забрать результат.
  assert.equal(calls.length, 3);
});

test('отказ сервиса объясняется, а не глотается', async () => {
  const fetchStub = async () => ({ ok: false, status: 402, text: async () => 'нет денег' });
  const speech = createSpeech(config, fetchStub);
  await assert.rejects(speech.transcribe('https://пример/файл'), /402|нет денег/);
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/speech.test.js`
Ожидается: FAIL — модуль не найден.

- [ ] **Шаг 3: Написать `src/services/speech/yandex.js`**

```js
// Распознавание речи и генерация текстов через Яндекс Облако.
//
// Задача — две операции: расшифровать звук по ссылке и попросить модель
// написать текст. Зачем именно Яндекс: решение спеки — сервер российский,
// оплата рублями со счёта без зарубежных карт, качество на русской речи
// хорошее. Замена поставщика — новый файл рядом с этим и одна строка в
// index.js; конвейер не трогается.
// Вызывается из src/services/speech/index.js.

const RECOGNIZE_URL = 'https://stt.api.cloud.yandex.net/stt/v3/recognizeFileAsync';
const OPERATION_URL = 'https://operation.api.cloud.yandex.net/operations';
const RESULT_URL = 'https://stt.api.cloud.yandex.net/stt/v3/getRecognition';
const COMPLETION_URL = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';

// Как часто спрашивать о готовности и сколько ждать всего. Часовой урок
// распознаётся минуты; полчаса — заведомый запас, после которого что-то
// сломалось у них, и ждать дальше бессмысленно.
const POLL_INTERVAL_MS = 10_000;
const MAX_WAIT_MS = 30 * 60_000;

/**
 * Разбирает ответ распознавания в сегменты с таймкодами.
 * Вынесено отдельной функцией, потому что это единственное место, которое
 * знает форму чужого ответа, — и единственное, что придётся править, если
 * форма окажется другой. Проверяется тестом без сети.
 */
export function parseYandexRecognition(body) {
  const chunks = body?.result?.chunks ?? [];
  const segments = chunks
    .map((chunk) => ({
      startedMs: Number(chunk.startTimeMs ?? 0),
      endedMs: Number(chunk.endTimeMs ?? 0),
      text: String(chunk.alternatives?.[0]?.text ?? '').trim()
    }))
    .filter((segment) => segment.text);
  return { text: segments.map((s) => s.text).join(' '), segments };
}

/** Общий разбор отказа: код и тело, без догадок. */
async function failure(response, what) {
  const body = await response.text().catch(() => '');
  throw new Error(`${what}: ${response.status} ${body.slice(0, 300)}`);
}

export function createYandexSpeech(config, fetchImpl = fetch, sleep = wait) {
  const headers = {
    Authorization: `Api-Key ${config.yandex.apiKey}`,
    'Content-Type': 'application/json'
  };

  return {
    async transcribe(audioUrl) {
      const started = await fetchImpl(RECOGNIZE_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          uri: audioUrl,
          recognitionModel: {
            model: 'general',
            audioFormat: { containerAudio: { containerAudioType: 'OGG_OPUS' } },
            // Литературный текст: с заглавными, знаками препинания и числами
            // цифрами. Иначе расшифровку невозможно читать глазами.
            textNormalization: {
              textNormalization: 'TEXT_NORMALIZATION_ENABLED',
              literatureText: true
            },
            languageRestriction: { restrictionType: 'WHITELIST', languageCode: ['ru-RU'] }
          }
        })
      });
      if (!started.ok) await failure(started, 'Распознавание не началось');
      const { id } = await started.json();

      const deadline = Date.now() + MAX_WAIT_MS;
      for (;;) {
        const operation = await fetchImpl(`${OPERATION_URL}/${id}`, { headers });
        if (!operation.ok) await failure(operation, 'Не удалось узнать состояние распознавания');
        const state = await operation.json();
        if (state.done) break;
        if (Date.now() > deadline) throw new Error('Распознавание не закончилось за полчаса');
        await sleep(POLL_INTERVAL_MS);
      }

      const result = await fetchImpl(`${RESULT_URL}?operationId=${id}`, { headers });
      if (!result.ok) await failure(result, 'Не удалось забрать расшифровку');
      return parseYandexRecognition(await result.json());
    },

    async generate(prompt) {
      const response = await fetchImpl(COMPLETION_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          modelUri: `gpt://${config.yandex.folderId}/yandexgpt/latest`,
          // Низкая температура: нужен предсказуемый разбор, а не сочинение.
          completionOptions: { stream: false, temperature: 0.3, maxTokens: 2000 },
          messages: [{ role: 'user', text: prompt }]
        })
      });
      if (!response.ok) await failure(response, 'Модель не ответила');
      const body = await response.json();
      return String(body?.result?.alternatives?.[0]?.message?.text ?? '');
    }
  };
}

/** Пауза между опросами. Отдельной функцией, чтобы тест её подменил. */
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Шаг 4: Написать `src/services/speech/index.js`**

```js
// Тонкий слой над распознаванием и генерацией текстов.
//
// Задача — дать конвейеру два метода и скрыть, кто именно их выполняет.
// Спека прямо требует: обращение к сервису идёт через тонкий слой, поэтому
// замена поставщика — правка одного файла, а не переделка конвейера.
// Вызывается из src/worker.js.
import { createYandexSpeech } from './yandex.js';

/**
 * Собирает слой по настройкам.
 * Возвращает null, если ключей нет: портал обязан подниматься и работать без
 * распознавания — витрина, вход и отзывы от него не зависят.
 */
export function createSpeech(config, fetchImpl = fetch, sleep) {
  if (!config.yandex?.apiKey || !config.yandex?.folderId) return null;
  return createYandexSpeech(config, fetchImpl, sleep);
}
```

В `src/config.js` добавить:

```js
    yandex: {
      apiKey: env.YANDEX_CLOUD_API_KEY ?? '',
      folderId: env.YANDEX_CLOUD_FOLDER_ID ?? ''
    },
```

- [ ] **Шаг 5: Убедиться, что тесты проходят**

Выполнить: `node --test test/speech.test.js`
Ожидается: 5 тестов PASS. Тест ожидания подменяет паузу, поэтому идёт быстро.

- [ ] **Шаг 6: Коммит**

```bash
git add src/services/speech src/config.js test/speech.test.js .env.example
git commit -m "feat: тонкий слой распознавания речи и адаптер Яндекса"
```

### Задача 9: Шаг расшифровки

**Файлы:**
- Создать: `src/jobs/transcribe.js`, `test/transcribe-job.test.js`
- Изменить: `src/worker.js`

**Интерфейсы:**
- Потребляет: `createSpeech`, `mediaLink`, `assetById`.
- Отдаёт дальше: обработчик `transcribe({ lessonId, audioAssetId })`, кладёт
  `transcripts` и `transcript_segments`, ставит следующий шаг `subtitles`.

- [ ] **Шаг 1: Написать падающий тест**

`test/transcribe-job.test.js`:

```js
// Проверка шага расшифровки. Сервис подставляется заглушкой: проверяем не
// качество распознавания, а то, что результат целиком лёг в базу и повтор
// шага не наплодил вторых сегментов.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTranscribe } from '../src/jobs/transcribe.js';
import { saveLesson } from '../src/services/lessons.js';
import { registerAsset } from '../src/services/media.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://soloaijourney.online',
  jwtSecret: 'x'.repeat(32),
  media: { dir: '/tmp', ttlHours: 168 }
};

const speech = {
  transcribe: async () => ({
    text: 'первый кусок второй кусок',
    segments: [
      { startedMs: 0, endedMs: 2500, text: 'первый кусок' },
      { startedMs: 2500, endedMs: 5000, text: 'второй кусок' }
    ]
  })
};

const queue = { added: [], add(name, data) { this.added.push({ name, data }); } };

async function seed(pool) {
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
  const audio = await registerAsset(pool, config, {
    lessonId: lesson.id,
    kind: 'audio',
    relativePath: 'urok/audio.ogg',
    bytes: 1000
  });
  return { lessonId: lesson.id, audioAssetId: audio.id };
}

test('расшифровка ложится в базу целиком', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, audioAssetId } = await seed(pool);
    queue.added = [];
    await makeTranscribe(config, pool, queue, speech)({ lessonId, audioAssetId });

    const { rows: t } = await pool.query('SELECT text FROM transcripts WHERE lesson_id = $1', [
      lessonId
    ]);
    assert.match(t[0].text, /первый кусок/);
    const { rows: s } = await pool.query(
      'SELECT started_ms, text FROM transcript_segments WHERE lesson_id = $1 ORDER BY started_ms',
      [lessonId]
    );
    assert.equal(s.length, 2);
    assert.equal(s[1].started_ms, 2500);
    // Следующий шаг ставится сразу: порядок конвейера живёт в шагах.
    assert.equal(queue.added[0].name, 'subtitles');
  });
});

test('повтор шага заменяет расшифровку, а не удваивает', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, audioAssetId } = await seed(pool);
    const job = makeTranscribe(config, pool, queue, speech);
    await job({ lessonId, audioAssetId });
    await job({ lessonId, audioAssetId });
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM transcript_segments WHERE lesson_id = $1',
      [lessonId]
    );
    assert.equal(rows[0].n, 2);
  });
});

test('без настроенного сервиса шаг говорит об этом внятно', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, audioAssetId } = await seed(pool);
    await assert.rejects(
      makeTranscribe(config, pool, queue, null)({ lessonId, audioAssetId }),
      /не настроено/i
    );
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/transcribe-job.test.js`
Ожидается: FAIL — модуль не найден.

- [ ] **Шаг 3: Написать `src/jobs/transcribe.js`**

```js
// Шаг конвейера: звук → расшифровка с таймкодами.
//
// Задача — получить от внешнего сервиса текст урока, разбитый на отрезки, и
// сразу положить его в базу. Зачем сразу: следующий шаг может упасть, и
// переделывать распознавание — это ещё раз платить за минуты и ждать их.
// Вызывается воркером по имени JOBS.transcribe.
import { mediaLink } from '../lib/media-token.js';

export function makeTranscribe(config, pool, queue, speech) {
  return async ({ lessonId, audioAssetId }) => {
    if (!speech) throw new Error('Распознавание речи не настроено: нет ключей Яндекс Облака');

    // Ссылка живёт час: сервис забирает файл сам и сразу, а долгоживущая
    // ссылка — это исходник урока, открытый всему интернету.
    const link = mediaLink(config, audioAssetId, 3600);
    const { text, segments } = await speech.transcribe(link);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Повтор шага заменяет прежний результат: два набора сегментов одного
      // урока сделали бы поиск бессмысленным.
      await client.query('DELETE FROM transcript_segments WHERE lesson_id = $1', [lessonId]);
      await client.query(
        `INSERT INTO transcripts (lesson_id, text) VALUES ($1, $2)
         ON CONFLICT (lesson_id) DO UPDATE SET text = EXCLUDED.text, created_at = now()`,
        [lessonId, text]
      );
      for (const segment of segments) {
        await client.query(
          `INSERT INTO transcript_segments (lesson_id, started_ms, ended_ms, text)
           VALUES ($1, $2, $3, $4)`,
          [lessonId, segment.startedMs, segment.endedMs, segment.text]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await queue.add('subtitles', { lessonId });
    return { segments: segments.length };
  };
}
```

Подключить в `src/worker.js`:

```js
import { createSpeech } from './services/speech/index.js';
import { makeTranscribe } from './jobs/transcribe.js';

const speech = createSpeech(config);
handlers.transcribe = makeTranscribe(config, pool, queue, speech);
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Выполнить: `node --test test/transcribe-job.test.js`
Ожидается: 3 теста PASS.

- [ ] **Шаг 5: Записать состояние конвейера при падении**

В `src/worker.js`, в обработчик `failed`:

```js
worker.on('failed', async (job, err) => {
  console.error(`Задача ${job?.name} упала: ${err.message}`);
  // Автор должен видеть причину в кабинете, а не искать её в журнале
  // контейнера, к которому у него нет доступа с телефона.
  if (job?.data?.lessonId) {
    await pool.query(
      `UPDATE lessons SET pipeline_state = 'failed', pipeline_error = $1 WHERE id = $2`,
      [`${job.name}: ${err.message}`.slice(0, 500), job.data.lessonId]
    );
  }
});
```

- [ ] **Шаг 6: Коммит**

```bash
git add src/jobs/transcribe.js src/worker.js test/transcribe-job.test.js
git commit -m "feat: шаг расшифровки с записью сегментов в базу"
```

- [ ] **Шаг 7: ПРОГОН НА НАСТОЯЩЕМ УРОКЕ — решающая проверка**

Это та проверка, ради которой спека откладывала выбор поставщика.

```bash
# Заполнить в .env: YANDEX_CLOUD_API_KEY, YANDEX_CLOUD_FOLDER_ID
docker compose up -d --force-recreate api worker

# Завести урок и загрузить настоящий файл через /admin/upload,
# затем поставить первый шаг вручную:
docker compose exec api node --input-type=module -e "
import { loadConfig } from './src/config.js';
import { createQueue } from './src/queue.js';
const queue = createQueue(loadConfig());
await queue.add('extractAudio', { lessonId: 1 });
await queue.close();
"
docker compose logs -f worker
```

Что смотреть и что делать:

1. **Форма ответа сервиса.** Если разбор упал или сегменты пустые — вывести
   сырой ответ и поправить `parseYandexRecognition`. Это единственное место,
   которое знает чужую форму, и правится только оно.
2. **Качество распознавания глазами.** Открыть транскрипт:
   `SELECT left(text, 600) FROM transcripts;`. Если русская речь распознана
   плохо — это и есть тот случай, когда спека разрешает сменить поставщика.
   Решение принимает заказчик, а не исполнитель.
3. **Цена.** Записать в отчёт стоимость минуты распознавания по счёту.

Результат прогона занести в `docs/history` и сообщить заказчику до того, как
писать следующие задачи поверх непроверенного поставщика.

### Задача 10: Субтитры

**Файлы:**
- Создать: `src/lib/srt.js`, `src/jobs/subtitles.js`, `test/srt.test.js`
- Изменить: `src/worker.js`

**Интерфейсы:**
- Потребляет: `transcript_segments`, `registerAsset`.
- Отдаёт дальше: `toSrt(segments)` и `toVtt(segments)` → строки;
  обработчик `subtitles({ lessonId })`, кладёт файлы `.srt` и `.vtt`,
  ставит следующий шаг `generateTexts`.

- [ ] **Шаг 1: Написать падающий тест**

`test/srt.test.js`:

```js
// Проверка формата субтитров. Формат чужой и строгий: лишний пробел или
// точка вместо запятой — и площадка молча отвергает файл, а автор узнаёт об
// этом только по отсутствию субтитров у вышедшего ролика.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toSrt, toVtt, formatSrtTime, formatVttTime } from '../src/lib/srt.js';

const segments = [
  { startedMs: 0, endedMs: 2500, text: 'первая строка' },
  { startedMs: 2500, endedMs: 5000, text: 'вторая строка' }
];

test('время в srt пишется с запятой, в vtt — с точкой', () => {
  // Это не мелочь: с точкой файл srt не принимается, с запятой — vtt.
  assert.equal(formatSrtTime(3_661_500), '01:01:01,500');
  assert.equal(formatVttTime(3_661_500), '01:01:01.500');
});

test('srt нумерует блоки с единицы', () => {
  const srt = toSrt(segments);
  assert.match(srt, /^1\r?\n00:00:00,000 --> 00:00:02,500\r?\nпервая строка/);
  assert.match(srt, /\n2\r?\n00:00:02,500 --> 00:00:05,000/);
});

test('vtt начинается с обязательной строки WEBVTT', () => {
  assert.match(toVtt(segments), /^WEBVTT\r?\n/);
});

test('пустой список даёт пустой файл, а не поломку', () => {
  assert.equal(toSrt([]).trim(), '');
  assert.match(toVtt([]), /^WEBVTT/);
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/srt.test.js`
Ожидается: FAIL — модуль не найден.

- [ ] **Шаг 3: Написать `src/lib/srt.js`**

```js
// Сборка субтитров из сегментов расшифровки.
//
// Задача — превратить отрезки с таймкодами в два чужих формата: .srt для
// площадок и .vtt для веб-плеера. Зачем оба: YouTube и VK принимают srt, а
// браузерный <track> понимает только vtt. Форматы различаются одним знаком в
// записи времени — и на этом знаке файл молча отвергается.
// Вызывается из src/jobs/subtitles.js.

/** Время в формате srt: ЧЧ:ММ:СС,мс — именно с запятой. */
export function formatSrtTime(ms) {
  return formatTime(ms, ',');
}

/** Время в формате vtt: ЧЧ:ММ:СС.мс — именно с точкой. */
export function formatVttTime(ms) {
  return formatTime(ms, '.');
}

function formatTime(ms, separator) {
  const total = Math.max(0, Math.round(ms));
  const hours = String(Math.floor(total / 3_600_000)).padStart(2, '0');
  const minutes = String(Math.floor((total % 3_600_000) / 60_000)).padStart(2, '0');
  const seconds = String(Math.floor((total % 60_000) / 1000)).padStart(2, '0');
  const millis = String(total % 1000).padStart(3, '0');
  return `${hours}:${minutes}:${seconds}${separator}${millis}`;
}

/** Файл .srt: пронумерованные блоки, разделённые пустой строкой. */
export function toSrt(segments) {
  return segments
    .map((segment, index) =>
      [
        index + 1,
        `${formatSrtTime(segment.startedMs)} --> ${formatSrtTime(segment.endedMs)}`,
        segment.text,
        ''
      ].join('\n')
    )
    .join('\n');
}

/** Файл .vtt: та же разметка, но с обязательной первой строкой и точкой. */
export function toVtt(segments) {
  const blocks = segments.map((segment) =>
    [
      `${formatVttTime(segment.startedMs)} --> ${formatVttTime(segment.endedMs)}`,
      segment.text,
      ''
    ].join('\n')
  );
  return ['WEBVTT', '', ...blocks].join('\n');
}
```

- [ ] **Шаг 4: Написать `src/jobs/subtitles.js`**

```js
// Шаг конвейера: сегменты → файлы субтитров.
//
// Задача — положить в буфер .srt и .vtt. Зачем отдельным шагом: субтитры
// нужны и площадкам при публикации, и нарезкам для вшивания, и плееру на
// карточке урока — считать их трижды незачем.
// Вызывается воркером по имени JOBS.subtitles.
import { writeFile, mkdir } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { toSrt, toVtt } from '../lib/srt.js';
import { mediaPath, registerAsset } from '../services/media.js';

export function makeSubtitles(config, pool, queue) {
  return async ({ lessonId }) => {
    const { rows } = await pool.query(
      `SELECT started_ms, ended_ms, text FROM transcript_segments
        WHERE lesson_id = $1 ORDER BY started_ms`,
      [lessonId]
    );
    if (!rows.length) throw new Error('нет расшифровки — субтитры делать не из чего');

    const segments = rows.map((r) => ({
      startedMs: r.started_ms,
      endedMs: r.ended_ms,
      text: r.text
    }));

    const dir = `lesson-${lessonId}`;
    await mkdir(mediaPath(config, dir), { recursive: true });

    for (const [name, content] of [
      [`${dir}/subtitles.srt`, toSrt(segments)],
      [`${dir}/subtitles.vtt`, toVtt(segments)]
    ]) {
      await writeFile(mediaPath(config, name), content, 'utf8');
      const { size } = await stat(mediaPath(config, name));
      await registerAsset(pool, config, {
        lessonId,
        kind: 'subtitles',
        relativePath: name,
        bytes: size
      });
    }

    await queue.add('generateTexts', { lessonId });
    return { segments: segments.length };
  };
}
```

- [ ] **Шаг 5: Убедиться, что тесты проходят**

Выполнить: `npm test`
Ожидается: все PASS.

- [ ] **Шаг 6: Коммит**

```bash
git add src/lib/srt.js src/jobs/subtitles.js src/worker.js test/srt.test.js
git commit -m "feat: субтитры .srt и .vtt из сегментов расшифровки"
```

### Задача 11: Тексты от модели

**Файлы:**
- Создать: `src/jobs/generate-texts.js`, `test/generate-texts.test.js`
- Изменить: `src/worker.js`

**Интерфейсы:**
- Потребляет: `transcripts`, `speech.generate`.
- Отдаёт дальше: обработчик `generateTexts({ lessonId })`, кладёт в
  `lessons.generated` объект `{ titles: [3 строки], description, tags,
  chapters: [{ startedMs, title }] }`, переводит урок в `review`,
  ставит следующий шаг `makeClips`.

- [ ] **Шаг 1: Написать падающий тест**

`test/generate-texts.test.js`:

```js
// Проверка шага генерации. Модель — чужая и своенравная: она возвращает JSON
// в разметке, с пояснениями вокруг, иногда с одним заголовком вместо трёх.
// Разбор обязан всё это пережить, иначе конвейер встанет на ровном месте.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGenerateTexts, parseModelAnswer } from '../src/jobs/generate-texts.js';
import { saveLesson } from '../src/services/lessons.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = { media: { dir: '/tmp', ttlHours: 168 } };
const queue = { added: [], add(name, data) { this.added.push({ name, data }); } };

test('ответ в разметке разбирается', () => {
  const answer = 'Вот результат:\n```json\n{"titles":["А","Б","В"],"description":"о"}\n```\nГотово.';
  const parsed = parseModelAnswer(answer);
  assert.deepEqual(parsed.titles, ['А', 'Б', 'В']);
  assert.equal(parsed.description, 'о');
});

test('нехватка заголовков не роняет шаг', () => {
  // Пусть лучше автор увидит один заголовок и допишет остальные, чем весь
  // конвейер встанет из-за капризов модели.
  const parsed = parseModelAnswer('{"titles":["Единственный"]}');
  assert.equal(parsed.titles.length, 1);
  assert.equal(parsed.description, '');
  assert.deepEqual(parsed.tags, []);
  assert.deepEqual(parsed.chapters, []);
});

test('несусветный ответ даёт пустую заготовку, а не исключение', () => {
  const parsed = parseModelAnswer('Извините, не могу помочь.');
  assert.deepEqual(parsed, { titles: [], description: '', tags: [], chapters: [] });
});

test('результат ложится в урок, и он уходит на проверку', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await pool.query(`INSERT INTO transcripts (lesson_id, text) VALUES ($1, 'текст урока')`, [
      lesson.id
    ]);
    const speech = {
      generate: async () =>
        '{"titles":["Раз","Два","Три"],"description":"Описание","tags":["docker"],"chapters":[{"startedMs":0,"title":"Начало"}]}'
    };
    queue.added = [];
    await makeGenerateTexts(config, pool, queue, speech)({ lessonId: lesson.id });

    const { rows } = await pool.query(
      'SELECT generated, pipeline_state FROM lessons WHERE id = $1',
      [lesson.id]
    );
    assert.deepEqual(rows[0].generated.titles, ['Раз', 'Два', 'Три']);
    // Проверка автором — обязательный шаг: наружу ничего не уходит, пока он
    // не нажал.
    assert.equal(rows[0].pipeline_state, 'review');
    assert.equal(queue.added[0].name, 'makeClips');
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/generate-texts.test.js`
Ожидается: FAIL — модуль не найден.

- [ ] **Шаг 3: Написать `src/jobs/generate-texts.js`**

```js
// Шаг конвейера: расшифровка → заголовки, описание, теги, главы.
//
// Задача — дать автору готовый черновик, который останется поправить, а не
// писать с нуля. Зачем три заголовка, а не один: выбрать из трёх быстрее и
// честнее, чем править единственный, который модель выдала как истину.
// Вызывается воркером по имени JOBS.generateTexts.

// Сколько текста расшифровки отдаём модели. Часовой урок — это десятки тысяч
// знаков, они не влезут в запрос и не нужны: тема и структура видны по началу
// и по равномерной выборке.
const MAX_PROMPT_CHARS = 12_000;

/**
 * Разбирает ответ модели.
 * Вынесено отдельно и проверяется тестом: модель возвращает JSON то в
 * разметке, то с пояснениями вокруг, то с одним заголовком вместо трёх.
 * Ни один из этих капризов не должен останавливать конвейер — автор увидит
 * то, что пришло, и допишет остальное руками.
 */
export function parseModelAnswer(answer) {
  const пусто = { titles: [], description: '', tags: [], chapters: [] };
  const match = String(answer).match(/\{[\s\S]*\}/);
  if (!match) return пусто;

  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return пусто;
  }

  return {
    titles: Array.isArray(parsed.titles) ? parsed.titles.map(String).filter(Boolean) : [],
    description: String(parsed.description ?? ''),
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).filter(Boolean) : [],
    chapters: Array.isArray(parsed.chapters)
      ? parsed.chapters
          .filter((c) => c && c.title)
          .map((c) => ({ startedMs: Number(c.startedMs ?? 0), title: String(c.title) }))
      : []
  };
}

/** Собирает запрос к модели. Формат ответа задаётся жёстко — иначе разбирать нечего. */
function buildPrompt(text) {
  const sample = text.slice(0, MAX_PROMPT_CHARS);
  return `Ты помогаешь автору видеоуроков о разработке. Ниже расшифровка урока.

Верни СТРОГО один объект JSON без пояснений и без разметки, с полями:
- "titles": ровно три варианта заголовка, каждый до 70 знаков, без кавычек и эмодзи;
- "description": описание урока на 2–4 предложения, для площадки;
- "tags": до пяти тегов строчными буквами, латиницей или по-русски, без решёток;
- "chapters": главы урока, каждая {"startedMs": число, "title": строка до 50 знаков}.

Расшифровка:
${sample}`;
}

export function makeGenerateTexts(config, pool, queue, speech) {
  return async ({ lessonId }) => {
    if (!speech) throw new Error('Генерация текстов не настроена: нет ключей Яндекс Облака');

    const { rows } = await pool.query('SELECT text FROM transcripts WHERE lesson_id = $1', [
      lessonId
    ]);
    if (!rows.length) throw new Error('нет расшифровки — писать тексты не из чего');

    const answer = await speech.generate(buildPrompt(rows[0].text));
    const generated = parseModelAnswer(answer);

    await pool.query(
      `UPDATE lessons SET generated = $1::jsonb, pipeline_state = 'review', pipeline_error = NULL
        WHERE id = $2`,
      [JSON.stringify(generated), lessonId]
    );

    // Нарезки делаются после текстов: главы задают, откуда резать.
    await queue.add('makeClips', { lessonId });
    return { titles: generated.titles.length, chapters: generated.chapters.length };
  };
}
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Выполнить: `node --test test/generate-texts.test.js`
Ожидается: 4 теста PASS.

- [ ] **Шаг 5: Коммит**

```bash
git add src/jobs/generate-texts.js src/worker.js test/generate-texts.test.js
git commit -m "feat: заголовки, описание, теги и главы от модели"
```

### Задача 12: Экран проверки — СДАНО 2026-09-03

**Файлы:**
- Создать: `src/views/admin-review.js`, `src/routes/admin.js`, `test/admin-review.test.js`
- Изменить: `src/routes/pages.js`, `public/admin.js`, `public/styles.css`

**Интерфейсы:**
- Потребляет: `lessons.generated`, `pipeline_state`, `assets`.
- Отдаёт дальше: `GET /admin/lesson/:slug` — экран проверки;
  `POST /api/admin/lessons/:slug/approve` — принять выбранный заголовок,
  описание и теги; `POST /api/admin/lessons/:slug/retry` — повторить упавший шаг.

- [ ] **Шаг 1: Написать падающий тест**

`test/admin-review.test.js`:

```js
// Экран проверки — обязательный ручной шаг: наружу ничего не уходит, пока
// автор не нажал. Здесь проверяется, что он видит все три заголовка, может
// выбрать один, и что до нажатия урок остаётся черновиком.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveLesson } from '../src/services/lessons.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://soloaijourney.online',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', botId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: '' },
  media: { dir: '/tmp', ttlHours: 168 }
};

async function seed(pool) {
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Черновик' });
  await pool.query(
    `UPDATE lessons SET pipeline_state = 'review', generated = $1::jsonb WHERE id = $2`,
    [
      JSON.stringify({
        titles: ['Первый', 'Второй', 'Третий'],
        description: 'Описание от модели',
        tags: ['docker'],
        chapters: [{ startedMs: 0, title: 'Начало' }]
      }),
      lesson.id
    ]
  );
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  return { lesson, adminId: Number(rows[0].id) };
}

function asAdmin(adminId) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${signSession({ userId: adminId, role: 'admin' }, config.jwtSecret)}`
  };
}

test('автор видит три заголовка и описание', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { adminId } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (
        await fetch(`${base}/admin/lesson/urok`, {
          headers: { Accept: 'text/html', ...asAdmin(adminId) }
        })
      ).text();
      assert.match(html, /Первый/);
      assert.match(html, /Второй/);
      assert.match(html, /Третий/);
      assert.match(html, /Описание от модели/);
      assert.match(html, /Начало/);
    });
  });
});

test('до нажатия урок остаётся черновиком', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson } = await seed(pool);
    const { rows } = await pool.query('SELECT status FROM lessons WHERE id = $1', [lesson.id]);
    // Спека: наружу ничего не уходит, пока автор не нажал.
    assert.equal(rows[0].status, 'draft');
  });
});

test('нажатие переносит выбранное в карточку урока', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, adminId } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons/urok/approve`, {
        method: 'POST',
        headers: asAdmin(adminId),
        body: JSON.stringify({
          title: 'Второй',
          description: 'Поправленное описание',
          tags: ['docker', 'vps']
        })
      });
      assert.equal(res.status, 200);
    });

    const { rows } = await pool.query(
      `SELECT l.title, l.description, l.status, l.pipeline_state,
              array_agg(t.slug ORDER BY t.slug) AS tags
         FROM lessons l
         LEFT JOIN lesson_tags lt ON lt.lesson_id = l.id
         LEFT JOIN tags t ON t.id = lt.tag_id
        WHERE l.id = $1 GROUP BY l.id`,
      [lesson.id]
    );
    assert.equal(rows[0].title, 'Второй');
    assert.equal(rows[0].description, 'Поправленное описание');
    assert.deepEqual(rows[0].tags, ['docker', 'vps']);
    // Урок готов к публикации, но публикует его отдельное действие: приёмка
    // текстов и выпуск наружу — разные решения автора.
    assert.equal(rows[0].status, 'draft');
    assert.equal(rows[0].pipeline_state, 'idle');
  });
});

test('чужой на экран проверки не попадает', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    const { rows } = await pool.query(
      `INSERT INTO users (display_name, role) VALUES ('Пётр', 'user') RETURNING id`
    );
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/admin/lesson/urok`, {
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

Выполнить: `node --test test/admin-review.test.js`
Ожидается: FAIL — 404 на `/admin/lesson/urok`.

- [ ] **Шаг 3: Написать `src/views/admin-review.js`**

```js
// Экран проверки урока.
//
// Задача — показать автору всё, что придумала машина, и дать поправить перед
// выпуском. Это обязательный ручной шаг из спеки: наружу ничего не уходит,
// пока он не нажал. Без него автопубликации не будет доверия.
// Вызывается из src/routes/pages.js по адресу /admin/lesson/:slug.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';

/** Время главы в виде, привычном зрителю: 12:34. */
function chapterTime(ms) {
  const total = Math.floor(ms / 1000);
  const minutes = String(Math.floor(total / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function adminReviewPage({ config, user, lesson, generated, clips }) {
  const titles = generated.titles ?? [];
  const titleChoices = titles.length
    ? titles
        .map(
          (title, index) => `<label class="choice">
    <input type="radio" name="title" value="${escapeHtml(title)}" ${index === 0 ? 'checked' : ''}>
    <span>${escapeHtml(title)}</span>
  </label>`
        )
        .join('')
    : '<p class="hint">Модель не предложила заголовков — впишите свой ниже.</p>';

  const chapters = (generated.chapters ?? [])
    .map(
      (chapter) =>
        `<li><span class="meta">${chapterTime(chapter.startedMs)}</span> ${escapeHtml(chapter.title)}</li>`
    )
    .join('');

  return layout({
    config,
    user,
    path: `/admin/lesson/${encodeURIComponent(lesson.slug)}`,
    title: `Проверка: ${lesson.title} — Solo AI Journey`,
    description: 'Проверка того, что подготовила машина, перед выпуском урока.',
    body: `
<h1>Проверка урока</h1>
<p class="lead">Всё, что ниже, придумала машина. Наружу ничего не уйдёт, пока вы
не нажмёте «Принять».</p>

${
  lesson.pipelineError
    ? `<p class="toast error" style="position:static;transform:none">Последняя ошибка: ${escapeHtml(lesson.pipelineError)}
       <button class="button" type="button" data-retry="${escapeHtml(lesson.slug)}">Повторить шаг</button></p>`
    : ''
}

<form id="review-form" class="card" data-lesson="${escapeHtml(lesson.slug)}">
  <fieldset>
    <legend>Заголовок</legend>
    ${titleChoices}
    <label>Свой вариант
      <input name="customTitle" maxlength="200" placeholder="если ни один не подошёл">
    </label>
  </fieldset>

  <label>Описание
    <textarea name="description" rows="4">${escapeHtml(generated.description ?? '')}</textarea>
  </label>

  <label>Теги через запятую
    <input name="tags" value="${escapeHtml((generated.tags ?? []).join(', '))}">
  </label>

  ${chapters ? `<div><h2>Главы</h2><ul class="chapters">${chapters}</ul></div>` : ''}

  ${
    clips.length
      ? `<div><h2>Нарезки</h2><ul class="clips">${clips
          .map(
            (clip) =>
              `<li><label class="choice"><input type="checkbox" name="clip" value="${clip.id}" checked>
               <span>${escapeHtml(clip.path.split('/').at(-1))}</span></label></li>`
          )
          .join('')}</ul></div>`
      : '<p class="hint">Нарезки ещё готовятся.</p>'
  }

  <div class="form-row">
    <span class="hint">После нажатия урок можно публиковать.</span>
    <button class="button-brand" type="submit">Принять</button>
  </div>
</form>`
  });
}
```

- [ ] **Шаг 4: Написать `src/routes/admin.js`**

```js
// Действия автора над уроком: приёмка и повтор упавшего шага.
//
// Задача — перенести выбранное автором в карточку урока и дать перезапустить
// конвейер, если шаг упал. Зачем отдельным файлом от routes/lessons.js: там
// живёт витрина для всех, здесь — кабинет для одного человека, и правила
// доступа у них разные.
// Подключается в src/app.js по префиксу /api/admin.
import { Router } from 'express';
import { requireAdmin } from '../middleware/guards.js';
import { PublicError } from '../middleware/errors.js';
import { saveLesson, setLessonTags, getLessonBySlug } from '../services/lessons.js';

export function adminRoutes(config, pool, queue) {
  const router = Router();
  router.use(requireAdmin);

  router.post('/lessons/:slug/approve', async (req, res) => {
    const lesson = await getLessonBySlug(pool, req.params.slug, { includeDrafts: true });
    if (!lesson) throw new PublicError('Урок не найден', 404);

    const title = String(req.body?.title ?? '').trim();
    if (!title) throw new PublicError('Заголовок не выбран');

    const saved = await saveLesson(pool, {
      slug: lesson.slug,
      title,
      description: String(req.body?.description ?? '')
    });
    if (Array.isArray(req.body?.tags)) await setLessonTags(pool, saved.id, req.body.tags);

    // Конвейер отработал, урок ждёт решения о публикации. Публикация — второе,
    // отдельное действие: принять тексты и выпустить наружу это разные решения.
    await pool.query(
      `UPDATE lessons SET pipeline_state = 'idle', pipeline_error = NULL WHERE id = $1`,
      [saved.id]
    );
    res.json({ lesson: saved });
  });

  router.post('/lessons/:slug/retry', async (req, res) => {
    const lesson = await getLessonBySlug(pool, req.params.slug, { includeDrafts: true });
    if (!lesson) throw new PublicError('Урок не найден', 404);

    // Повтор начинается с извлечения звука: это первый шаг, а всё, что уже
    // сделано, шаги пропустят сами — результат лежит в базе.
    await queue.add('extractAudio', { lessonId: lesson.id });
    await pool.query(
      `UPDATE lessons SET pipeline_state = 'processing', pipeline_error = NULL WHERE id = $1`,
      [lesson.id]
    );
    res.json({ ok: true });
  });

  return router;
}
```

- [ ] **Шаг 5: Подключить и дописать клиент**

В `src/app.js`:

```js
import { createQueue } from './queue.js';
import { adminRoutes } from './routes/admin.js';

// Очередь нужна приложению, чтобы ставить задачи: сами их исполняет воркер.
app.locals.queue = createQueue(config);
app.use('/api/admin', adminRoutes(config, pool, app.locals.queue));
```

В `src/routes/pages.js` — страница проверки под `requireAdmin`, читает урок,
`generated` и нарезки из `assets` с `kind = 'clip'`.

В `public/admin.js` — отправка формы проверки:

```js
const reviewForm = document.querySelector('#review-form');
reviewForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(reviewForm);
  const custom = String(data.get('customTitle') ?? '').trim();
  const body = {
    // Свой вариант побеждает выбранный: раз человек его написал, он и нужен.
    title: custom || data.get('title'),
    description: data.get('description'),
    tags: String(data.get('tags') ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
  };
  const slug = reviewForm.dataset.lesson;
  const answer = await request(`/api/admin/lessons/${slug}/approve`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  if (answer) {
    toast('Принято. Урок готов к публикации.');
    location.href = `/lesson/${slug}`;
  }
});
```

- [ ] **Шаг 6: Убедиться, что тесты проходят**

Выполнить: `npm test`
Ожидается: все PASS.

- [ ] **Шаг 7: Коммит**

```bash
git add src/views/admin-review.js src/routes/admin.js src/routes/pages.js \
        src/app.js public/admin.js public/styles.css test/admin-review.test.js
git commit -m "feat: экран проверки урока перед выпуском"
```

### Задача 13: Поиск по урокам

**Файлы:**
- Создать: `migrations/009_transcript_search.sql`, `src/routes/search.js`,
  `src/views/search.js`, `test/search.test.js`
- Изменить: `src/routes/pages.js`

**Интерфейсы:**
- Потребляет: `transcript_segments`.
- Отдаёт дальше: `searchSegments(pool, query, limit)` → массив
  `{ lessonSlug, lessonTitle, startedMs, text }`; `GET /search?q=…` — страница
  результатов со ссылками вида `/lesson/<slug>#t=<секунда>`.

- [ ] **Шаг 1: Написать падающий тест**

`test/search.test.js`:

```js
// Поиск по словам внутри урока — то, ради чего расшифровка и хранится
// отрезками. Проверяется, что найденное ведёт на нужную секунду и что русская
// морфология работает: «контейнеры» должны находиться по слову «контейнер».
import test from 'node:test';
import assert from 'node:assert/strict';
import { searchSegments } from '../src/routes/search.js';
import { saveLesson } from '../src/services/lessons.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

async function seed(pool) {
  const lesson = await saveLesson(pool, {
    slug: 'docker-1',
    title: 'Docker',
    status: 'published',
    publishedAt: new Date()
  });
  await pool.query(
    `INSERT INTO transcript_segments (lesson_id, started_ms, ended_ms, text) VALUES
     ($1, 0, 5000, 'сегодня разберём контейнеры и образы'),
     ($1, 65000, 70000, 'теперь про миграции базы данных')`,
    [lesson.id]
  );
  return lesson;
}

test('слово находится с точностью до секунды', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    const found = await searchSegments(pool, 'миграции', 10);
    assert.equal(found.length, 1);
    assert.equal(found[0].lessonSlug, 'docker-1');
    // 65 секунда — туда и должна вести ссылка.
    assert.equal(found[0].startedMs, 65000);
  });
});

test('русская морфология учитывается', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    // В тексте «контейнеры», ищем «контейнер» — без русского словаря не найдётся.
    const found = await searchSegments(pool, 'контейнер', 10);
    assert.equal(found.length, 1);
  });
});

test('черновики в поиск не попадают', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'chernovik', title: 'Черновик' });
    await pool.query(
      `INSERT INTO transcript_segments (lesson_id, started_ms, ended_ms, text)
       VALUES ($1, 0, 1000, 'секретное слово')`,
      [lesson.id]
    );
    assert.deepEqual(await searchSegments(pool, 'секретное', 10), []);
  });
});

test('пустой запрос ничего не ищет', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    assert.deepEqual(await searchSegments(pool, '   ', 10), []);
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/search.test.js`
Ожидается: FAIL — модуль не найден.

- [ ] **Шаг 3: Написать `migrations/009_transcript_search.sql`**

```sql
-- Поиск по словам внутри уроков.
--
-- Встроенный полнотекстовый поиск postgres с русским словарём: он знает
-- морфологию, поэтому «контейнер» находит «контейнеры». Отдельный поисковый
-- движок сюда не ставим — это ещё один сервис на машине, где памяти полтора
-- гигабайта, ради десятков уроков.
--
-- Индекс по вычисляемому полю, а не по колонке: хранить второй раз тот же
-- текст незачем, а GIN по выражению работает так же.
CREATE INDEX transcript_segments_search_idx
  ON transcript_segments USING gin (to_tsvector('russian', text));
```

- [ ] **Шаг 4: Написать `src/routes/search.js`**

```js
// Поиск по расшифровкам уроков.
//
// Задача — найти слово внутри урока и привести зрителя на нужную секунду.
// Ради этого расшифровка и хранится отрезками, а не сплошным текстом.
// Вызывается из src/routes/pages.js (страница) и src/app.js (JSON API).
import { Router } from 'express';
import { searchPage } from '../views/search.js';

// Сколько находок показываем. Больше двадцати человек не читает, а запрос по
// всем урокам с подсветкой стоит тем дороже, чем шире выборка.
const DEFAULT_LIMIT = 20;

/**
 * Ищет отрезки по словам. Черновики не ищутся: их не видно и в витрине.
 * Вызывается со страницы поиска и из JSON API.
 */
export async function searchSegments(pool, query, limit = DEFAULT_LIMIT) {
  const text = String(query ?? '').trim();
  if (!text) return [];

  const { rows } = await pool.query(
    `SELECT l.slug, l.title, s.started_ms,
            ts_headline('russian', s.text, plainto_tsquery('russian', $1),
                        'StartSel=<mark>, StopSel=</mark>, MaxWords=25, MinWords=10') AS excerpt
       FROM transcript_segments s
       JOIN lessons l ON l.id = s.lesson_id
      WHERE l.status = 'published'
        AND to_tsvector('russian', s.text) @@ plainto_tsquery('russian', $1)
      ORDER BY ts_rank(to_tsvector('russian', s.text), plainto_tsquery('russian', $1)) DESC,
               s.started_ms
      LIMIT $2`,
    [text, limit]
  );

  return rows.map((r) => ({
    lessonSlug: r.slug,
    lessonTitle: r.title,
    startedMs: r.started_ms,
    text: r.excerpt
  }));
}

export function searchRoutes(config, pool) {
  const router = Router();

  router.get('/search', async (req, res) => {
    const query = String(req.query.q ?? '');
    const results = await searchSegments(pool, query);
    res.json({ results });
  });

  return router;
}

export { searchPage };
```

- [ ] **Шаг 5: Написать `src/views/search.js` и подключить страницу**

Страница выводит находки списком; каждая ведёт на
`/lesson/<slug>#t=<секунда>`. Подсветка приходит из базы уже с тегами
`<mark>`, поэтому **этот кусок вставляется как разметка** — но только он:
текст в него кладёт `ts_headline`, а не человек.

```js
// Страница результатов поиска.
// Задача — показать, в каком уроке и на какой секунде нашлось слово.
// Вызывается из src/routes/pages.js по адресу /search.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';

function seconds(ms) {
  return Math.floor(ms / 1000);
}

export function searchPage({ config, user, query, results }) {
  return layout({
    config,
    user,
    path: '/search',
    title: query ? `Поиск: ${query} — Solo AI Journey` : 'Поиск — Solo AI Journey',
    description: 'Поиск по словам внутри уроков.',
    body: `
<h1>Поиск по урокам</h1>
<form class="card" action="/search" method="get">
  <div class="form-row">
    <input name="q" value="${escapeHtml(query)}" placeholder="слово из урока" required>
    <button class="button-brand" type="submit">Найти</button>
  </div>
</form>

${
  query && !results.length
    ? '<p class="hint">Ничего не нашлось. Попробуйте другое слово.</p>'
    : ''
}

<ul class="search-results">
  ${results
    .map(
      (item) => `<li>
    <a href="/lesson/${encodeURIComponent(item.lessonSlug)}#t=${seconds(item.startedMs)}">
      ${escapeHtml(item.lessonTitle)}
      <span class="meta">${Math.floor(seconds(item.startedMs) / 60)} мин ${seconds(item.startedMs) % 60} с</span>
    </a>
    <p>${item.text}</p>
  </li>`
    )
    .join('')}
</ul>`
  });
}
```

Подсветку от `ts_headline` вставляем как разметку осознанно: её собирает
postgres из нашего же текста, а не человек со стороны. Само слово запроса
проходит через `plainto_tsquery` и в разметку не попадает.

- [ ] **Шаг 6: Убедиться, что тесты проходят**

Выполнить: `npm test`
Ожидается: все PASS.

- [ ] **Шаг 7: Проверить критерий приёмки этапа 5**

На настоящем уроке, загруженном в задаче 9:

1. Открыть `/admin/lesson/<slug>` — видны три заголовка, описание, главы.
2. `/search?q=<слово из середины урока>` — находка ведёт на нужную секунду.
3. Файлы субтитров лежат: `docker compose exec worker ls -l /app/media/lesson-*/`.

- [ ] **Шаг 8: Коммит**

```bash
git add migrations/009_transcript_search.sql src/routes/search.js src/views/search.js \
        src/routes/pages.js test/search.test.js
git commit -m "feat: поиск по словам внутри уроков с переходом на секунду"
```

---

# Этап 6 — конвейер, видео

**Критерий приёмки заказчика:** из часового урока вышли смотрибельные шортсы;
по сроку файлы исчезли, карточка цела.

### Задача 14: Вертикальные нарезки со вшитыми субтитрами

**Файлы:**
- Создать: `src/jobs/make-clips.js`, `test/make-clips.test.js`
- Изменить: `src/lib/ffmpeg.js`, `src/worker.js`

**Интерфейсы:**
- Потребляет: `lessons.generated.chapters`, исходник, файл субтитров.
- Отдаёт дальше: `pickClipRanges(chapters, durationSeconds)` →
  `[{ startedMs, endedMs, title }]`; `ffmpegArgsForClip({ input, subtitles,
  startSeconds, durationSeconds, output })`; обработчик `makeClips({ lessonId })`,
  кладёт файлы `kind = 'clip'` и ставит следующий шаг `makeCover`.

- [ ] **Шаг 1: Написать падающий тест**

`test/make-clips.test.js`:

```js
// Проверка выбора фрагментов и аргументов ffmpeg. Сам ffmpeg не проверяем —
// он чужой и рабочий; проверяем то, что решаем мы: откуда резать, сколько и
// как получить вертикаль из горизонтального кадра.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickClipRanges, ffmpegArgsForClip } from '../src/jobs/make-clips.js';

test('фрагменты берутся от глав и не длиннее минуты', () => {
  const chapters = [
    { startedMs: 0, title: 'Начало' },
    { startedMs: 600_000, title: 'Середина' },
    { startedMs: 3_000_000, title: 'Конец' }
  ];
  const ranges = pickClipRanges(chapters, 3600);
  assert.equal(ranges.length, 3);
  for (const range of ranges) {
    const seconds = (range.endedMs - range.startedMs) / 1000;
    // Вертикальные ролики живут секундами: минута — потолок для площадок.
    assert.ok(seconds > 0 && seconds <= 60, `фрагмент длиной ${seconds} с`);
  }
});

test('фрагмент не вылезает за конец урока', () => {
  const ranges = pickClipRanges([{ startedMs: 3_580_000, title: 'Финал' }], 3600);
  assert.ok(ranges[0].endedMs <= 3_600_000);
});

test('без глав нарезать нечего — это не ошибка', () => {
  // Модель могла не выделить глав: значит нарезок не будет, а конвейер
  // продолжится. Падать здесь незачем.
  assert.deepEqual(pickClipRanges([], 3600), []);
});

test('кадр обрезается в вертикаль и в него вшиваются субтитры', () => {
  const args = ffmpegArgsForClip({
    input: '/media/source.mp4',
    subtitles: '/media/subtitles.srt',
    startSeconds: 60,
    durationSeconds: 45,
    output: '/media/clip-1.mp4'
  });
  const filter = args[args.indexOf('-vf') + 1];
  // 1080x1920 — вертикаль площадок. Кадр берётся по центру: без этого из
  // горизонтального ролика вышли бы поля сверху и снизу.
  assert.match(filter, /crop=/);
  assert.match(filter, /scale=1080:1920/);
  // Субтитры вшиваются в картинку: площадки коротких роликов отдельный файл
  // субтитров не принимают.
  assert.match(filter, /subtitles=/);
  // Перемотка ДО -i: иначе ffmpeg читает файл с начала и час ждёт на каждом
  // фрагменте.
  assert.ok(args.indexOf('-ss') < args.indexOf('-i'));
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/make-clips.test.js`
Ожидается: FAIL — модуль не найден.

- [ ] **Шаг 3: Написать `src/jobs/make-clips.js`**

```js
// Шаг конвейера: главы → вертикальные нарезки со вшитыми субтитрами.
//
// Задача — получить из часового урока несколько коротких роликов для площадок
// коротких видео. Зачем от глав: глава — это готовая смысловая единица,
// найденная моделью; резать по таймеру значило бы обрывать на полуслове.
// Вызывается воркером по имени JOBS.makeClips.
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { runFfmpeg } from '../lib/ffmpeg.js';
import { mediaPath, registerAsset, assetById } from '../services/media.js';

// Длина фрагмента. Минута — потолок площадок коротких роликов; сорок пять
// секунд оставляют запас и не обрывают мысль на полуслове.
const CLIP_SECONDS = 45;

// Сколько нарезок делаем максимум. На двух ядрах каждая — минуты работы,
// и десяток фрагментов занял бы машину на час.
const MAX_CLIPS = 5;

/**
 * Выбирает, откуда резать.
 * Возвращает пустой список, если глав нет: модель могла их не выделить, и это
 * не повод останавливать конвейер.
 */
export function pickClipRanges(chapters, durationSeconds) {
  const limitMs = durationSeconds * 1000;
  return chapters.slice(0, MAX_CLIPS).map((chapter) => {
    const startedMs = Math.max(0, Math.min(chapter.startedMs, limitMs - 1000));
    const endedMs = Math.min(startedMs + CLIP_SECONDS * 1000, limitMs);
    return { startedMs, endedMs, title: chapter.title };
  });
}

/**
 * Аргументы ffmpeg для одного фрагмента.
 * Перемотка стоит ДО -i намеренно: так ffmpeg прыгает к нужному месту, а не
 * читает часовой файл с начала на каждом фрагменте.
 */
export function ffmpegArgsForClip({ input, subtitles, startSeconds, durationSeconds, output }) {
  // Обрезаем по центру до вертикали 9:16 и масштабируем до 1080x1920.
  // Субтитры вшиваются в картинку: площадки коротких роликов отдельный файл
  // субтитров не принимают, а без подписей такие ролики не смотрят без звука.
  const filter = [
    'crop=ih*9/16:ih',
    'scale=1080:1920',
    `subtitles='${subtitles}':force_style='FontSize=18,Outline=2,Alignment=2,MarginV=120'`
  ].join(',');

  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-ss', String(startSeconds),
    '-i', input,
    '-t', String(durationSeconds),
    '-vf', filter,
    '-c:v', 'libx264',
    // veryfast — сознательный размен: на двух ядрах медленные пресеты
    // занимают машину на десятки минут и роняют отзывчивость портала.
    '-preset', 'veryfast',
    '-crf', '24',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-y',
    output
  ];
}

export function makeMakeClips(config, pool, queue) {
  return async ({ lessonId }) => {
    const { rows } = await pool.query(
      'SELECT generated, duration_seconds, source_asset_id FROM lessons WHERE id = $1',
      [lessonId]
    );
    const lesson = rows[0];
    if (!lesson?.source_asset_id) throw new Error('у урока нет исходника');

    const chapters = lesson.generated?.chapters ?? [];
    const ranges = pickClipRanges(chapters, lesson.duration_seconds ?? 0);
    if (!ranges.length) {
      await queue.add('makeCover', { lessonId });
      return { clips: 0 };
    }

    const source = await assetById(pool, lesson.source_asset_id);
    const input = mediaPath(config, source.path);
    const dir = path.dirname(source.path);
    const subtitles = mediaPath(config, `${dir}/subtitles.srt`);
    await mkdir(mediaPath(config, dir), { recursive: true });

    for (const [index, range] of ranges.entries()) {
      const relative = `${dir}/clip-${index + 1}.mp4`;
      await runFfmpeg(
        ffmpegArgsForClip({
          input,
          subtitles,
          startSeconds: range.startedMs / 1000,
          durationSeconds: (range.endedMs - range.startedMs) / 1000,
          output: mediaPath(config, relative)
        })
      );
      const { size } = await stat(mediaPath(config, relative));
      await registerAsset(pool, config, {
        lessonId,
        kind: 'clip',
        relativePath: relative,
        bytes: size
      });
    }

    await queue.add('makeCover', { lessonId });
    return { clips: ranges.length };
  };
}
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Выполнить: `node --test test/make-clips.test.js`
Ожидается: 4 теста PASS.

- [ ] **Шаг 5: Проверить на настоящем файле**

```bash
docker compose exec worker sh -c '
  ffmpeg -f lavfi -i testsrc=s=1280x720:d=20 -f lavfi -i sine -shortest /app/media/proba.mp4 -y
  printf "1\n00:00:01,000 --> 00:00:05,000\nпроверка субтитров\n\n" > /app/media/proba.srt
  ffmpeg -hide_banner -loglevel error -ss 2 -i /app/media/proba.mp4 -t 5 \
    -vf "crop=ih*9/16:ih,scale=1080:1920,subtitles=/app/media/proba.srt" \
    -c:v libx264 -preset veryfast -crf 24 /app/media/proba-clip.mp4 -y
  ls -l /app/media/proba-clip.mp4'
```

Ожидается: файл создан. Скачать и посмотреть глазами: вертикальный кадр,
подпись читается, звук на месте.

- [ ] **Шаг 6: Коммит**

```bash
git add src/jobs/make-clips.js src/worker.js test/make-clips.test.js
git commit -m "feat: вертикальные нарезки со вшитыми субтитрами"
```

### Задача 15: Кадр на обложку

**Файлы:**
- Создать: `src/jobs/make-cover.js`, `test/make-cover.test.js`
- Изменить: `src/worker.js`

**Интерфейсы:**
- Отдаёт дальше: `coverTimeSeconds(durationSeconds)` → секунда, с которой брать
  кадр; `ffmpegArgsForCover({ input, atSeconds, output })`; обработчик
  `makeCover({ lessonId })`, кладёт `kind = 'cover'`, пишет `lessons.cover_url`,
  переводит `pipeline_state` в `review`.

- [ ] **Шаг 1: Написать падающий тест**

`test/make-cover.test.js`:

```js
// Кадр на обложку. Проверяется выбор момента и аргументы: сам ffmpeg чужой.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coverTimeSeconds, ffmpegArgsForCover } from '../src/jobs/make-cover.js';

test('кадр берётся не с самого начала', () => {
  // Первые секунды урока — это заставка и «здравствуйте», кадр оттуда пустой.
  assert.ok(coverTimeSeconds(3600) > 10);
  assert.ok(coverTimeSeconds(3600) < 3600);
});

test('на коротком ролике кадр всё равно находится', () => {
  const at = coverTimeSeconds(8);
  assert.ok(at >= 0 && at < 8);
});

test('обложка сохраняется одним кадром нужного размера', () => {
  const args = ffmpegArgsForCover({ input: '/m/in.mp4', atSeconds: 42, output: '/m/cover.jpg' });
  assert.ok(args.includes('-frames:v'));
  assert.ok(args.includes('1'));
  // 1280 по ширине — то, что просят площадки для превью; больше не нужно.
  assert.match(args[args.indexOf('-vf') + 1], /scale=1280:-2/);
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/make-cover.test.js`
Ожидается: FAIL — модуль не найден.

- [ ] **Шаг 3: Написать `src/jobs/make-cover.js`**

```js
// Шаг конвейера: кадр на обложку.
//
// Задача — получить картинку для карточки урока и превью в мессенджерах.
// Зачем не первый кадр: там заставка и «здравствуйте», а на превью нужен
// содержательный кадр.
// Вызывается воркером по имени JOBS.makeCover.
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { runFfmpeg } from '../lib/ffmpeg.js';
import { mediaPath, registerAsset, assetById } from '../services/media.js';

// Доля урока, с которой берём кадр. Десятая часть: заставка уже кончилась,
// а до сути автор дошёл. Нижняя граница — на случай очень коротких роликов.
const COVER_SHARE = 0.1;
const MIN_SECONDS = 12;

export function coverTimeSeconds(durationSeconds) {
  if (!durationSeconds || durationSeconds <= MIN_SECONDS) {
    return Math.max(0, Math.floor((durationSeconds ?? 0) / 2));
  }
  return Math.max(MIN_SECONDS, Math.floor(durationSeconds * COVER_SHARE));
}

export function ffmpegArgsForCover({ input, atSeconds, output }) {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-ss', String(atSeconds),
    '-i', input,
    '-frames:v', '1',
    // 1280 по ширине — то, что просят площадки для превью; -2 сохраняет
    // пропорции и держит высоту чётной, иначе кодек ругается.
    '-vf', 'scale=1280:-2',
    '-q:v', '3',
    '-y',
    output
  ];
}

export function makeMakeCover(config, pool) {
  return async ({ lessonId }) => {
    const { rows } = await pool.query(
      'SELECT source_asset_id, duration_seconds FROM lessons WHERE id = $1',
      [lessonId]
    );
    if (!rows[0]?.source_asset_id) throw new Error('у урока нет исходника');

    const source = await assetById(pool, rows[0].source_asset_id);
    const dir = path.dirname(source.path);
    const relative = `${dir}/cover.jpg`;
    await mkdir(mediaPath(config, dir), { recursive: true });

    await runFfmpeg(
      ffmpegArgsForCover({
        input: mediaPath(config, source.path),
        atSeconds: coverTimeSeconds(rows[0].duration_seconds),
        output: mediaPath(config, relative)
      })
    );

    const { size } = await stat(mediaPath(config, relative));
    const asset = await registerAsset(pool, config, {
      lessonId,
      kind: 'cover',
      relativePath: relative,
      bytes: size
    });

    // Обложка отдаётся по той же временной ссылке, что и остальной буфер:
    // отдельного хранилища картинок портал не заводит.
    await pool.query(
      `UPDATE lessons SET cover_url = $1, pipeline_state = 'review', pipeline_error = NULL
        WHERE id = $2`,
      [`/media-asset/${asset.id}`, lessonId]
    );

    return { coverAssetId: asset.id };
  };
}
```

Добавить в `src/routes/media.js` постоянный адрес обложки — она нужна карточке
урока долго, и временная ссылка здесь не годится:

```js
  // Обложка — единственный файл буфера, который показывается всем: она стоит
  // в карточке урока и в превью ссылки. Токен для неё был бы бессмыслен —
  // ссылку видят все, кто видит урок.
  router.get('/asset/:id', async (req, res) => {
    const asset = await assetById(pool, Number(req.params.id));
    if (!asset || asset.kind !== 'cover') throw new PublicError('Файл не найден', 404);
    res.set('Cache-Control', 'public, max-age=86400');
    res.sendFile(mediaPath(config, asset.path));
  });
```

и подключить его в `src/app.js` как `app.use('/media-asset', ...)`.

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Выполнить: `npm test`
Ожидается: все PASS.

- [ ] **Шаг 5: Коммит**

```bash
git add src/jobs/make-cover.js src/routes/media.js src/app.js src/worker.js \
        test/make-cover.test.js
git commit -m "feat: кадр на обложку урока"
```

### Задача 16: Автоудаление буфера — СДАНО 2026-09-03

**Файлы:**
- Создать: `src/jobs/cleanup-media.js`, `test/cleanup-media.test.js`
- Изменить: `src/worker.js`

**Интерфейсы:**
- Потребляет: `listExpired`, `forgetAsset`, `mediaPath`.
- Отдаёт дальше: обработчик `cleanupMedia()`, ставится по расписанию раз в час.

- [ ] **Шаг 1: Написать падающий тест**

`test/cleanup-media.test.js`:

```js
// Автоудаление буфера — то, чем портал отличается от видеоархива. Спека
// прямо запрещает хранить архив: файлы живут срок и уходят, карточка урока
// остаётся.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeCleanupMedia } from '../src/jobs/cleanup-media.js';
import { saveLesson } from '../src/services/lessons.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

async function makeConfig() {
  return { media: { dir: await mkdtemp(path.join(tmpdir(), 'portal-clean-')), ttlHours: 168 } };
}

test('просроченный файл исчезает, карточка урока остаётся', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await mkdir(path.join(config.media.dir, 'urok'), { recursive: true });
    const file = path.join(config.media.dir, 'urok/source.mp4');
    await writeFile(file, 'данные');
    await pool.query(
      `INSERT INTO assets (lesson_id, kind, path, bytes, expires_at)
       VALUES ($1, 'source', 'urok/source.mp4', 6, now() - interval '1 hour')`,
      [lesson.id]
    );

    const removed = await makeCleanupMedia(config, pool)();
    assert.equal(removed.removed, 1);
    await assert.rejects(access(file));
    const { rows } = await pool.query('SELECT count(*)::int n FROM lessons');
    assert.equal(rows[0].n, 1);
  });
});

test('живой файл не трогаем', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await mkdir(path.join(config.media.dir, 'urok'), { recursive: true });
    const file = path.join(config.media.dir, 'urok/live.mp4');
    await writeFile(file, 'данные');
    await pool.query(
      `INSERT INTO assets (lesson_id, kind, path, bytes, expires_at)
       VALUES ($1, 'source', 'urok/live.mp4', 6, now() + interval '1 day')`,
      [lesson.id]
    );
    await makeCleanupMedia(config, pool)();
    await access(file);
  });
});

test('пропавший файл не мешает уборке', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    // Файла на диске нет — например, том пересоздали. Запись в учёте всё равно
    // должна уйти, иначе уборка будет спотыкаться о неё вечно.
    await pool.query(
      `INSERT INTO assets (lesson_id, kind, path, bytes, expires_at)
       VALUES ($1, 'source', 'urok/net.mp4', 6, now() - interval '1 hour')`,
      [lesson.id]
    );
    const result = await makeCleanupMedia(config, pool)();
    assert.equal(result.removed, 1);
    const { rows } = await pool.query('SELECT count(*)::int n FROM assets');
    assert.equal(rows[0].n, 0);
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/cleanup-media.test.js`
Ожидается: FAIL — модуль не найден.

- [ ] **Шаг 3: Написать `src/jobs/cleanup-media.js`**

```js
// Шаг конвейера: уборка буфера.
//
// Задача — удалять файлы, переживших свой срок. Это и есть то, чем портал
// отличается от видеоархива: спека прямо запрещает хранить архив, а диск на
// 34 ГБ переполнится за десяток уроков, если файлы не уходят сами.
// Карточка урока при этом остаётся — исчезают только файлы.
// Вызывается воркером по расписанию, раз в час.
import { rm } from 'node:fs/promises';
import { mediaPath } from '../services/media.js';
import { listExpired, forgetAsset } from '../services/media.js';

export function makeCleanupMedia(config, pool) {
  return async () => {
    const expired = await listExpired(pool);
    let removed = 0;

    for (const asset of expired) {
      try {
        // force: true — файла может уже не быть (том пересоздали, удалили
        // руками). Запись в учёте всё равно должна уйти, иначе уборка будет
        // спотыкаться о неё вечно.
        await rm(mediaPath(config, asset.path), { force: true });
      } catch (err) {
        console.error(`Не удалось удалить ${asset.path}: ${err.message}`);
      }
      await forgetAsset(pool, asset.id);
      removed += 1;
    }

    if (removed) console.log(`Уборка буфера: удалено файлов — ${removed}`);
    return { removed };
  };
}
```

Поставить по расписанию в `src/worker.js`:

```js
import { makeCleanupMedia } from './jobs/cleanup-media.js';

handlers.cleanupMedia = makeCleanupMedia(config, pool);

// Раз в час: чаще незачем, реже — и переполнение диска заметит не уборщик, а
// упавший сервер.
await queue.add('cleanupMedia', {}, { repeat: { every: 60 * 60 * 1000 }, jobId: 'cleanup' });
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Выполнить: `node --test test/cleanup-media.test.js`
Ожидается: 3 теста PASS.

- [ ] **Шаг 5: Коммит**

```bash
git add src/jobs/cleanup-media.js src/worker.js test/cleanup-media.test.js
git commit -m "feat: автоудаление файлов буфера по сроку"
```

### Задача 17: Ход конвейера в кабинете

**Файлы:**
- Изменить: `src/views/admin-review.js`, `src/routes/pages.js`,
  `src/views/feed.js`, `public/styles.css`
- Создать: `test/pipeline-state.test.js`

**Интерфейсы:**
- Отдаёт дальше: на карточке урока в ленте админа виден `pipeline_state`;
  на экране проверки — список готовых файлов и кнопка повтора при падении.

- [ ] **Шаг 1: Написать падающий тест**

`test/pipeline-state.test.js`:

```js
// Автор должен видеть, где урок сейчас и на чём он упал. Иначе единственный
// способ узнать это — журнал контейнера, к которому с телефона доступа нет.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveLesson } from '../src/services/lessons.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://soloaijourney.online',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', botId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: '' },
  media: { dir: '/tmp', ttlHours: 168 }
};

test('упавший шаг виден автору с причиной и кнопкой повтора', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await pool.query(
      `UPDATE lessons SET pipeline_state = 'failed', pipeline_error = 'transcribe: 402 нет денег'
        WHERE id = $1`,
      [lesson.id]
    );
    const { rows } = await pool.query(
      `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
    );
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (
        await fetch(`${base}/admin/lesson/urok`, {
          headers: {
            Accept: 'text/html',
            Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'admin' }, config.jwtSecret)}`
          }
        })
      ).text();
      assert.match(html, /402 нет денег/);
      assert.match(html, /data-retry="urok"/);
    });
  });
});

test('в ленте админа видно состояние обработки', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await pool.query(`UPDATE lessons SET pipeline_state = 'processing' WHERE id = $1`, [lesson.id]);
    const { rows } = await pool.query(
      `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
    );
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (
        await fetch(`${base}/`, {
          headers: {
            Accept: 'text/html',
            Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'admin' }, config.jwtSecret)}`
          }
        })
      ).text();
      assert.match(html, /обрабатывается/i);
    });
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `node --test test/pipeline-state.test.js`
Ожидается: FAIL — состояния на страницах нет.

- [ ] **Шаг 3: Показать состояние в ленте**

В `src/services/lessons.js`, в `toLesson` и в запросах `listLessons` /
`getLessonBySlug` добавить `pipeline_state` и `pipeline_error`:

```js
    pipelineState: row.pipeline_state,
    pipelineError: row.pipeline_error,
```

В `src/views/feed.js`, в карточку урока — метка состояния, видимая только
админу (обычный зритель черновиков и не видит):

```js
// Что происходит с уроком. Словами, а не кодом состояния: «processing» на
// экране ничего не объясняет.
const PIPELINE_LABELS = {
  uploading: 'загружается',
  processing: 'обрабатывается',
  review: 'ждёт проверки',
  failed: 'обработка упала'
};

// ...в карточке, рядом с датой:
${
  lesson.pipelineState && lesson.pipelineState !== 'idle'
    ? `<span class="badge">${escapeHtml(PIPELINE_LABELS[lesson.pipelineState] ?? lesson.pipelineState)}</span>`
    : ''
}
```

- [ ] **Шаг 4: Кнопка повтора в клиенте**

В `public/admin.js`:

```js
document.querySelector('[data-retry]')?.addEventListener('click', async (event) => {
  const slug = event.currentTarget.dataset.retry;
  const answer = await request(`/api/admin/lessons/${slug}/retry`, { method: 'POST' });
  if (answer) {
    toast('Обработка запущена заново. Шаги, которые уже отработали, повторяться не будут.');
    location.reload();
  }
});
```

- [ ] **Шаг 5: Убедиться, что тесты проходят**

Выполнить: `npm test && npm run lint`
Ожидается: всё зелёное.

- [ ] **Шаг 6: Проверить критерий приёмки этапа 6**

1. Прогнать настоящий урок целиком: загрузка → обработка → экран проверки.
2. Скачать нарезки и посмотреть глазами: вертикаль, подписи читаются, звук на
   месте, мысль не обрывается на полуслове.
3. Проверить уборку, не дожидаясь недели:
   ```bash
   docker compose exec api node --input-type=module -e "
   import { loadConfig } from './src/config.js';
   import { createPool } from './src/db.js';
   const pool = createPool(loadConfig().db);
   await pool.query(\"UPDATE assets SET expires_at = now() - interval '1 hour' WHERE kind = 'source'\");
   await pool.end();"
   ```
   Через час (или поставив задачу вручную) исходник должен исчезнуть, а
   карточка урока, субтитры и обложка — остаться.

- [ ] **Шаг 7: Коммит и метка**

```bash
git add src/views src/routes src/services/lessons.js public/admin.js \
        public/styles.css test/pipeline-state.test.js
git commit -m "feat: ход конвейера и повтор упавшего шага в кабинете"
git tag -a stage-6 -m "Конвейер: расшифровка, субтитры, тексты, нарезки, обложка"
```

---

## Что после этапа 6

Урок доходит от файла до готового к публикации черновика без участия человека,
кроме экрана проверки. Следующая порция плана — этапы 7–8: публикация на
площадки. Писать её после сдачи этой, опираясь на проверенное, а не на
предположения.

К началу этапа 7 понадобится:

- реквизиты приложения YouTube (`YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`)
  и разовое подключение канала через OAuth;
- решение по `TOKEN_ENCRYPTION_KEY`: долгоживущие токены площадок лежат в базе
  зашифрованными, ключ живёт в окружении — переменная уже заведена, но пуста.

**Отдельно про квоту YouTube:** около шести загрузок в сутки по умолчанию.
Это не ограничение нашего кода, а политика площадки; расширение — по заявке.
Планировать этап 7 с учётом этого числа, а не выяснять его на первом же
разливе.

---

## Проверка плана на полноту

Сверено со спекой после написания.

**Покрытие раздела 8 спеки (путь урока).** Состояния 1–3 закрыты: черновик и
загрузка — задачи 4–5; обработка (звук → расшифровка → транскрипт → субтитры →
тексты → нарезки → обложка) — задачи 6, 9, 10, 11, 14, 15; проверка автором —
задача 12. Состояния 4–6 (публикация, жизнь после выхода) — этапы 7–10, здесь
не планируются.

**Покрытие раздела 5 (модель данных).** `transcripts`, `transcript_segments`,
`assets` — задача 2. Поиск по сегментам — задача 13.

**Покрытие раздела 3 (ограничения среды).** Расшифровка внешним сервисом —
задачи 8–9. Одна задача за раз, `nice` у ffmpeg, `preset veryfast` — задачи 1,
6, 14. Уборка буфера — задача 16.

**Сквозная проверка имён.** `createQueue`/`createWorker`/`JOBS`,
`mediaPath`/`registerAsset`/`listExpired`/`forgetAsset`/`assetById`,
`runFfmpeg`/`ffmpegArgsForAudio`/`probeDuration`/`describeFailure`,
`mediaLink`/`readMediaToken`, `createSpeech`/`parseYandexRecognition`,
`toSrt`/`toVtt`/`formatSrtTime`/`formatVttTime`,
`parseModelAnswer`, `pickClipRanges`/`ffmpegArgsForClip`,
`coverTimeSeconds`/`ffmpegArgsForCover`, `searchSegments`/`searchPage`,
`makeExtractAudio`/`makeTranscribe`/`makeSubtitles`/`makeGenerateTexts`/
`makeMakeClips`/`makeMakeCover`/`makeCleanupMedia` — названия и сигнатуры
совпадают между задачей, где объявлены, и задачами, где используются.

**Известный риск, записанный честно.** Точные имена полей в ответах Яндекса
взяты из документации, а не проверены боем. Задача 9, шаг 7 — прогон на
настоящем уроке — существует именно для этого: при расхождении правится только
разбор в `yandex.js`. Ради этого слой и сделан тонким, а разбор вынесен в
отдельную функцию с собственным тестом.

---

## Отступления от плана (2026-09-03)

**Задача 12 сделана без текстов от модели.** План писался, когда заголовки,
описание и главы предполагалось получать от модели в облаке. Облака не будет —
заказчик отказался от него в пользу расчёта на сервере, а расчёт текстов на
сервере не помещается в оставшуюся память. Поэтому экран проверки показывает
работу конвейера (обложку, длительность, файлы буфера, расшифровку и субтитры),
а заголовок, описание и теги пишет автор. Проверок стало больше, а не меньше:
добавились «сохранение черновика не выпускает урок наружу» и «пустой заголовок
не принимается».

**Повтор упавшего шага повторяет задачу, а не угадывает её.** В плане шага не
было вовсе; заказчик наткнулся на его отсутствие в первый же день. Имя шага и
его данные пишутся в `lessons.pipeline_job` при падении (миграция 012) —
разбирать имя из текста ошибки нельзя: текст писан для человека и однажды
поменяется, а шаг «забрать с Диска» без пути к файлу вообще неповторим.

**Уборка ставится расписанием, а не `add({ repeat })`.** В BullMQ 6 параметр
`repeat` у `add()` убран, и вызов с ним не падает — он молча выполняет задачу
один раз. В журнале это выглядит как работающая уборка, но расписание не
создаётся, и второй раз она не запустится никогда: заметить можно было бы
только по переполненному диску через месяц. Поймано проверкой расписания на
живом сервере после развёртывания; закреплено тестом.
