-- Подписки на пуши и журнал отправленного.
--
-- Зачем журнал: одно событие может дойти до человека тремя каналами, а задача
-- в очереди на этапе 5 может повториться после сбоя. Ключ dedup_key делает
-- повтор невозможным на уровне базы, а не на честном слове кода.
-- Читается из src/services/notify/index.js и src/routes/push.js.

CREATE TABLE push_subscriptions (
  id         bigserial PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Адрес, выданный браузером. Уникален глобально: одно устройство — одна
  -- строка, даже если человек переподписался.
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

CREATE TABLE notifications (
  id         bigserial PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Повод: lesson_published, comment_reply, comment_moderation, idea_status.
  kind       text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Каким каналом ушло: webpush, telegram, max. NULL — не ушло никуда,
  -- человеку нечем доставить.
  channel    text,
  -- «Это уведомление уже отправляли». Складывается из повода и объекта.
  dedup_key  text NOT NULL UNIQUE,
  sent_at    timestamptz NOT NULL DEFAULT now()
);
