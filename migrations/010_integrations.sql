-- Подключения к чужим сервисам: Яндекс Диск сейчас, площадки с этапа 7.
--
-- Токен лежит зашифрованным: он даёт доступ к диску заказчика, и открытым
-- текстом любой дамп базы становится утечкой. Ключ живёт в окружении, поэтому
-- дамп без него бесполезен. Спека требует того же для токенов площадок.
-- Читается из src/services/disk.js.
CREATE TABLE integrations (
  -- Имя сервиса: одно подключение на сервис, потому что автор один.
  name          text PRIMARY KEY,
  token         text NOT NULL,
  refresh_token text,
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
