-- Картинки новостей живут в том же учёте файлов, что и обложки уроков.
--
-- Заводить вторую таблицу под то же самое — путь к двум уборщикам, двум
-- маршрутам отдачи и двум местам, где считается размер буфера. Поэтому файл
-- принадлежит либо уроку, либо новости, и ровно одному из них.
-- Читается из src/services/media.js и src/services/news.js.
ALTER TABLE assets ALTER COLUMN lesson_id DROP NOT NULL;
ALTER TABLE assets ADD COLUMN news_id bigint REFERENCES news(id) ON DELETE CASCADE;

-- Ровно один хозяин: файл без хозяина осиротеет в буфере навсегда, а файл с
-- двумя однажды удалится вместе с чужой карточкой.
ALTER TABLE assets ADD CONSTRAINT assets_one_owner
  CHECK (num_nonnulls(lesson_id, news_id) = 1);

-- Картинка новости — свой вид: у неё нет ничего общего с обложкой урока, кроме
-- того, что это картинка, и путать их в отчётах об уборке незачем.
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_kind_check;
ALTER TABLE assets ADD CONSTRAINT assets_kind_check
  CHECK (kind IN ('source', 'audio', 'clip', 'subtitles', 'cover', 'trimmed', 'image'));

CREATE INDEX assets_news_idx ON assets (news_id);

-- Порядок картинок в новости задаёт автор: слайдер показывает их в этом
-- порядке, и «как получилось при загрузке» здесь не годится.
ALTER TABLE assets ADD COLUMN position integer NOT NULL DEFAULT 0;
