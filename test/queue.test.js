// Проверка очереди. Очередь — единственное место, где приложение и воркер
// договариваются: перепутанное имя задачи означает, что она никогда не
// выполнится, и заметить это можно только по неработающему уроку.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JOBS, queueName, queuePrefix, jobKey } from '../src/queue.js';

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
