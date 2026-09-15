-- Проекты: пометка уроков, новостей и серий.
--
-- У автора несколько проектов — этот портал, IDLE игра, Уведомлятор, — и
-- зритель, следящий за одним, должен одним нажатием увидеть только его
-- материалы. Основной проект лежит в таблице связей с пометкой, а не колонкой
-- у материала: удаление проекта убирает только связи, материалы остаются.
-- Поэтому «проект обязателен» — правило служб и экранов, а не базы.
-- Читается из src/services/projects.js.
CREATE TABLE projects (
  id          bigserial PRIMARY KEY,
  -- Часть адреса фильтра: собирается из названия один раз и не меняется,
  -- иначе ломались бы ссылки, которыми уже поделились.
  slug        text NOT NULL UNIQUE,
  title       text NOT NULL,
  -- Пригодится будущей странице проекта.
  description text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lesson_projects (
  lesson_id  bigint NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  is_main    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (lesson_id, project_id)
);
-- Основной проект у материала не больше одного — следит база, а не код.
CREATE UNIQUE INDEX lesson_projects_one_main ON lesson_projects (lesson_id) WHERE is_main;
CREATE INDEX lesson_projects_project_idx ON lesson_projects (project_id);

CREATE TABLE news_projects (
  news_id    bigint NOT NULL REFERENCES news(id) ON DELETE CASCADE,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  is_main    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (news_id, project_id)
);
CREATE UNIQUE INDEX news_projects_one_main ON news_projects (news_id) WHERE is_main;
CREATE INDEX news_projects_project_idx ON news_projects (project_id);

CREATE TABLE series_projects (
  series_id  bigint NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  is_main    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (series_id, project_id)
);
CREATE UNIQUE INDEX series_projects_one_main ON series_projects (series_id) WHERE is_main;
CREATE INDEX series_projects_project_idx ON series_projects (project_id);

-- Всё, что было до проектов, — про этот портал.
INSERT INTO projects (slug, title, description)
VALUES ('solo-ai-journey', 'Solo AI Journey', 'Портал видеоуроков: от идеи до продукта.');

INSERT INTO lesson_projects (lesson_id, project_id, is_main)
  SELECT l.id, p.id, true FROM lessons l CROSS JOIN projects p WHERE p.slug = 'solo-ai-journey';
INSERT INTO news_projects (news_id, project_id, is_main)
  SELECT n.id, p.id, true FROM news n CROSS JOIN projects p WHERE p.slug = 'solo-ai-journey';
INSERT INTO series_projects (series_id, project_id, is_main)
  SELECT s.id, p.id, true FROM series s CROSS JOIN projects p WHERE p.slug = 'solo-ai-journey';
