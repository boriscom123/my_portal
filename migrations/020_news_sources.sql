-- Официальные источники анонсов.
--
-- Отдельной таблицей, а не списком в коде: заказчик добавляет источники сам —
-- сегодня их девять, завтра появится NVIDIA, послезавтра ещё кто-то. Список в
-- коде означал бы правку и выкатку ради одной строки.
--
-- Хранится адрес ленты, а не страницы: ленту читает машина, страницу — человек.
-- Читается из src/services/news-sources.js.
CREATE TABLE news_sources (
  id         bigserial PRIMARY KEY,
  title      text NOT NULL,
  url        text NOT NULL UNIQUE,
  -- Выключенный источник остаётся в списке: его не спрашивают, но и заводить
  -- заново, когда он снова понадобится, не приходится.
  enabled    boolean NOT NULL DEFAULT true,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Набор для начала: он выбран заказчиком под темы портала.
INSERT INTO news_sources (title, url, position) VALUES
  ('Anthropic', 'https://www.anthropic.com/news/rss.xml', 1),
  ('OpenAI', 'https://openai.com/news/rss.xml', 2),
  ('Google AI', 'https://blog.google/technology/ai/rss/', 3),
  ('GitHub', 'https://github.blog/feed/', 4),
  ('Docker', 'https://www.docker.com/blog/feed/', 5),
  ('Node.js', 'https://nodejs.org/en/feed/blog.xml', 6),
  ('PostgreSQL', 'https://www.postgresql.org/news.rss', 7),
  ('Telegram', 'https://telegram.org/blog/rss.xml', 8),
  ('Hacker News', 'https://hnrss.org/frontpage?points=200', 9);
