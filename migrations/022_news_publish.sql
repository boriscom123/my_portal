-- Черновик у новости и посты новости в каналах.
--
-- Прежде новость выходила в свет в тот же миг, что заводилась: строка в таблице
-- и была публикацией. Автор просил разделить — написать, посмотреть на неё
-- глазами читателя и только потом выпустить.
-- Читается из src/services/news.js и src/services/publications.js.

-- Существующие новости уже прочитаны людьми: объявить их черновиками задним
-- числом значило бы убрать со страниц то, чем уже поделились.
ALTER TABLE news ADD COLUMN status text NOT NULL DEFAULT 'draft'
  CHECK (status IN ('draft', 'published'));
UPDATE news SET status = 'published';

-- У черновика даты выхода нет. С прежним DEFAULT now() она появлялась бы при
-- заведении — и лента показывала бы «вышло сегодня» у того, что ещё пишется.
ALTER TABLE news ALTER COLUMN published_at DROP DEFAULT;
ALTER TABLE news ALTER COLUMN published_at DROP NOT NULL;
ALTER TABLE news ADD CONSTRAINT news_published_has_date
  CHECK (status <> 'published' OR published_at IS NOT NULL);

-- Пост в канале — такая же публикация, как ролик на площадке: у него есть
-- состояние, номер и ссылка. Заводить под него вторую таблицу значило бы
-- завести и второй набор состояний, и второе место, где их путают.
ALTER TABLE publications ALTER COLUMN lesson_id DROP NOT NULL;
ALTER TABLE publications ADD COLUMN news_id bigint REFERENCES news(id) ON DELETE CASCADE;

-- Ровно один хозяин — то же правило, что у файлов: публикация без хозяина
-- осиротеет, а с двумя однажды удалится вместе с чужой карточкой.
ALTER TABLE publications ADD CONSTRAINT publications_one_owner
  CHECK (num_nonnulls(lesson_id, news_id) = 1);

-- Прежний уникальный ключ считал пустоту значением (NULLS NOT DISTINCT), и все
-- посты новостей столкнулись бы в одной строке (NULL, 'telegram', NULL).
-- Поэтому он теперь только про уроки, а у новостей свой.
DROP INDEX publications_lesson_platform_asset_key;
CREATE UNIQUE INDEX publications_lesson_platform_asset_key
  ON publications (lesson_id, platform, asset_id) NULLS NOT DISTINCT
  WHERE lesson_id IS NOT NULL;

-- У новости один пост на площадку: файла, который различал бы их, у неё нет.
CREATE UNIQUE INDEX publications_news_platform_key
  ON publications (news_id, platform) WHERE news_id IS NOT NULL;
