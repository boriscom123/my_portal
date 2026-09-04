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

// Сколько точек экрана ракета проходит за секунду.
//
// Впятеро медленнее первого захода: там полёт читался как рывок, за движением
// не успевал глаз. Заказчик попросил именно «примерно в пять раз», и это тот
// случай, когда просьбу надо выполнить буквально, а не «на свой вкус».
const SPEED = 180;
const MIN_MS = 1300;
const MAX_MS = 7000;

// Во сколько раз ракета крупнее в середине пути.
//
// Она словно выходит на орбиту и проходит ближе к смотрящему: у начала и конца
// размер обычный, к середине растёт. Полтора раза мало — движение к зрителю не
// читается; втрое много — ракета перекрывает пол-экрана.
const PEAK_SCALE = 1.9;

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

/**
 * Собирает опорные кадры полёта.
 *
 * Три кадра, а не два: плавным переходом «наплыв» к середине не сделать —
 * переход умеет только начало и конец, и любое промежуточное состояние в нём
 * получается линейным. Середина здесь — настоящая опорная точка.
 *
 * Угол один на весь перелёт: ракета летит по прямой, и доворачивать её в пути
 * незачем — она уже смотрит носом на цель.
 */
export function flightKeyframes(from, to, { size, peakScale = PEAK_SCALE } = {}) {
  const angle = angleFor(from, to);
  const half = { x: size.width / 2, y: size.height / 2 };
  const at = (point, scale) =>
    `translate(${point.x - half.x}px, ${point.y - half.y}px) rotate(${angle}deg) scale(${scale})`;

  const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  return [
    { transform: at(from, 1), offset: 0 },
    { transform: at(middle, peakScale), offset: 0.5 },
    { transform: at(to, 1), offset: 1 }
  ];
}

/** Положение без полёта: им ракета ставится на стоянку перед вылетом. */
export function restingTransform(point, size, angle = 0) {
  return `translate(${point.x - size.width / 2}px, ${point.y - size.height / 2}px) rotate(${angle}deg)`;
}
