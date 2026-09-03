-- Конвейер обработки урока: файлы буфера, расшифровка, состояние.
--
-- Главное решение здесь — срок жизни у каждого файла. Портал видеоархива не
-- держит: исходник часового урока весит гигабайты, а на машине 34 ГБ свободно.
-- Файл без срока однажды переполнит диск и положит все проекты сервера,
-- поэтому колонка обязательна на уровне базы, а не на честном слове кода.
-- Читается из src/services/media.js и задач в src/jobs/.

CREATE TABLE assets (
  id         bigserial PRIMARY KEY,
  lesson_id  bigint NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('source', 'audio', 'clip', 'subtitles', 'cover')),
  -- Путь внутри буфера, относительно MEDIA_DIR. Абсолютный сюда не кладём:
  -- каталог задаётся окружением и на другой машине будет другим.
  path       text NOT NULL,
  bytes      bigint NOT NULL,
  -- Срок жизни. Исходник и нарезки весят гигабайты и уходят первыми; субтитры
  -- и обложка лёгкие и нужны карточке урока долго после публикации.
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX assets_lesson_idx ON assets (lesson_id);
CREATE INDEX assets_expires_idx ON assets (expires_at);

-- Цельный текст расшифровки. Один на урок: вторая расшифровка того же урока
-- заменяет первую, а не копится рядом — два текста сделали бы поиск
-- бессмысленным.
CREATE TABLE transcripts (
  lesson_id  bigint PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,
  text       text NOT NULL,
  -- Кем расшифровано: пригодится, когда поставщик сменится и понадобится
  -- понять, почему старые уроки распознаны иначе.
  provider   text NOT NULL DEFAULT 'yandex',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Отрезки с таймкодами. Ради них расшифровка и нужна: поиск слова ведёт на
-- нужную секунду урока, а не на урок целиком.
CREATE TABLE transcript_segments (
  id         bigserial PRIMARY KEY,
  lesson_id  bigint NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  started_ms integer NOT NULL,
  ended_ms   integer NOT NULL,
  text       text NOT NULL,
  CONSTRAINT segment_order CHECK (ended_ms >= started_ms)
);

CREATE INDEX transcript_segments_lesson_idx ON transcript_segments (lesson_id, started_ms);

ALTER TABLE lessons
  -- Где урок сейчас. Отдельно от status: status — то, что видит зритель, а
  -- pipeline_state — что происходит внутри. Путать их нельзя: урок может быть
  -- опубликован и одновременно переобрабатываться.
  ADD COLUMN pipeline_state text NOT NULL DEFAULT 'idle'
    CHECK (pipeline_state IN ('idle', 'uploading', 'processing', 'review', 'failed')),
  -- Текст последней ошибки конвейера: в кабинете он показывается автору, а не
  -- прячется в журнале контейнера, до которого с телефона не добраться.
  ADD COLUMN pipeline_error text,
  ADD COLUMN source_asset_id bigint REFERENCES assets(id) ON DELETE SET NULL,
  -- Что придумала модель: три заголовка, описание, теги, главы с таймкодами.
  -- Одним полем jsonb, потому что это черновик для человека, а не данные, по
  -- которым мы ищем и соединяем.
  ADD COLUMN generated jsonb NOT NULL DEFAULT '{}'::jsonb;
