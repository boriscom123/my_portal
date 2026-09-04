// Переходы без перезагрузки. Проверяется решение «брать этот переход на себя
// или отдать браузеру» — в нём легко забыть случай, и забытый ломается тихо:
// человек нажимает «открыть в новой вкладке», а вкладка не открывается.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldHandle } from '../public/navigation.js';

const here = new URL('https://soloaijourney.online/lesson/urok');

/** Ссылка как её видит браузер: href уже приведён к полному виду. */
function link(href, extra = {}) {
  const url = new URL(href, here);
  return {
    href: url.href,
    target: '',
    hasAttribute: (name) => name in (extra.attributes ?? {}),
    dataset: extra.dataset ?? {},
    ...extra
  };
}

const plainClick = { button: 0, defaultPrevented: false };

test('обычное нажатие по своей ссылке берём на себя', () => {
  assert.ok(shouldHandle(link('/ideas'), plainClick, here));
  assert.ok(shouldHandle(link('/admin/lessons'), plainClick, here));
});

test('нажатие с клавишей отдаём браузеру', () => {
  // Человек просит новую вкладку или сохранение — мешать ему нельзя.
  for (const key of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
    assert.ok(!shouldHandle(link('/ideas'), { ...plainClick, [key]: true }, here), key);
  }
  assert.ok(!shouldHandle(link('/ideas'), { ...plainClick, button: 1 }, here), 'средняя кнопка');
});

test('чужой сайт и новая вкладка — не наше дело', () => {
  assert.ok(!shouldHandle(link('https://youtube.com/watch'), plainClick, here));
  assert.ok(!shouldHandle(link('/ideas', { target: '_blank' }), plainClick, here));
});

test('скачивание и файлы буфера отдаём браузеру', () => {
  // Их он умеет показывать и сохранять сам, а подменять ими содержимое
  // страницы бессмысленно.
  assert.ok(!shouldHandle(link('/ideas', { attributes: { download: '' } }), plainClick, here));
  assert.ok(!shouldHandle(link('/media/asset/4'), plainClick, here));
  assert.ok(!shouldHandle(link('/icons/icon-192.png'), plainClick, here));
});

test('якорь на этой же странице — это прокрутка, а не переход', () => {
  assert.ok(!shouldHandle(link('/lesson/urok#comments'), plainClick, here));
  // А якорь на другой странице — обычный переход.
  assert.ok(shouldHandle(link('/lesson/drugoj#comments'), plainClick, here));
});

test('явная просьба перезагрузить страницу уважается', () => {
  // Пригодится там, где подмена содержимого не годится: смена входа, выход.
  assert.ok(!shouldHandle(link('/', { dataset: { fullLoad: '' } }), plainClick, here));
});

test('уже обработанное нажатие второй раз не обрабатываем', () => {
  assert.ok(!shouldHandle(link('/ideas'), { ...plainClick, defaultPrevented: true }, here));
  assert.ok(!shouldHandle(null, plainClick, here));
});
