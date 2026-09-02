-- Человек и его способы входа.
--
-- Зачем две таблицы, а не поля google_id/telegram_id в одной: способов входа
-- шесть, и в одной таблице они превратились бы в шесть колонок, из которых
-- пять всегда пустые. Хуже того, один и тот же человек, зашедший с сайта и из
-- мини-приложения, стал бы двумя аккаунтами с разной историей. Разделение
-- обязательно с первого дня — потом сливать аккаунты дороже.
--
-- Читается и пополняется из src/services/identity.js.

CREATE TABLE users (
  id           bigserial PRIMARY KEY,
  display_name text NOT NULL,
  avatar_url   text,
  -- Роль хранится у пользователя, а не вычисляется каждый раз из окружения:
  -- запрос роли идёт в каждом защищённом маршруте. Обновляется при входе.
  role         text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identities (
  id          bigserial PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Список закрыт проверкой: опечатка в имени провайдера иначе тихо заведёт
  -- седьмой способ входа, который никто не обслуживает.
  provider    text NOT NULL CHECK (provider IN
                ('tg_widget', 'tg_miniapp', 'max_miniapp', 'google', 'vk', 'yandex')),
  -- Идентификатор у провайдера. Текст, а не число: у Telegram это int64, у
  -- Google — строка из цифр, у VK — число. Общий знаменатель — текст.
  external_id text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Главное ограничение всей авторизации: один аккаунт провайдера принадлежит
  -- ровно одному человеку на портале.
  UNIQUE (provider, external_id)
);

CREATE INDEX identities_user_id_idx ON identities (user_id);
