-- Начало урока, уехавшее в канал, — свой вид файла.
--
-- Анонс в канале теперь альбом: обложка и начало записи одним постом. У MAX
-- правка поста заново прикладывает вложения, поэтому вырезанный кусок должен
-- пережить отправку: иначе первая же правка подписи снимет видео с поста.
-- Отдельным видом, а не 'clip': нарезки для «Коротко» ищутся по kind = 'clip',
-- и начало урока встало бы в список кандидатов на вертикальный ролик.
ALTER TABLE assets DROP CONSTRAINT assets_kind_check;
ALTER TABLE assets ADD CONSTRAINT assets_kind_check
  CHECK (kind IN ('source', 'audio', 'clip', 'subtitles', 'cover', 'trimmed', 'image', 'vertical', 'part'));
