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
  flightKeyframes,
  restingTransform
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

test('в середине пути ракета крупнее, по краям обычная', async () => {
  const { flightKeyframes } = await import('../public/rocket-flight.js');
  const frames = flightKeyframes({ x: 0, y: 0 }, { x: 400, y: 0 }, {
    size: { width: 14, height: 34 }
  });

  // Три кадра, а не два: плавным переходом наплыв к середине не сделать —
  // переход умеет только начало и конец.
  assert.equal(frames.length, 3);
  assert.deepEqual(frames.map((f) => f.offset), [0, 0.5, 1]);
  assert.match(frames[0].transform, /scale\(1\)/);
  assert.match(frames[2].transform, /scale\(1\)/);
  // К середине ракета словно выходит на орбиту и проходит ближе к смотрящему.
  const peak = Number(frames[1].transform.match(/scale\(([\d.]+)\)/)[1]);
  assert.ok(peak > 1.4, `в середине вышло ${peak}`);
});

test('середина кадров — это середина пути', () => {
  const frames = flightKeyframes({ x: 0, y: 0 }, { x: 400, y: 200 }, {
    size: { width: 10, height: 10 }
  });
  // Иначе наплыв случался бы не там, где летит ракета, и выглядел бы рывком.
  assert.match(frames[1].transform, /translate\(195px, 95px\)/);
});

test('угол один на весь перелёт', () => {
  const frames = flightKeyframes({ x: 0, y: 0 }, { x: 0, y: 300 }, {
    size: { width: 10, height: 10 }
  });
  // Ракета летит по прямой и уже смотрит носом на цель: доворачивать в пути
  // незачем.
  const angles = frames.map((f) => f.transform.match(/rotate\((-?[\d.]+)deg\)/)[1]);
  assert.equal(new Set(angles).size, 1, `углы разошлись: ${angles}`);
  assert.equal(Math.abs(Number(angles[0])), 180, 'вниз');
});

test('полёт стал впятеро медленнее', () => {
  // Заказчик попросил именно «примерно в пять раз»: до этого движение
  // читалось как рывок, за ним не успевал глаз.
  const short = flightMs({ x: 0, y: 0 }, { x: 10, y: 0 });
  const long = flightMs({ x: 0, y: 0 }, { x: 1900, y: 900 });
  assert.ok(short >= 1200, `короткий перелёт ${short} мс — всё ещё рывок`);
  assert.ok(long >= 5000, `дальний перелёт ${long} мс`);
});

test('стоянка задаётся без наплыва и без поворота', () => {
  // На стоянке ракета стоит ровно и обычного размера: с ней в шапке сверяется
  // глаз, и накренённый знак читается как сбой.
  const resting = restingTransform({ x: 100, y: 50 }, { width: 14, height: 34 });
  assert.equal(resting, 'translate(93px, 33px) rotate(0deg)');
  assert.ok(!resting.includes('scale'));
});
