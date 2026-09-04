// Точка входа воркера.
//
// Задача — поднять исполнителя очереди и держать его живым. Зачем отдельный
// процесс, а не поток внутри api: ffmpeg на часовом ролике занимает ядро
// целиком, и внутри api он тормозил бы каждую страницу портала.
// Запускается командой `node src/worker.js` из CMD контейнера worker.
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { waitForSchema } from './migrate.js';
import { createQueue, createWorker, scheduleCleanup, JOBS } from './queue.js';
import { makeFetchSource } from './jobs/fetch-source.js';
import { makeExtractAudio } from './jobs/extract-audio.js';
import { makeSubtitles } from './jobs/subtitles.js';
import { makeMakeCover } from './jobs/make-cover.js';
import { makeMakeClips } from './jobs/make-clips.js';
import { makeTrimPauses } from './jobs/trim-pauses.js';
import { makeSuggestTexts } from './jobs/suggest-texts.js';
import { createTexts } from './services/texts.js';
import { makeCleanupMedia } from './jobs/cleanup-media.js';
import { makeTranscribe } from './jobs/transcribe.js';
import { createSpeech } from './services/speech.js';
import { ensureModel } from './lib/whisper.js';

const config = loadConfig();
const pool = createPool(config.db);
const queue = createQueue(config);

// Схему накатывает api, воркер её только ждёт. Без ожидания первая же задача
// на чистой машине падает на несуществующей таблице.
const schema = await waitForSchema(pool, new URL('../migrations/', import.meta.url));
if (!schema.waited) {
  console.error(`Схема неполна, не хватает: ${schema.missing.join(', ')}. Работаем как есть.`);
}

// Модель качается один раз в том: класть 182 МБ в образ значило бы тянуть их
// в каждой сборке на сборщике GitHub. Не скачалась — работаем без расшифровки:
// остальные шаги конвейера от неё не зависят.
const speech = createSpeech(config);
for (const [name, model, modelUrl] of [
  ['распознавания', config.whisper.model, config.whisper.modelUrl],
  ['отсечения тишины', config.whisper.vadModel, config.whisper.vadModelUrl]
]) {
  try {
    const { downloaded, bytes } = await ensureModel({ model, modelUrl });
    if (downloaded) console.log(`Модель ${name} скачана: ${bytes} байт`);
  } catch (error) {
    console.error(`Модель ${name} недоступна: ${error.message}`);
  }
}

// Обработчики шагов конвейера. Добавляются по мере готовности.
const handlers = {
  [JOBS.fetchSource]: makeFetchSource(config, pool, queue),
  [JOBS.extractAudio]: makeExtractAudio(config, pool, queue),
  [JOBS.transcribe]: makeTranscribe(config, pool, queue, speech),
  [JOBS.subtitles]: makeSubtitles(config, pool, queue),
  [JOBS.suggestTexts]: makeSuggestTexts(config, pool, createTexts(config)),
  [JOBS.trimPauses]: makeTrimPauses(config, pool, queue),
  [JOBS.makeClips]: makeMakeClips(config, pool, queue),
  [JOBS.makeCover]: makeMakeCover(config, pool),
  [JOBS.cleanupMedia]: makeCleanupMedia(config, pool)
};

const worker = createWorker(config, handlers);

worker.on('active', async (job) => {
  // Какой шаг идёт сейчас — чтобы кабинет писал «распознаётся речь», а не
  // «обрабатывается» полчаса подряд. Уборка буфера к уроку не относится.
  if (!job?.data?.lessonId) return;
  await pool
    .query(
      `UPDATE lessons SET pipeline_state = 'processing', pipeline_job = $1 WHERE id = $2`,
      [JSON.stringify({ name: job.name, data: job.data }), job.data.lessonId]
    )
    .catch((error) => console.error('Не удалось записать текущий шаг:', error.message));
});

worker.on('completed', (job) => {
  console.log(`Задача ${job.name} выполнена`);
});

worker.on('failed', async (job, err) => {
  console.error(`Задача ${job?.name} упала: ${err.message}`);
  // Причину видит автор в кабинете, а не только журнал контейнера: с телефона
  // до журнала не добраться, а понять, почему урок застрял, нужно именно там.
  if (job?.data?.lessonId) {
    await pool
      .query(
        `UPDATE lessons SET pipeline_state = 'failed', pipeline_error = $1, pipeline_job = $2
          WHERE id = $3`,
        [
          `${job.name}: ${err.message}`.slice(0, 500),
          // Упавшая задача целиком: кнопка «Повторить» в кабинете ставит
          // ровно её. Разбирать имя шага из текста ошибки нельзя — текст
          // писан для человека и однажды поменяется.
          JSON.stringify({ name: job.name, data: job.data }),
          job.data.lessonId
        ]
      )
      .catch((dbError) => console.error('Не удалось записать ошибку в урок:', dbError.message));
  }
});

await scheduleCleanup(queue);

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
