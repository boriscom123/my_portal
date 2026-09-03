// Применение миграций при старте. Задача — привести схему базы к состоянию,
// которое ждёт код, до того как приложение начнёт принимать запросы. Зачем при
// старте, а не руками: разъехавшаяся схема — самая частая причина «у меня
// работает», а деплой здесь это `docker compose up -d` без отдельных шагов.
// Вызывается из src/server.js и из тестового помощника test/helpers/db.js.
import { readdir, readFile } from 'node:fs/promises';

/** Сколько ждать схему и как часто переспрашивать, в миллисекундах. */
const WAIT_TIMEOUT_MS = 60_000;
const WAIT_STEP_MS = 1000;

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

/**
 * Ждёт, пока схема станет полной.
 * Миграции накатывает api при старте, а воркер поднимается рядом и сразу
 * берётся за расписание уборки. На чистой машине он успевает раньше и падает
 * на «relation assets does not exist»: в журнале первого запуска это выглядит
 * поломкой, хотя через минуту всё работает.
 * Ждём, а не накатываем сами: две гонки за одну таблицу хуже одного ожидания.
 * Вызывается из src/worker.js перед созданием исполнителя очереди.
 */
export async function waitForSchema(pool, dir, { timeoutMs = WAIT_TIMEOUT_MS, stepMs = WAIT_STEP_MS, sleep } = {}) {
  const wait = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const expected = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    // Отсутствие самой таблицы учёта — тоже «схемы ещё нет», а не сбой:
    // на чистой базе её создаёт та же миграция.
    const { rows } = await pool
      .query('SELECT name FROM schema_migrations')
      .catch(() => ({ rows: null }));

    if (rows) {
      const done = new Set(rows.map((row) => row.name));
      const missing = expected.filter((file) => !done.has(file));
      if (!missing.length) return { waited: true, missing: [] };
      if (Date.now() >= deadline) return { waited: false, missing };
    } else if (Date.now() >= deadline) {
      return { waited: false, missing: expected };
    }

    await wait(stepMs);
  }
}
