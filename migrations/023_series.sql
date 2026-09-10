-- Серии уроков: уроки идут курсом, а не россыпью.
--
-- Задача — сказать зрителю, во что он ввязался: не «вот ролик», а «урок 3 из
-- 8, вот предыдущий и следующий». Пришедший на пятый урок иначе не узнает, что
-- перед ним есть четыре, и уйдёт с середины курса.
-- Читается из src/services/series.js.
CREATE TABLE series (
  id          bigserial PRIMARY KEY,
  -- Часть адреса серии: у неё своя страница со всеми уроками по порядку.
  slug        text NOT NULL UNIQUE,
  title       text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ON DELETE SET NULL, а не CASCADE: удаление серии не должно уносить уроки.
-- Серия — это способ их разложить, а не хозяин записей, ради которых всё.
-- Номер при этом обнуляет не база, а deleteSeries: сама она снимает только
-- ссылку, и урок упёрся бы в правило «номер без серии бессмыслен».
ALTER TABLE lessons ADD COLUMN series_id bigint REFERENCES series(id) ON DELETE SET NULL;
ALTER TABLE lessons ADD COLUMN series_position integer;

-- Номер без серии и серия без номера одинаково бессмысленны: первое — сирота,
-- второе — урок, который некуда поставить в списке.
ALTER TABLE lessons ADD CONSTRAINT lessons_series_position_together
  CHECK ((series_id IS NULL) = (series_position IS NULL));

-- Два урока на одном месте — это список, порядок которого зависит от везения.
-- DEFERRABLE обязателен: перестановка соседей меняет два номера, и на середине
-- обмена они неизбежно совпадают.
ALTER TABLE lessons ADD CONSTRAINT lessons_series_position_key
  UNIQUE (series_id, series_position) DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX lessons_series_idx ON lessons (series_id, series_position);
