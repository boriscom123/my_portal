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

// Скорость разворота на месте, градусов в секунду, и нижняя граница времени.
//
// Разворот занимал миг: в кадрах полёта угол сразу стоял конечный, и ракета
// «прыгала» носом. Заказчик увидел это первым. Теперь она сперва поворачивается
// на месте, и только потом трогается.
const TURN_SPEED = 260;
const MIN_TURN_MS = 220;

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
 * Приводит целевой угол к ближайшему повороту от нынешнего.
 *
 * Без этого разворот с 170 градусов на минус 170 шёл бы через полный круг: по
 * числам это 340 градусов, а по-настоящему — двадцать. Ракета крутилась бы
 * волчком там, где должна чуть довернуть.
 */
export function shortestAngle(fromAngle, toAngle) {
  let turn = (toAngle - fromAngle) % 360;
  if (turn > 180) turn -= 360;
  if (turn < -180) turn += 360;
  return fromAngle + turn;
}

/** Сколько занимает разворот на месте: чем больше угол, тем дольше. */
export function turnMs(fromAngle, toAngle) {
  const turn = Math.abs(shortestAngle(fromAngle, toAngle) - fromAngle);
  return Math.round(Math.max(MIN_TURN_MS, (turn / TURN_SPEED) * 1000));
}

/**
 * Полный план перелёта: сперва разворот на месте, потом движение.
 *
 * Раздельно, а не одним движением: разворот в пути читается как занос, а
 * мгновенный доворот в первом кадре — как рывок. Заказчик просил именно
 * «занять правильную позицию с анимацией разворота».
 *
 * Наплыв к середине сделан опорным кадром: плавным переходом его не выразить —
 * переход умеет только начало и конец, а всё между ними у него линейно.
 */
export function flightPlan({ from, to, size, fromAngle = 0, peakScale = PEAK_SCALE }) {
  const angle = shortestAngle(fromAngle, angleFor(from, to));
  const turn = turnMs(fromAngle, angle);
  const move = flightMs(from, to);
  const duration = turn + move;

  const half = { x: size.width / 2, y: size.height / 2 };
  const at = (point, degrees, scale) =>
    `translate(${point.x - half.x}px, ${point.y - half.y}px) rotate(${degrees}deg) scale(${scale})`;

  const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const turnEnd = turn / duration;

  return {
    angle,
    duration,
    // Кривая у каждого отрезка своя, и это не украшение.
    //
    // Разворот начинается и кончается стоя — ему плавность с обеих сторон.
    // А полёт обязан быть ОДНИМ движением: сперва разгон, потом торможение.
    // Первый заход задавал обеим половинам плавное окончание, и ракета честно
    // тормозила до нуля в середине пути — заказчик увидел это как замирание в
    // самой крупной точке.
    keyframes: [
      // Стоим и поворачиваемся.
      { transform: at(from, fromAngle, 1), offset: 0, easing: 'ease-in-out' },
      // Тронулись: разгоняемся к середине и проходим её на полном ходу.
      { transform: at(from, angle, 1), offset: turnEnd, easing: 'ease-in' },
      // Вторая половина: тормозим к цели.
      { transform: at(middle, angle, peakScale), offset: turnEnd + (1 - turnEnd) / 2, easing: 'ease-out' },
      { transform: at(to, angle, 1), offset: 1 }
    ]
  };
}

/** Положение без полёта: им ракета ставится на стоянку перед вылетом. */
export function restingTransform(point, size, angle = 0) {
  return `translate(${point.x - size.width / 2}px, ${point.y - size.height / 2}px) rotate(${angle}deg)`;
}
