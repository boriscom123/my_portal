-- Журнал применённых миграций. Задача — помнить, что уже накатано, чтобы
-- повторный старт контейнера не пытался создать существующие таблицы.
-- Читается и пополняется только src/migrate.js.
CREATE TABLE IF NOT EXISTS schema_migrations (
  name       text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
