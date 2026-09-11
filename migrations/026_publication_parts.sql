-- Урок в каналы частями видео — отдельной публикацией рядом с анонсом.
--
-- Своя «площадка», а не вторая строка той же: экран урока и правка анонсов
-- ищут публикацию по площадке, и вторая строка «telegram» у урока их запутала
-- бы. details — ход отправки постами подряд (у MAX, если он не примет
-- несколько видео в одном сообщении): какие части ушли и номера их постов,
-- чтобы повтор продолжил, а не задублировал.
-- Читается из src/services/publications.js.
ALTER TABLE publications DROP CONSTRAINT publications_platform_check;
ALTER TABLE publications ADD CONSTRAINT publications_platform_check CHECK (platform IN
  ('youtube', 'vk', 'telegram', 'rutube', 'tiktok', 'instagram', 'dzen', 'max',
   'telegram_parts', 'max_parts'));
ALTER TABLE publications ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb;
