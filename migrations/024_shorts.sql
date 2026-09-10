-- Короткие вертикальные ролики.
--
-- Часть режется из урока конвейером, часть автор снимает отдельно и загружает
-- готовой. Общего у них ровно одно — это короткое вертикальное видео, которое
-- уезжает на площадки коротких видео; поэтому и таблица одна.
-- Читается из src/services/shorts.js.
CREATE TABLE shorts (
  id           bigserial PRIMARY KEY,
  slug         text NOT NULL UNIQUE,
  title        text NOT NULL,
  description  text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  -- Файл ролика. Он может принадлежать уроку (нарезка) или самому ролику
  -- (загруженный) — поэтому ссылка, а не владение: отобрав нарезку у урока, мы
  -- убрали бы её с экрана урока, где автор её и смотрит.
  asset_id     bigint REFERENCES assets(id) ON DELETE SET NULL,
  -- Кадр-заставка. Ссылкой, как обложка урока: тем же маршрутом отдаётся, тем
  -- же способом живёт.
  cover_url    text,
  -- Урок, из которого вырезан. Пусто у снятых отдельно — придумывать им урок
  -- незачем.
  lesson_id    bigint REFERENCES lessons(id) ON DELETE SET NULL,
  published_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shorts_published_has_date CHECK (status <> 'published' OR published_at IS NOT NULL)
);

-- Одна нарезка — один ролик. Иначе в разделе окажутся близнецы, и какой из них
-- отправлен в канал, будет не разобрать.
CREATE UNIQUE INDEX shorts_asset_key ON shorts (asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX shorts_published_idx ON shorts (published_at DESC) WHERE status = 'published';

-- Файлы, принадлежащие самому ролику: загруженное видео и кадр-заставка.
ALTER TABLE assets ADD COLUMN short_id bigint REFERENCES shorts(id) ON DELETE CASCADE;
ALTER TABLE assets DROP CONSTRAINT assets_one_owner;
ALTER TABLE assets ADD CONSTRAINT assets_one_owner
  CHECK (num_nonnulls(lesson_id, news_id, short_id) = 1);
CREATE INDEX assets_short_idx ON assets (short_id);

-- Загруженное вертикальное видео — свой вид: у него нет ничего общего с
-- нарезкой из урока, кроме формы кадра, а живут они по разным правилам.
ALTER TABLE assets DROP CONSTRAINT assets_kind_check;
ALTER TABLE assets ADD CONSTRAINT assets_kind_check
  CHECK (kind IN ('source', 'audio', 'clip', 'subtitles', 'cover', 'trimmed', 'image', 'vertical'));

-- Публикация ролика ложится в ту же таблицу, что ролик на YouTube и пост о
-- новости: те же состояния, тот же номер, та же ссылка.
ALTER TABLE publications ADD COLUMN short_id bigint REFERENCES shorts(id) ON DELETE CASCADE;
ALTER TABLE publications DROP CONSTRAINT publications_one_owner;
ALTER TABLE publications ADD CONSTRAINT publications_one_owner
  CHECK (num_nonnulls(lesson_id, news_id, short_id) = 1);

CREATE UNIQUE INDEX publications_short_platform_key
  ON publications (short_id, platform) WHERE short_id IS NOT NULL;
