// Точка входа воркера.
//
// Задача — поднять исполнителя очереди и держать его живым. Зачем отдельный
// процесс, а не поток внутри api: ffmpeg на часовом ролике занимает ядро
// целиком, и внутри api он тормозил бы каждую страницу портала.
// Запускается командой `node src/worker.js` из CMD контейнера worker.
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createQueue, createWorker, JOBS } from './queue.js';
import { makeFetchSource } from './jobs/fetch-source.js';

const config = loadConfig();
const pool = createPool(config.db);
const queue = createQueue(config);

// Обработчики шагов конвейера. Добавляются по мере готовности.
const handlers = {
  [JOBS.fetchSource]: makeFetchSource(config, pool, queue)
};

const worker = createWorker(config, handlers);

worker.on('completed', (job) => {
  console.log(`Задача ${job.name} выполнена`);
});

worker.on('failed', async (job, err) => {
  console.error(`Задача ${job?.name} упала: ${err.message}`);
  // Причину видит автор в кабинете, а не только журнал контейнера: с телефона
  // до журнала не добраться, а понять, почему урок застрял, нужно именно там.
  if (job?.data?.lessonId) {
    await pool
      .query(`UPDATE lessons SET pipeline_state = 'failed', pipeline_error = $1 WHERE id = $2`, [
        `${job.name}: ${err.message}`.slice(0, 500),
        job.data.lessonId
      ])
      .catch((dbError) => console.error('Не удалось записать ошибку в урок:', dbError.message));
  }
});

console.log(`Воркер поднят, известные шаги: ${Object.values(JOBS).join(', ')}`);

// Закрываемся аккуратно: docker шлёт SIGTERM, и незакрытая задача иначе
// останется висеть в очереди «в работе» до истечения блокировки.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    console.log('Останавливаемся, доделываю текущую задачу…');
    await worker.close();
    await queue.close();
    await pool.end();
    process.exit(0);
  });
}
