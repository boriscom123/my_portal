// Проверка очереди. Очередь — единственное место, где приложение и воркер
// договариваются: перепутанное имя задачи означает, что она никогда не
// выполнится, и заметить это можно только по неработающему уроку.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JOBS, queueName, queuePrefix, jobKey, jobOptions, addJob } from '../src/queue.js';

test('имена задач заданы явно и не повторяются', () => {
  const names = Object.values(JOBS);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes('extractAudio'));
  assert.ok(names.includes('transcribe'));
});

test('очередь живёт под приставкой портала', () => {
  // Redis общий на весь сервер: без приставки задачи портала смешались бы с
  // ключами соседних проектов. Двоеточие BullMQ ставит сам и в имени очереди
  // его не допускает — на этом первый запуск воркера и упал.
  assert.equal(queueName(), 'pipeline');
  assert.equal(queuePrefix({ redis: { prefix: 'portal:' } }), 'portal');
  assert.equal(queuePrefix({ redis: { prefix: 'portal' } }), 'portal');
});

test('ключ задачи собирается из шага и урока', () => {
  // Один и тот же шаг для одного урока не должен стоять в очереди дважды:
  // два распознавания одного файла — это двойной счёт и гонка за таблицу.
  assert.equal(jobKey('transcribe', 42), 'transcribe:42');
});

test('тяжёлые шаги сами не повторяются', () => {
  // Расшифровка часового урока идёт двадцать пять минут и падает по причинам
  // постоянным: нет файла, нет модели, битый звук. Три попытки — это
  // семьдесят пять минут двухъядерной машины на повторение одного и того же
  // отказа, и всё это время автор видит «обрабатывается».
  assert.deepEqual(jobOptions(JOBS.transcribe), { attempts: 1 });
  assert.deepEqual(jobOptions(JOBS.makeClips), { attempts: 1 });
});

test('шаги с временными отказами повторяются как обычно', () => {
  // Диск мог ответить пятисотой, сеть моргнуть: тут повтор осмыслен, и
  // настройки берутся общие для очереди.
  assert.deepEqual(jobOptions(JOBS.fetchSource), {});
  assert.deepEqual(jobOptions(JOBS.makeCover), {});
});

test('обёртка ставит задачу с настройками её шага', async () => {
  // Шаги ставят друг друга из семи мест; правило должно жить в одном.
  const calls = [];
  const queue = { add: async (...args) => calls.push(args) };
  await addJob(queue, JOBS.transcribe, { lessonId: 1 });
  await addJob(queue, JOBS.fetchSource, { lessonId: 1 });
  assert.deepEqual(calls[0], ['transcribe', { lessonId: 1 }, { attempts: 1 }]);
  assert.deepEqual(calls[1], ['fetchSource', { lessonId: 1 }, {}]);
});
