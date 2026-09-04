// Расчёты полёта ракеты. Само движение проверить без браузера нельзя, а вот
// угол поворота и решение «цель уехала прокруткой» — можно, и именно они
// ломаются незаметно: ракета летит хвостом вперёд или в пустоту за краем.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  angleFor,
  centerOf,
  distance,
  flightMs,
  isOnScreen,
  flightTarget,
  restingTransform,
  flightPlan,
  shortestAngle,
  turnMs
} from '../public/rocket-flight.js';

const base = { x: 100, y: 100 };

test('нос смотрит туда, куда летим', () => {
  // Знак нарисован носом вверх, и ноль градусов — это вверх.
  assert.equal(angleFor(base, { x: 100, y: 0 }), 0, 'вверх');
  assert.equal(angleFor(base, { x: 200, y: 100 }), 90, 'вправо');
  assert.equal(Math.abs(angleFor(base, { x: 100, y: 200 })), 180, 'вниз');
  assert.equal(angleFor(base, { x: 0, y: 100 }), -90, 'влево');
  // По диагонали — ровно между.
  assert.equal(Math.round(angleFor(base, { x: 200, y: 0 })), 45);
});

test('полёт в саму себя не крутит ракету', () => {
  // Иначе нажатие по кнопке под самой ракетой дёргало бы её на случайный угол.
  assert.equal(angleFor(base, { ...base }), 0);
});

test('летим в середину цели, а не в её угол', () => {
  assert.deepEqual(centerOf({ left: 10, top: 20, width: 100, height: 40 }), { x: 60, y: 40 });
});

test('время полёта растёт с расстоянием, но в пределах', () => {
  const near = flightMs(base, { x: 110, y: 100 });
  const far = flightMs(base, { x: 1900, y: 1000 });
  assert.ok(near < far, 'через весь экран не должно быть так же быстро, как на соседнюю кнопку');
  // Ниже нижней границы полёт выглядит рывком, выше верхней — заставляет ждать.
  // Границы подняты впятеро по просьбе заказчика: прежние читались как рывок.
  assert.ok(near >= 1300, `вышло ${near} мс`);
  assert.ok(far <= 7000, `вышло ${far} мс`);
  assert.equal(distance(base, { x: 100, y: 400 }), 300);
});

test('уехавшая за край цель считается пропавшей', () => {
  const viewport = { width: 1200, height: 800 };
  const visible = { left: 100, top: 100, right: 300, bottom: 140, width: 200, height: 40 };
  assert.ok(isOnScreen(visible, viewport));

  // Заказчик просил прямо: цель уехала прокруткой — ракета летит на базу, а не
  // в пустоту за краем экрана.
  const scrolledUp = { left: 100, top: -200, right: 300, bottom: -160, width: 200, height: 40 };
  assert.ok(!isOnScreen(scrolledUp, viewport));
  const scrolledDown = { left: 100, top: 900, right: 300, bottom: 940, width: 200, height: 40 };
  assert.ok(!isOnScreen(scrolledDown, viewport));
  // Спрятанный узел даёт нулевой прямоугольник — лететь к нему тоже некуда.
  assert.ok(!isOnScreen({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }, viewport));
  assert.ok(!isOnScreen(null, viewport));
});

test('цель наполовину за краем ещё считается видимой', () => {
  // Иначе ракета разворачивалась бы на полпути к кнопке, которую человек
  // отлично видит.
  const half = { left: -50, top: 100, right: 60, bottom: 140, width: 110, height: 40 };
  assert.ok(isOnScreen(half, { width: 1200, height: 800 }));
});

test('летим к тому, по чему нажали осмысленно', () => {
  // Заглушка узла: настоящего DOM в тестах нет, а нужен только closest.
  // Найденный узел отвечает на closest сам — так же, как настоящий.
  const node = (matches) => {
    const self = {
      matches,
      closest: (selector) => (matches.includes(selector) ? self : null)
    };
    return self;
  };
  const CONTROL = 'a, button, summary, label[for], [role="button"]';

  assert.ok(flightTarget(node([CONTROL])), 'по кнопке лететь надо');
  // По тексту абзаца не летим: ракета, срывающаяся от любого тычка в страницу,
  // мешает читать.
  assert.equal(flightTarget(node([])), null);
  assert.equal(flightTarget(null), null);
  // Сам знак — это база: лететь из базы в базу незачем.
  assert.equal(flightTarget(node([CONTROL, '.logo'])), null);
});

const size = { width: 14, height: 34 };
const at = (frame) => ({
  x: Number(frame.transform.match(/translate\((-?[\d.]+)px/)[1]),
  angle: Number(frame.transform.match(/rotate\((-?[\d.]+)deg\)/)[1]),
  scale: Number(frame.transform.match(/scale\(([\d.]+)\)/)[1])
});

test('сперва разворот на месте, потом движение', () => {
  const plan = flightPlan({ from: { x: 0, y: 0 }, to: { x: 400, y: 0 }, size, fromAngle: 0 });
  const frames = plan.keyframes.map(at);

  // Разворот занимал миг: угол сразу стоял конечный, и ракета прыгала носом.
  assert.equal(frames[0].angle, 0, 'начинаем с нынешнего курса');
  assert.equal(frames[1].angle, 90, 'довернулись');
  // И всё это не сходя с места.
  assert.equal(frames[0].x, frames[1].x, 'ракета поехала, не закончив разворот');
  // Дальше — движение, и угол уже не меняется: доворот в пути читается заносом.
  assert.equal(frames[2].angle, 90);
  assert.equal(frames[3].angle, 90);
  assert.ok(frames[3].x > frames[1].x);
});

test('в середине пути ракета крупнее, по краям обычная', () => {
  const plan = flightPlan({ from: { x: 0, y: 0 }, to: { x: 400, y: 0 }, size, fromAngle: 0 });
  const frames = plan.keyframes.map(at);
  assert.equal(frames[0].scale, 1);
  assert.equal(frames[3].scale, 1);
  // К середине ракета словно выходит на орбиту и проходит ближе к смотрящему.
  assert.ok(frames[2].scale > 1.4, `в середине вышло ${frames[2].scale}`);
});

test('наплыв приходится на середину именно ПОЛЁТА, а не всего действия', () => {
  const plan = flightPlan({ from: { x: 0, y: 0 }, to: { x: 400, y: 0 }, size, fromAngle: 0 });
  const [, turnEnd, middle, end] = plan.keyframes;
  // Разворот занимает начало действия, и середину надо считать от его конца:
  // иначе наплыв случался бы, пока ракета ещё стоит на месте.
  const expected = turnEnd.offset + (1 - turnEnd.offset) / 2;
  assert.ok(Math.abs(middle.offset - expected) < 0.001, `вышло ${middle.offset}`);
  assert.equal(end.offset, 1);
});

test('время разворота растёт с углом', () => {
  // Полный разворот дольше лёгкого доворота — иначе оба выглядят рывком.
  assert.ok(turnMs(0, 180) > turnMs(0, 10));
  assert.ok(turnMs(0, 5) >= 220, 'у мелкого доворота есть нижняя граница');
});

test('разворачиваемся кратчайшим путём', () => {
  // Иначе поворот с 170 на минус 170 шёл бы через полный круг: по числам это
  // 340 градусов, а по-настоящему — двадцать.
  assert.equal(shortestAngle(170, -170), 190);
  assert.equal(shortestAngle(-170, 170), -190);
  assert.equal(shortestAngle(0, 90), 90);
  assert.equal(shortestAngle(0, -90), -90);
});

test('разворот учитывает, куда ракета смотрит сейчас', () => {
  // Без этого каждый новый курс начинался бы с носа вверх, и ракета дёргалась
  // бы перед вылетом.
  const plan = flightPlan({ from: { x: 0, y: 0 }, to: { x: 0, y: 400 }, size, fromAngle: 90 });
  assert.equal(at(plan.keyframes[0]).angle, 90, 'начали не с нынешнего курса');
  assert.equal(at(plan.keyframes[1]).angle, 180);
});

test('полёт стал впятеро медленнее', () => {
  // Заказчик попросил именно «примерно в пять раз»: до этого движение
  // читалось как рывок, за ним не успевал глаз.
  const short = flightMs({ x: 0, y: 0 }, { x: 10, y: 0 });
  const long = flightMs({ x: 0, y: 0 }, { x: 1900, y: 900 });
  assert.ok(short >= 1200, `короткий перелёт ${short} мс — всё ещё рывок`);
  assert.ok(long >= 5000, `дальний перелёт ${long} мс`);
});

test('полное действие дольше одного только перелёта', () => {
  const plan = flightPlan({ from: { x: 0, y: 0 }, to: { x: 400, y: 0 }, size, fromAngle: 0 });
  assert.ok(plan.duration > flightMs({ x: 0, y: 0 }, { x: 400, y: 0 }), 'разворот не учтён');
});

test('стоянка задаётся без наплыва и без поворота', () => {
  // На стоянке ракета стоит ровно и обычного размера: с ней в шапке сверяется
  // глаз, и накренённый знак читается как сбой.
  const resting = restingTransform({ x: 100, y: 50 }, { width: 14, height: 34 });
  assert.equal(resting, 'translate(93px, 33px) rotate(0deg)');
  assert.ok(!resting.includes('scale'));
});
