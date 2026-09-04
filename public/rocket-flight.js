/* Расчёты полёта ракеты.
 *
 * Задача — держать в одном месте то, что можно проверить без браузера: куда
 * повернуть, сколько лететь и виден ли ещё тот, к кому летим. Само движение
 * живёт в app.js, потому что ему нужны настоящие узлы страницы.
 *
 * Знак проекта нарисован носом вверх, и все углы здесь считаются от этого
 * направления: перепутанный отсчёт даёт ракету, летящую хвостом вперёд, —
 * ошибку, которую видно только глазами.
 * Подключается из public/app.js.
 */

// Сколько точек экрана ракета проходит за секунду. Полсекунды на короткий
// перелёт и полторы на весь экран — быстрее выглядит рывком, медленнее
// заставляет ждать.
const SPEED = 900;
const MIN_MS = 260;
const MAX_MS = 1400;

/** Середина прямоугольника: к ней и летим, а не к углу. */
export function centerOf(rect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Угол поворота в градусах, чтобы нос смотрел из from в to.
 * Ноль — нос вверх, как нарисовано; дальше по часовой стрелке.
 */
export function angleFor(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // Ракета стоит носом вверх, то есть вдоль (0, -1): угол считаем от него.
  if (dx === 0 && dy === 0) return 0;
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

/** Расстояние между точками. */
export function distance(from, to) {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/**
 * Сколько лететь, в миллисекундах.
 * Время от расстояния, а не одинаковое: перелёт через весь экран за то же
 * время, что и на соседнюю кнопку, выглядит телепортацией.
 */
export function flightMs(from, to, speed = SPEED) {
  const ms = (distance(from, to) / speed) * 1000;
  return Math.round(Math.min(MAX_MS, Math.max(MIN_MS, ms)));
}

/**
 * Виден ли ещё тот, к кому летим.
 * Заказчик просил прямо: цель уехала прокруткой — ракета возвращается на базу,
 * а не летит в пустоту за краем экрана.
 */
export function isOnScreen(rect, viewport) {
  if (!rect || rect.width === 0 || rect.height === 0) return false;
  return (
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < viewport.height &&
    rect.left < viewport.width
  );
}

/**
 * Стоит ли лететь к этому узлу.
 *
 * Летим к тому, по чему человек осмысленно нажал: ссылка, кнопка, раскрывающая
 * часть меню. По тексту абзаца — нет: ракета, срывающаяся с места от любого
 * тычка в страницу, мешает читать.
 */
export function flightTarget(element) {
  if (!element || typeof element.closest !== 'function') return null;
  const target = element.closest('a, button, summary, label[for], [role="button"]');
  if (!target) return null;
  // Сам знак — это база. Лететь из базы в базу незачем.
  if (target.closest('.logo')) return null;
  return target;
}
