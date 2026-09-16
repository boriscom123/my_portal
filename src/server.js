// Точка входа. Задача — соединить в правильном порядке четыре вещи: конфиг,
// пул, миграции, приём запросов. Порядок здесь не косметика: принимать запросы
// на несоответствующей схеме нельзя. Запускается командой `node src/server.js`
// из CMD образа.
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { runMigrations } from './migrate.js';
import { createApp, finalize } from './app.js';
import { createQueue } from './queue.js';
import { webhookPath } from './routes/telegram-bot.js';

const config = loadConfig();
const pool = createPool(config.db);

const { applied } = await runMigrations(pool, new URL('../migrations/', import.meta.url));
if (applied.length) console.log(`Применены миграции: ${applied.join(', ')}`);

// Очередь создаём здесь и отдаём приложению: так его можно поднять в тесте
// без Redis, подсунув заглушку.
const queue = createQueue(config);

const app = finalize(createApp({ config, pool, queue }));
app.listen(config.port, () => console.log(`Портал слушает порт ${config.port}`));

// Бот должен знать, куда присылать обновления: без этого ссылка из анонса
// открывает бота, а он молчит. Адрес сообщаем при старте — он меняется вместе
// с токеном, и держать его в чужих настройках значило бы однажды разойтись.
// Отказ площадки портал не роняет: сайт работает и без бота.
if (config.telegram.botToken && config.publicBaseUrl.startsWith('https://')) {
  const url = `${config.publicBaseUrl}${webhookPath(config)}`;
  const api = config.telegram.apiUrl || 'https://api.telegram.org';
  fetch(`${api}/bot${config.telegram.botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Только сообщения: остальные обновления боту урока не нужны, а лишний
    // поток — лишняя работа и лишний повод для повторов.
    body: JSON.stringify({ url, allowed_updates: ['message'] })
  })
    .then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!body.ok) throw new Error(body.description ?? `ответ ${response.status}`);
      console.log('Бот слушает обновления портала');
    })
    .catch((error) => console.error('Бот не подписан на обновления:', error.message));
}
