-- Агент роликов: «Сниму сам» и сбор в 7 утра.
--
-- Автор попросил третий путь к ролику, кроме «выложить как есть» и
-- «надиктовать»: снять видео самому. Черновик тогда ждёт видео (film_wait), а
-- собранный ролик помечается голосом 'film' — в кадре сам автор, синтезатора
-- и фона агента нет.
--
-- Час сбора — 7:00 по Москве вместо 10:00: черновики должны ждать автора
-- утром, до начала дня, а не в его середине.
ALTER TABLE agent_drafts DROP CONSTRAINT agent_drafts_state_check;
ALTER TABLE agent_drafts ADD CONSTRAINT agent_drafts_state_check CHECK (state IN
  ('rendering', 'awaiting', 'voice_wait', 'film_wait', 'redo_wait',
   'published', 'rejected', 'failed'));

ALTER TABLE agent_drafts DROP CONSTRAINT agent_drafts_voice_check;
ALTER TABLE agent_drafts ADD CONSTRAINT agent_drafts_voice_check
  CHECK (voice IN ('synth', 'author', 'film'));

ALTER TABLE agent_settings ALTER COLUMN run_hour SET DEFAULT 7;
UPDATE agent_settings SET run_hour = 7, updated_at = now();
