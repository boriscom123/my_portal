// Очередь обработки уроков.
//
// Задача — дать приложению и воркеру одно место, где записаны имена шагов и
// параметры подключения. Зачем очередь вообще: шаги конвейера идут минутами и
// часами, а HTTP-запрос столько не живёт; к тому же упавший шаг должен
// повторяться сам, с нарастающей паузой, а не терять урок.
// Вызывается из src/app.js (постановка задач) и src/worker.js (исполнение).
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

/**
 * Имена шагов конвейера. Строками в одном месте, а не свободным текстом по
 * вызову: опечатка в имени означает задачу, которая никогда не выполнится, и
 * заметить это можно только по уроку, застрявшему на середине.
 */
export const JOBS = {
  extractAudio: 'extractAudio',
  transcribe: 'transcribe',
  subtitles: 'subtitles',
  generateTexts: 'generateTexts',
  makeClips: 'makeClips',
  makeCover: 'makeCover',
  cleanupMedia: 'cleanupMedia'
};

/** Одна очередь на весь конвейер: шаги идут по порядку, а не наперегонки. */
export function queueName() {
  return 'pipeline';
}

/**
 * Приставка к ключам в Redis.
 * Двоеточие BullMQ ставит сам и в имени очереди его не допускает — оно у него
 * разделитель внутренних ключей. Поэтому из настройки его убираем.
 * Redis на сервере общий, и без приставки задачи портала смешались бы с
 * ключами соседних проектов.
 */
export function queuePrefix(config) {
  return config.redis.prefix.replace(/:+$/, '');
}

/**
 * Ключ задачи. Одинаковый ключ не встаёт в очередь дважды — это защита от
 * двойного запуска одного шага: два распознавания одного файла означают
 * двойной счёт у поставщика и гонку за одну таблицу.
 */
export function jobKey(name, lessonId) {
  return `${name}:${lessonId}`;
}

/**
 * Подключение к общему Redis сервера.
 *
 * Клиент создаётся здесь и передаётся в BullMQ готовым: в ESM-окружении он не
 * умеет собрать его сам по параметрам и падает с просьбой передать экземпляр.
 * maxRetriesPerRequest: null — требование BullMQ: он сам решает, когда
 * сдаваться, и клиент не должен обрывать долгое ожидание задачи.
 */
function connection(config) {
  return new IORedis(config.redis.url, { maxRetriesPerRequest: null });
}

/**
 * Настройки повторов. Шаги конвейера падают из-за чужой сети и чужих квот, а
 * не из-за нашей логики, поэтому повтор обязателен, а пауза растёт: три
 * попытки, начиная с полуминуты.
 */
const RETRY = { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } };

export function createQueue(config) {
  return new Queue(queueName(), {
    connection: connection(config),
    prefix: queuePrefix(config),
    defaultJobOptions: RETRY
  });
}

/**
 * Создаёт исполнителя задач.
 * concurrency: 1 — не осторожность, а рамка: на двух ядрах параллельная
 * обработка двух уроков положит и портал, и соседние проекты этого сервера.
 */
export function createWorker(config, handlers) {
  return new Worker(
    queueName(),
    async (job) => {
      const handler = handlers[job.name];
      if (!handler) throw new Error(`Неизвестная задача: ${job.name}`);
      return handler(job.data, job);
    },
    { connection: connection(config), prefix: queuePrefix(config), concurrency: 1 }
  );
}
