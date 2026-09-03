// Точка входа. Задача — соединить в правильном порядке четыре вещи: конфиг,
// пул, миграции, приём запросов. Порядок здесь не косметика: принимать запросы
// на несоответствующей схеме нельзя. Запускается командой `node src/server.js`
// из CMD образа.
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { runMigrations } from './migrate.js';
import { createApp, finalize } from './app.js';
import { createQueue } from './queue.js';

const config = loadConfig();
const pool = createPool(config.db);

const { applied } = await runMigrations(pool, new URL('../migrations/', import.meta.url));
if (applied.length) console.log(`Применены миграции: ${applied.join(', ')}`);

// Очередь создаём здесь и отдаём приложению: так его можно поднять в тесте
// без Redis, подсунув заглушку.
const queue = createQueue(config);

const app = finalize(createApp({ config, pool, queue }));
app.listen(config.port, () => console.log(`Портал слушает порт ${config.port}`));
