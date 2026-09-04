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
  flightTarget
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
  assert.ok(near >= 260, `вышло ${near} мс`);
  assert.ok(far <= 1400, `вышло ${far} мс`);
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
