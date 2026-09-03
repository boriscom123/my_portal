// Тестовая база. Задача — дать каждому тестовому файлу чистую схему
// настоящего postgres, не мешая соседям.
//
// Зачем настоящую базу, а не заглушку: половина правил портала — это
// ограничения самой базы (одна привязка на провайдера, один голос на идею),
// и заглушка их не проверяет.
//
// Зачем отдельная схема на файл: тест-раннер Node гоняет файлы параллельно,
// по числу ядер. Пока все они чистили одни и те же таблицы, файлы вытирали
// данные друг у друга — на двухъядерной машине это не проявлялось, а на
// сборщике GitHub с восемью ядрами роняло половину тестов. Каждый файл живёт
// в своём процессе, поэтому имя схемы берётся от его номера.
//
// Если TEST_DATABASE_URL не задан, тесты базы пропускаются — чтобы `npm test`
// работал на машине без базы.
// Вызывается из всех тестов, которым нужна база.
import pg from 'pg';
import { runMigrations } from '../../src/migrate.js';

export const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? '';
export const skipWithoutDb = { skip: testDatabaseUrl ? false : 'TEST_DATABASE_URL не задан' };

// Имя латиницей: кириллица в именах схем работает, но требует кавычек в
// каждом запросе — лишний повод ошибиться.
const SCHEMA = `test_${process.pid}`;

let pool = null;

/**
 * Готовит пул, привязанный к собственной схеме этого файла.
 * Схема создаётся заново: номер процесса система переиспользует, и остатки
 * прошлого прогона иначе выдали бы себя за свежие данные.
 */
async function getPool() {
  if (pool) return pool;

  const admin = new pg.Pool({ connectionString: testDatabaseUrl, max: 1 });
  try {
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  } finally {
    await admin.end();
  }

  pool = new pg.Pool({
    connectionString: testDatabaseUrl,
    // search_path заставляет миграции и запросы работать в нашей схеме, не
    // упоминая её ни в одной строке SQL самого приложения.
    options: `-c search_path=${SCHEMA}`
  });
  await runMigrations(pool, new URL('../../migrations/', import.meta.url));
  return pool;
}

// Схема живёт до конца процесса и уносится с собой: иначе на машине
// разработчика они копились бы после каждого прогона.
process.on('beforeExit', async () => {
  if (!pool) return;
  const mine = pool;
  pool = null;
  try {
    await mine.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  } catch {
    // База могла уже уйти — прибирать нечего.
  } finally {
    await mine.end();
  }
});

export async function withTestDb(fn) {
  const pool = await getPool();

  // Внутри файла тесты идут по очереди, поэтому чистим перед каждым.
  // RESTART IDENTITY возвращает счётчики: без него идентификаторы растут от
  // теста к тесту, и проверки на конкретные значения становятся хрупкими.
  const { rows } = await pool.query(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = $1 AND tablename <> 'schema_migrations'`,
    [SCHEMA]
  );
  if (rows.length) {
    const names = rows.map((r) => `${SCHEMA}."${r.tablename}"`).join(', ');
    await pool.query(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
  }

  return fn(pool);
}
