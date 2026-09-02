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
