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
    yandexOauth: {
      clientId: env.YANDEX_OAUTH_CLIENT_ID ?? '',
      clientSecret: env.YANDEX_OAUTH_CLIENT_SECRET ?? ''
    },
    // Ключ шифрования чужих токенов в базе. Без него подключить Диск и
    // площадки нельзя, но портал работает: витрина и вход от него не зависят.
    tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY ?? '',
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
    // Модель для текстов урока: заголовок, описание, теги. Без ключа портал
    // работает — заполнение полей берёт заготовку из расшифровки своими
    // силами, просто заметно грубее.
    gemini: {
      apiKey: env.GEMINI_API_KEY ?? '',
      // Список моделей в порядке предпочтения, а не одна.
      //
      // Одна не годится по двум причинам сразу, и обе встретились в первый же
      // день. Закреплённое имя умирает: «gemini-2.5-flash is no longer
      // available to new users». А на бесплатной доле все ходовые модели разом
      // отвечают 503 «высокий спрос» — проверено, из пяти отвечала одна.
      // Поэтому перебираем: первая ответившая и делает работу.
      model:
        env.GEMINI_MODEL ??
        'gemini-flash-latest,gemini-3-flash-preview,gemini-flash-lite-latest'
    },
    // Распознавание речи считается на самом сервере. Пути задаются
    // окружением, потому что в образе бинарник и модель лежат в разных местах:
    // бинарник в образе, модель — в томе, чтобы не качать её каждой сборкой.
    whisper: {
      bin: env.WHISPER_BIN ?? 'whisper-cli',
      model: env.WHISPER_MODEL ?? '/app/models/ggml-small-q5_1.bin',
      modelUrl:
        env.WHISPER_MODEL_URL ??
        'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin',
      language: env.WHISPER_LANGUAGE ?? 'ru',
      // Модель отсечения тишины. Без неё модель распознавания залипает на
      // паузах и до конца записи печатает одну и ту же строку — проверено на
      // настоящем уроке. Весит меньше мегабайта и качается в тот же том.
      vadModel: env.WHISPER_VAD_MODEL ?? '/app/models/ggml-silero-v5.1.2.bin',
      vadModelUrl:
        env.WHISPER_VAD_MODEL_URL ??
        'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin',
      // Два потока — все ядра машины. Приоритет при этом понижен, иначе портал
      // перестаёт открываться на всё время счёта.
      threads: Number(env.WHISPER_THREADS ?? 2)
    },
    media: {
      dir: env.MEDIA_DIR ?? '/app/media',
      ttlHours: Number(env.MEDIA_TTL_HOURS ?? DEFAULT_MEDIA_TTL_HOURS)
    }
  };
}
