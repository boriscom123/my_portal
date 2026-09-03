// Проверка знака. Он рисуется кодом и попадает и на сайт, и в иконку —
// ошибка здесь видна сразу везде.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rocket } from '../src/views/rocket.js';

test('ракета состоит из названных частей', () => {
  const svg = rocket();
  for (const part of ['rocket-nose', 'rocket-body', 'rocket-fin', 'rocket-flame']) {
    assert.ok(svg.includes(part), `нет части ${part}`);
  }
  // Два крыла, а не одно.
  assert.equal(svg.match(/rocket-fin/g).length, 2);
});

test('пропорции сохраняются при любой высоте', () => {
  const svg = rocket({ height: 116 });
  assert.match(svg, /width="48" height="116"/);
  assert.match(rocket({ height: 58 }), /width="24" height="58"/);
});

test('идентификаторы градиентов разводятся приставкой', () => {
  // Два знака на одной странице с одинаковыми id склеились бы в один
  // градиент, и второй перекрасился бы вслед за первым.
  const first = rocket({ id: 'header' });
  const second = rocket({ id: 'footer' });
  assert.match(first, /id="header-flame"/);
  assert.match(second, /id="footer-flame"/);
  assert.ok(!second.includes('header-'));
});

test('на иконке пламя не анимируется', () => {
  assert.ok(!rocket({ animated: false }).includes('animated'));
  assert.match(rocket({ animated: true }), /class="rocket animated"/);
});

test('у знака есть словесное описание для чтения с экрана', () => {
  assert.match(rocket(), /role="img"/);
  assert.match(rocket(), /aria-label="[^"]+"/);
});
