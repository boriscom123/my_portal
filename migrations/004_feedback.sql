-- Обратная связь портала: реакции и комментарии.
--
-- Тип объекта хранится строкой рядом с идентификатором, а не отдельной
-- таблицей на каждый вид: реагировать и комментировать можно урок, новость и
-- саму идею, и заводить под это три пары таблиц значит трижды писать одно и
-- то же. Плата — отсутствие внешнего ключа на объект.
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
