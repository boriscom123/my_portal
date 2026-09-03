-- Борд идей: что люди хотят увидеть в следующих уроках.
--
-- Зачем отдельно от комментариев: у идеи есть жизненный цикл (предложена →
-- принята → в работе → вышла) и голоса, а у комментария нет ни того, ни
-- другого. Втискивать это в comments значило бы завести там половину
-- неиспользуемых колонок.
-- Читается из src/services/ideas.js.

CREATE TABLE ideas (
  id         bigserial PRIMARY KEY,
  author_id  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      text NOT NULL,
  body       text NOT NULL DEFAULT '',
  status     text NOT NULL DEFAULT 'new'
               CHECK (status IN ('new', 'accepted', 'in_progress', 'released')),
  -- Урок, которым идея закрыта. Появляется вместе со статусом released:
  -- человеку, голосовавшему за тему, нужна ссылка, а не слово «вышло».
  lesson_id  bigint REFERENCES lessons(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE idea_votes (
  idea_id    bigint NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Первичный ключ из пары и есть правило «один голос на человека»:
  -- накрутить голоса повторными нажатиями нельзя даже в обход кода.
  PRIMARY KEY (idea_id, user_id)
);
