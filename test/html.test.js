// Проверка экранирования. Портал принимает тексты от людей и печатает их в
// HTML — без экранирования это готовая XSS, а комментарии здесь публичные.
import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../src/lib/html.js';
import { layout } from '../src/views/layout.js';

const config = { publicBaseUrl: 'https://soloaijourney.online' };

test('опасные символы превращаются в сущности', () => {
  assert.equal(
    escapeHtml('<script>alert("х")</script>'),
    '&lt;script&gt;alert(&quot;х&quot;)&lt;/script&gt;'
  );
});

test('кириллица не портится', () => {
  assert.equal(escapeHtml('Урок про Docker'), 'Урок про Docker');
});

test('пустое значение не даёт undefined в разметке', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('заголовок страницы экранируется, а разметка тела — нет', () => {
  const html = layout({ config, title: '<опасно>', description: 'описание', body: '<p>тело</p>' });
  assert.match(html, /<title>&lt;опасно&gt;<\/title>/);
  assert.match(html, /<p>тело<\/p>/);
  assert.match(html, /<html lang="ru">/);
});

test('гостю показывается вход, вошедшему — его имя', () => {
  const гость = layout({ config, title: 'Т', description: 'о', body: '' });
  assert.match(гость, /Войти/);
  const свой = layout({
    config,
    title: 'Т',
    description: 'о',
    body: '',
    user: { displayName: 'Пётр' }
  });
  assert.match(свой, /Пётр/);
  assert.ok(!свой.includes('>Войти<'));
});

test('цвет строки браузера задан для обеих тем', () => {
  const html = layout({ config, title: 'Т', description: 'о', body: '' });
  // Одно значение на обе темы красит строку браузера на телефоне не в тот
  // цвет — ровно та же болезнь, что давала белые полосы по краям страницы.
  assert.match(html, /theme-color" content="#f8f7fe" media="\(prefers-color-scheme: light\)"/);
  assert.match(html, /theme-color" content="#0c0a20" media="\(prefers-color-scheme: dark\)"/);
});

test('имя пользователя экранируется', () => {
  const html = layout({
    config,
    title: 'Т',
    description: 'о',
    body: '',
    user: { displayName: '<img src=x onerror=alert(1)>' }
  });
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /&lt;img/);
});
