// Приложение с домашнего экрана: нажатие в поле не должно увеличивать страницу.
//
// Заказчик 2026-09-16 открыл портал как приложение на iPhone, нажал в поле
// «Запрос для рисования» — Safari увеличил страницу, а вернуть масштаб нечем:
// панели браузера в приложении нет, и страница ездит из стороны в сторону.
// В обычной вкладке масштаб не трогаем: там увеличение — право человека.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lockZoomInApp } from '../public/ui.js';

function fakeDocument(content = 'width=device-width, initial-scale=1') {
  const meta = {
    content,
    getAttribute: () => meta.content,
    setAttribute: (name, value) => {
      meta.content = value;
    }
  };
  return { meta, querySelector: (selector) => (selector.includes('viewport') ? meta : null) };
}

test('в приложении с домашнего экрана масштаб заперт, во вкладке — нет', () => {
  const app = fakeDocument();
  lockZoomInApp(app, true);
  assert.match(app.meta.content, /maximum-scale=1/);
  assert.match(app.meta.content, /width=device-width/, 'остальная часть остаётся');

  const tab = fakeDocument();
  lockZoomInApp(tab, false);
  assert.equal(tab.meta.content, 'width=device-width, initial-scale=1');

  // Второй вызов ничего не удваивает: страницы подменяются переходами.
  const twice = fakeDocument();
  lockZoomInApp(twice, true);
  lockZoomInApp(twice, true);
  assert.equal(twice.meta.content.match(/maximum-scale=1/g).length, 1);

  // Нет разметки с viewport — не падаем.
  assert.doesNotThrow(() => lockZoomInApp({ querySelector: () => null }, true));
});
