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
