-- Агент роликов: сам находит темы, собирает ролики и присылает автору на
-- подтверждение в Telegram. Ролик агента — обычный ролик раздела «Ролики»,
-- поэтому живёт в shorts; здесь — то, чего у загруженного ролика нет.
-- Читается из src/services/shorts-agent.js.

-- Откуда ролик. Нужно, чтобы отличать ролики агента в списке и, позже, в
-- статистике: по ним агент будет решать, о чём и сколько снимать.
ALTER TABLE shorts ADD COLUMN origin text NOT NULL DEFAULT 'upload'
  CHECK (origin IN ('upload', 'clip', 'agent'));
UPDATE shorts SET origin = 'clip' WHERE lesson_id IS NOT NULL;

-- Взятые темы. По адресу новости: одна новость дважды роликом не становится,
-- даже если черновик выброшен — выброшенное автор видеть снова не хочет.
CREATE TABLE agent_topics (
  id        bigserial PRIMARY KEY,
  url       text NOT NULL UNIQUE,
  title     text NOT NULL,
  source    text NOT NULL DEFAULT '',
  summary   text NOT NULL DEFAULT '',
  picked_at timestamptz NOT NULL DEFAULT now()
);

-- Черновик агента: где он на пути от сборки до выкладки.
--   rendering  — собирается;
--   awaiting   — прислан автору, ждёт кнопки;
--   voice_wait — автор нажал «Надиктую сам», ждём голосовое;
--   redo_wait  — автор нажал «Переделать», ждём, что поправить;
--   published  — выложен;
--   rejected   — выброшен;
--   failed     — сборка упала (текст ошибки рядом).
CREATE TABLE agent_drafts (
  short_id       bigint PRIMARY KEY REFERENCES shorts(id) ON DELETE CASCADE,
  topic_id       bigint NOT NULL REFERENCES agent_topics(id) ON DELETE CASCADE,
  state          text NOT NULL DEFAULT 'rendering' CHECK (state IN
                   ('rendering', 'awaiting', 'voice_wait', 'redo_wait',
                    'published', 'rejected', 'failed')),
  -- Сценарий: { title, description, hashtags, sentences }.
  script         jsonb NOT NULL DEFAULT '{}',
  -- Чей голос: синтезатор или запись автора.
  voice          text NOT NULL DEFAULT 'synth' CHECK (voice IN ('synth', 'author')),
  -- Голосовое автора — номер файла в Telegram, пока ролик с ним не собран.
  author_file_id text,
  -- Что автор просил поправить при «Переделать».
  instruction    text NOT NULL DEFAULT '',
  -- Сообщение бота с кнопками: после нажатия кнопки снимаются, чтобы старое
  -- сообщение нельзя было нажать второй раз.
  bot_message_id bigint,
  error          text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_drafts_state_idx ON agent_drafts (state);

-- Настройки агента — одна строка. Сколько роликов в день решает пока автор;
-- позже число будет подстраиваться по реакции зрителей.
CREATE TABLE agent_settings (
  id       boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled  boolean NOT NULL DEFAULT true,
  per_day  integer NOT NULL DEFAULT 2 CHECK (per_day BETWEEN 1 AND 10),
  -- Час сбора по Москве: автор живёт по нему, а сервер — по UTC.
  run_hour integer NOT NULL DEFAULT 10 CHECK (run_hour BETWEEN 0 AND 23),
  voice    text NOT NULL DEFAULT 'ruslan',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO agent_settings DEFAULT VALUES;
