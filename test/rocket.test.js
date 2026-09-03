// Проверка знака. Он рисуется кодом и попадает и на сайт, и в иконку —
// ошибка здесь видна сразу везде.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ракета } from '../src/views/rocket.js';

test('ракета состоит из названных частей', () => {
  const svg = ракета();
  for (const часть of ['rocket-nose', 'rocket-body', 'rocket-fin', 'rocket-flame']) {
    assert.ok(svg.includes(часть), `нет части ${часть}`);
  }
  // Два крыла, а не одно.
  assert.equal(svg.match(/rocket-fin/g).length, 2);
});

test('пропорции сохраняются при любой высоте', () => {
  const svg = ракета({ height: 116 });
  assert.match(svg, /width="48" height="116"/);
  assert.match(ракета({ height: 58 }), /width="24" height="58"/);
});

test('идентификаторы градиентов разводятся приставкой', () => {
  // Два знака на одной странице с одинаковыми id склеились бы в один
  // градиент, и второй перекрасился бы вслед за первым.
  const первый = ракета({ id: 'header' });
  const второй = ракета({ id: 'footer' });
  assert.match(первый, /id="header-flame"/);
  assert.match(второй, /id="footer-flame"/);
  assert.ok(!второй.includes('header-'));
});

test('на иконке пламя не анимируется', () => {
  assert.ok(!ракета({ живое: false }).includes('animated'));
  assert.match(ракета({ живое: true }), /class="rocket animated"/);
});

test('у знака есть словесное описание для чтения с экрана', () => {
  assert.match(ракета(), /role="img"/);
  assert.match(ракета(), /aria-label="[^"]+"/);
});
