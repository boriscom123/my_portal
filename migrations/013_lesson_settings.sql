-- Настройки подготовки урока и место для смонтированной записи.
--
-- Вид субтитров и вырезание пауз — решения автора, а не разработчика: толщина
-- обводки, которая хороша на светлом кадре, слишком жирна на тёмном, и спорить
-- об этом в коде бессмысленно. Одним полем jsonb, потому что это набор мелких
-- предпочтений, по которым мы не ищем и не соединяем таблицы.
-- Читается из src/lib/settings.js.
ALTER TABLE lessons ADD COLUMN settings jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Запись с вырезанными паузами — отдельный файл, а не замена исходника:
-- исходник нужен, чтобы смонтировать заново с другими настройками, и терять
-- его при первой же перемонтировке нельзя.
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_kind_check;
ALTER TABLE assets ADD CONSTRAINT assets_kind_check
  CHECK (kind IN ('source', 'audio', 'clip', 'subtitles', 'cover', 'trimmed'));
