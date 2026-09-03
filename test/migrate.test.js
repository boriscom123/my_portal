// Проверка применения миграций: журнал заполняется, повтор ничего не ломает.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runMigrations, waitForSchema } from '../src/migrate.js';
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

test('воркер ждёт, пока схема станет полной', async () => {
  // На чистой машине воркер поднимается рядом с api и успевает взяться за
  // уборку раньше, чем миграции накатились: в журнале первого запуска это
  // выглядит поломкой. Здесь проверяется, что он ждёт, а не падает.
  let answers = 0;
  const pool = {
    query: async () => {
      answers += 1;
      // Первые два раза таблицы учёта ещё нет, потом миграции доехали.
      if (answers < 3) throw new Error('relation "schema_migrations" does not exist');
      return { rows: [{ name: '001_schema_migrations.sql' }] };
    }
  };
  const slept = [];
  const result = await waitForSchema(pool, new URL('./fixtures/one-migration/', import.meta.url), {
    stepMs: 5,
    sleep: async (ms) => slept.push(ms)
  });
  assert.deepEqual(result, { waited: true, missing: [] });
  assert.deepEqual(slept, [5, 5], 'должен был переспросить дважды');
});

test('ожидание не вечное: неполную схему воркер переживает', async () => {
  // Иначе опечатка в имени миграции подвесила бы воркер молча и навсегда.
  const pool = { query: async () => ({ rows: [] }) };
  const result = await waitForSchema(pool, new URL('./fixtures/one-migration/', import.meta.url), {
    timeoutMs: 0,
    sleep: async () => {}
  });
  assert.equal(result.waited, false);
  assert.deepEqual(result.missing, ['001_schema_migrations.sql']);
});
