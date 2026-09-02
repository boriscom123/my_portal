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
