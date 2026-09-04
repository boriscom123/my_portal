// Проверка экранирования. Портал принимает тексты от людей и печатает их в
// HTML — без экранирования это готовая XSS, а комментарии здесь публичные.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
  const guest = layout({ config, title: 'Т', description: 'о', body: '' });
  assert.match(guest, /Войти/);
  const mine = layout({
    config,
    title: 'Т',
    description: 'о',
    body: '',
    user: { displayName: 'Пётр' }
  });
  assert.match(mine, /Пётр/);
  assert.ok(!mine.includes('>Войти<'));
});

test('картинка превью отдаётся полным адресом', () => {
  // Мессенджеры и поисковики относительный адрес не разворачивают: превью
  // ссылки осталось бы без картинки.
  const html = layout({ config, title: 'Т', description: 'о', body: '', image: '/media/asset/4' });
  assert.match(html, /og:image" content="https:\/\/soloaijourney\.online\/media\/asset\/4"/);
});

test('значок вкладки — ракета без фона, с запасным растром', () => {
  const html = layout({ config, title: 'Т', description: 'о', body: '' });
  assert.match(html, /rel="icon" type="image\/svg\+xml" href="\/icons\/favicon\.svg"/);
  assert.match(html, /rel="icon" type="image\/png"[^>]*favicon-32\.png/);
});

test('у iPhone своё имя приложения — short_name он не читает', () => {
  const html = layout({ config, title: 'Solo AI Journey — портал видеоуроков', description: 'о', body: '' });
  assert.match(html, /apple-mobile-web-app-title" content="Solo"/);
});

test('канонический адрес собирается из адреса портала и пути', () => {
  const html = layout({ config, title: 'Т', description: 'о', body: '', path: '/login' });
  assert.match(html, /<link rel="canonical" href="https:\/\/soloaijourney\.online\/login">/);
  assert.match(html, /og:url" content="https:\/\/soloaijourney\.online\/login"/);
});

test('цвет строки браузера — одна метка, её правит скрипт', () => {
  const html = layout({ config, title: 'Т', description: 'о', body: '' });
  // Ровно одна метка: варианты с media часть версий Safari игнорирует и
  // красит бары белым. Фактическое значение проставляет public/app.js.
  assert.equal(html.match(/name="theme-color"/g).length, 1);
});

test('стили и скрипт помечены отпечатком содержимого', () => {
  const html = layout({ config, title: 'Т', description: 'о', body: '' });
  // Отпечаток меняется вместе с файлом: без него правка стилей доходит до
  // человека через час, когда истечёт кеш, — и выглядит как невыкаченная.
  assert.match(html, /styles\.css\?v=[0-9a-f]{8}/);
  assert.match(html, /app\.js\?v=[0-9a-f]{8}/);
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

test('разделы в шапке лежат в меню, работающем без скрипта', () => {
  const html = layout({ config, title: 'Т', description: 'о', body: '' });
  // details открывается сам: меню обязано работать, даже если app.js не
  // загрузился — иначе на телефоне пропадёт вся навигация разом.
  assert.match(html, /<details class="nav-menu" data-nav-menu>/);
  assert.match(html, /<summary class="nav-toggle"/);
  // Разделы внутри меню, а не рядом с ним.
  const menu = html.slice(html.indexOf('<details class="nav-menu"'), html.indexOf('</details>'));
  assert.match(menu, /href="\/search"/);
  assert.match(menu, /href="\/ideas"/);
  assert.match(menu, /data-theme-toggle/);
});

test('на широком экране меню разворачивается в строку', async () => {
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  // Без этого правила на ноутбуке вместо привычной строки разделов осталась бы
  // одна кнопка с тремя полосками.
  assert.match(styles, /@media \(min-width: 720px\)[\s\S]{0,400}\.nav-toggle \{\s*display: none/);
});
