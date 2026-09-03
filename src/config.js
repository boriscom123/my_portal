// Конфигурация портала: единственное место, где читается окружение.
// Зачем единственное: секретов в публичном репозитории быть не может, а
// разбросанные по коду process.env превращают проверку «ничего не утекло» в
// вычитывание всего проекта. Здесь же приложение падает на старте, если
// обязательной переменной нет, — вместо загадочной ошибки в первом запросе.
// Вызывается из src/server.js один раз при запуске и из тестов с подставным
// окружением.

// Порт приложения. 3001 занят game, 3002 devbot, 3003 myproject.
const DEFAULT_PORT = 3004;

// Срок жизни файла в рабочем буфере по умолчанию — неделя. Постоянного
// видеоархива у портала нет, буфер обязан чистить себя сам.
const DEFAULT_MEDIA_TTL_HOURS = 168;

/**
 * Читает переменную, которой не может не быть.
 * Зачем отдельной функцией: сообщение об ошибке должно называть переменную,
 * иначе в логе остаётся «undefined» без подсказки, что именно не задано.
 * Вызывается только из loadConfig.
 */
function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`Не задана обязательная переменная окружения ${name}`);
  return value;
}

/**
 * Разбирает список админов вида "google:42,tg_widget:7".
 * Зачем: роль администратора нельзя выдавать по факту регистрации — портал
 * публичный, и первым может зарегистрироваться кто угодно. Админ назначается
 * снаружи, окружением. Вызывается только из loadConfig.
 */
function parseAdminIdentities(raw) {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [provider, externalId] = item.split(':');
      return { provider: provider.trim(), externalId: String(externalId).trim() };
    });
}

/**
 * Собирает конфигурацию приложения из окружения.
 * Зачем принимает env аргументом: так конфигурацию можно проверить тестом,
 * не подменяя process.env глобально.
 * Вызывается из src/server.js и из тестов.
 */
export function loadConfig(env = process.env) {
  return {
    publicBaseUrl: required(env, 'PUBLIC_BASE_URL').replace(/\/+$/, ''),
    port: Number(env.PORT ?? DEFAULT_PORT),
    db: {
      host: required(env, 'DB_HOST'),
      port: Number(env.DB_PORT ?? 5432),
      name: required(env, 'DB_NAME'),
      user: required(env, 'DB_USER'),
      password: required(env, 'DB_PASS')
    },
    jwtSecret: required(env, 'JWT_SECRET'),
    redis: {
      // Общий Redis сервера. Префикс обязателен: без него задачи портала
      // смешались бы с ключами соседних проектов в одной базе.
      url: env.REDIS_URL ?? 'redis://redis:6379',
      prefix: env.REDIS_PREFIX ?? 'portal:'
    },
    yandex: {
      apiKey: env.YANDEX_CLOUD_API_KEY ?? '',
      folderId: env.YANDEX_CLOUD_FOLDER_ID ?? ''
    },
    adminIdentities: parseAdminIdentities(env.ADMIN_IDENTITIES ?? ''),
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN ?? '',
      // Виджет входа на сайте адресуется к боту по имени, а не по токену:
      // токен секретный и в разметку попасть не может. Без имени виджета не
      // будет, даже если токен задан.
      botUsername: (env.TELEGRAM_BOT_USERNAME ?? '').replace(/^@/, ''),
      // Номер бота — часть токена до двоеточия. Секретной является вторая
      // половина, а номер нужен ссылке входа и виден в любом виджете.
      botId: (env.TELEGRAM_BOT_TOKEN ?? '').split(':')[0],
      channelId: env.TELEGRAM_CHANNEL_ID ?? ''
    },
    google: {
      clientId: env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: env.GOOGLE_CLIENT_SECRET ?? ''
    },
    vapid: {
      publicKey: env.VAPID_PUBLIC ?? '',
      privateKey: env.VAPID_PRIVATE ?? '',
      subject: env.VAPID_SUBJECT ?? 'mailto:admin@example.com'
    },
    media: {
      dir: env.MEDIA_DIR ?? '/app/media',
      ttlHours: Number(env.MEDIA_TTL_HOURS ?? DEFAULT_MEDIA_TTL_HOURS)
    }
  };
}
