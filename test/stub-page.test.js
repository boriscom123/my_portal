// Проверка заглушки. Спека обещает её уже на этапе 0: адрес открыт, а
// смотреть нечего — это выглядит как сломанный сайт, а не как каркас.
// Показывается, пока в базе нет ни одного урока; дальше её место занимает
// лента. Вид проверяется напрямую: через HTTP тот же маршрут уже закрыт
// тестами в pages.test.js и home-session.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stubPage } from '../src/views/stub.js';
import { version } from '../src/version.js';

const config = { publicBaseUrl: 'https://soloaijourney.online' };

test('заглушка — это цельная страница со знаком проекта', () => {
  const html = stubPage(config);
  assert.match(html, /<html lang="ru">/);
  assert.match(html, /Solo AI Journey/);
  assert.match(html, /styles\.css/);
});

test('фирменное написание набрано живым градиентом', () => {
  // Класс «знак» несёт градиент и его анимацию: без него написание
  // отрисуется прозрачным и пропадёт со страницы.
  assert.match(stubPage(config), /class="знак"/);
});

test('на странице виден номер версии — по нему видно, что выкатилось', () => {
  assert.match(stubPage(config), new RegExp(version.replace(/\./g, '\\.')));
});

test('гостю показывается вход, вошедшему — нет', () => {
  assert.match(stubPage(config), />Войти</);
  const свой = stubPage(config, { displayName: 'Борис' });
  assert.match(свой, /Борис/);
  assert.ok(!свой.includes('>Войти<'));
});
