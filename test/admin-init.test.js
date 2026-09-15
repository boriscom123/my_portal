// Скрипт кабинета привязывает обработчики к странице ровно один раз.
//
// При переходе без перезагрузки navigation.js импортирует admin.js — модуль при
// загрузке сам зовёт initPage — и тут же зовёт initPage ещё раз. Форма «Завести
// урок» получала два обработчика, и одно нажатие заводило два урока (заказчик
// 2026-09-15 увидел дубликат рядом с уроком, в который грузил запись).
import test from 'node:test';
import assert from 'node:assert/strict';

function fakeDocument() {
  const listeners = [];
  const form = {
    addEventListener: (type) => listeners.push(type),
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const main = { tagName: 'MAIN' };
  globalThis.document = {
    querySelector: (selector) =>
      selector === 'main' ? main : selector === '[data-new-lesson]' ? form : null,
    querySelectorAll: () => []
  };
  return { listeners };
}

test('повторный initPage на той же странице не вешает второй обработчик', async () => {
  const { listeners } = fakeDocument();
  const admin = await import('../public/admin.js');
  // Так делает navigation.js после подмены страницы.
  admin.initPage();
  assert.equal(listeners.filter((type) => type === 'submit').length, 1);
});
