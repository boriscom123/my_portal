// Канал Web Push. Задача — разослать сообщение по всем устройствам человека и
// убрать те подписки, которые браузер объявил мёртвыми. Зачем убирать: отписки
// при удалении приложения не происходит, и без чистки таблица за год
// наполнится адресами, в которые никто не смотрит.
// Вызывается из слоя уведомлений (src/services/notify/index.js).
import webpush from 'web-push';

// Сутки жизни у сообщения на сервере проталкивания: телефон в самолёте должен
// получить уведомление о новом уроке, когда включится, а не потерять его.
const ЖИЗНЬ_СЕКУНД = 86_400;

// Коды, которыми браузер сообщает «этой подписки больше нет».
const МЁРТВЫЕ = [404, 410];

export function createWebPushChannel(config, pool) {
  // Необязательные поля читаются через ?. намеренно: приложение должно
  // подниматься и без настроенных пушей — например, в тестах витрины.
  if (!config.vapid?.publicKey || !config.vapid?.privateKey) return null;

  try {
    webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
  } catch (err) {
    // Испорченный ключ в окружении не должен ронять портал целиком: без пушей
    // сайт работает, а слой уведомлений просто перейдёт к следующему каналу.
    // Кричим в лог, потому что тихо отключённые пуши — худший из исходов.
    console.error('Ключи Web Push не приняты, пуши отключены:', err.message);
    return null;
  }

  return async (подписки, сообщение) => {
    const тело = JSON.stringify(сообщение);
    for (const п of подписки) {
      try {
        await webpush.sendNotification(
          { endpoint: п.endpoint, keys: { p256dh: п.p256dh, auth: п.auth } },
          тело,
          { TTL: ЖИЗНЬ_СЕКУНД }
        );
      } catch (err) {
        if (МЁРТВЫЕ.includes(err.statusCode)) {
          await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [п.endpoint]);
        } else {
          throw err;
        }
      }
    }
  };
}
