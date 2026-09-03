// Адреса статики с отпечатком содержимого.
//
// Задача — чтобы правка стилей доходила до человека сразу, а не через час.
// Статика отдаётся с Cache-Control на час: без отпечатка браузер продолжает
// показывать старый CSS, и выкаченное исправление выглядит как невыкаченное.
// Ровно на этом и обожглись: белые полосы в тёмной теме были уже починены, а
// у заказчика оставались.
//
// Отпечаток считается один раз при старте: файлы в образе не меняются, а
// пересчёт на каждый запрос — лишняя работа на каждой странице.
// Вызывается из src/views/layout.js.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const DIR = new URL('../../public/', import.meta.url);

// Восьми знаков хватает: столкновение двух версий одного файла на таком
// количестве вариантов практически невозможно, а адрес остаётся читаемым.
const FINGERPRINT_LENGTH = 8;

const fingerprints = new Map();

/**
 * Возвращает адрес файла статики с отпечатком: /styles.css?v=1a2b3c4d.
 * Если файла нет — отдаёт адрес как есть: страница важнее, чем кеш.
 */
export function assetUrl(path) {
  if (!fingerprints.has(path)) {
    try {
      const content = readFileSync(new URL(path.replace(/^\//, ''), DIR));
      fingerprints.set(path, createHash('sha256').update(content).digest('hex').slice(0, FINGERPRINT_LENGTH));
    } catch {
      fingerprints.set(path, null);
    }
  }
  const fingerprint = fingerprints.get(path);
  return fingerprint ? `${path}?v=${fingerprint}` : path;
}
