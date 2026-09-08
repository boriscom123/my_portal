-- Публикация привязана к файлу, а не только к уроку.
--
-- Горизонтальная запись у урока одна, а вертикальных роликов три, и на площадку
-- коротких видео поедут все. Прежнее ограничение «одна строка на площадку и
-- урок» вторую строку вставить не давало — а узнали бы мы об этом на первой же
-- площадке коротких видео, уже написав адаптер.
ALTER TABLE publications ADD COLUMN asset_id bigint REFERENCES assets(id) ON DELETE CASCADE;

ALTER TABLE publications DROP CONSTRAINT publications_lesson_id_platform_key;

-- NULLS NOT DISTINCT обязателен: без него postgres считает две строки с пустым
-- файлом разными, и защита от двойной публикации молча перестаёт работать
-- ровно там, где файл не указан.
CREATE UNIQUE INDEX publications_lesson_platform_asset_key
  ON publications (lesson_id, platform, asset_id) NULLS NOT DISTINCT;

-- «Лежит на канале, но приватный» — не published и не uploading.
--
-- До аудита Google ролик, залитый через API, принудительно остаётся приватным:
-- открыть его должен человек. Называть это published значит показать зрителю
-- ссылку в никуда, а оставить uploading — врать, что файл ещё едет.
ALTER TABLE publications DROP CONSTRAINT publications_state_check;
ALTER TABLE publications ADD CONSTRAINT publications_state_check
  CHECK (state IN ('planned', 'queued', 'uploading', 'ready', 'published', 'failed'));
