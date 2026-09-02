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
