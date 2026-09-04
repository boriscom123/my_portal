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
  // Разделы лежат СОСЕДОМ меню, а не внутри него: содержимое закрытого details
  // браузер прячет сам, и вернуть его стилями на широком экране не выходит —
  // на этом настольная навигация и пропала.
  const menu = html.slice(html.indexOf('<details class="nav-menu"'), html.indexOf('</details>'));
  assert.ok(!menu.includes('<nav'), 'разделы снова внутри details — на широком экране они пропадут');
  assert.match(html, /<\/details>\s*<nav class="nav">/);

  const nav = html.slice(html.indexOf('<nav class="nav">'), html.indexOf('</nav>'));
  assert.match(nav, /href="\/search"/);
  assert.match(nav, /href="\/ideas"/);
  // Тема и уведомления уехали в раздел настроек: в шапке они были двумя
  // значками без подписей, и на телефоне их принимали за украшение.
  assert.match(nav, /href="\/settings"/);
  assert.ok(!nav.includes('data-theme-toggle'), 'переключатель темы остался в шапке');
});

test('на широком экране разделы стоят в строку, а кнопка меню спрятана', async () => {
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const wide = styles.slice(styles.indexOf('@media (min-width: 720px)'));
  // Видимостью распоряжаемся мы, соседним селектором: если правило исчезнет,
  // на ноутбуке снова останется одна кнопка с полосками вместо навигации.
  assert.match(wide, /\.nav-menu\[open\] \+ \.nav|\.nav-menu:not\(\[open\]\) \+ \.nav/);
  assert.match(wide, /\.nav-menu \{\s*display: none/);
});

test('выход оформлен как остальные пункты меню', () => {
  const html = layout({
    config,
    title: 'Т',
    description: 'о',
    body: '',
    user: { displayName: 'Автор', role: 'admin' }
  });
  // Кнопкой другого вида «Выйти» читалось бы как главное действие в меню,
  // хотя это последнее, что человек делает.
  assert.match(html, /<button class="nav-item" type="button" data-logout>/);
});



test('настройки открыты и гостю, но уведомления — вошедшим', async () => {
  const { settingsPage } = await import('../src/views/settings.js');
  const guest = settingsPage({ config, user: null });
  // Тема — настройка устройства, а не свойство учётной записи: закрывать её от
  // зрителя незачем.
  assert.match(guest, /data-theme-toggle/);
  assert.ok(!guest.includes('data-notifications'), 'гостю предложили уведомления');
  assert.match(guest, /href="\/login"/);

  const author = settingsPage({ config, user: { displayName: 'Автор', role: 'admin' } });
  assert.match(author, /data-notifications/);
  // Подключения площадок — дело автора и живут в кабинете.
  assert.match(author, /href="\/admin\/settings"/);

  const viewer = settingsPage({ config, user: { displayName: 'Зритель', role: 'user' } });
  assert.ok(!viewer.includes('/admin/settings'), 'зрителю показали подключения площадок');
});

test('летающий знак лежит отдельным слоем и не ловит нажатия', async () => {
  const html = layout({ config, title: 'Т', description: 'о', body: '' });
  // Слой отдельный, а не тот же узел, что в шапке: вырывать знак из разметки
  // шапки ради полёта значит ломать её вёрстку на время движения.
  assert.match(html, /<div class="rocket-flight" data-rocket hidden aria-hidden="true">/);
  // Ракета в шапке остаётся — это стоянка.
  assert.match(html, /<a class="logo"[\s\S]{0,200}class="rocket/);

  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const layer = styles.slice(styles.indexOf('.rocket-flight {'));
  // Иначе пролетающая ракета перехватывала бы нажатия у кнопок под собой.
  assert.match(layer.slice(0, 400), /pointer-events: none/);
  // Заказчик просил: ракета не должна скрываться прокруткой.
  assert.match(layer.slice(0, 400), /position: fixed/);
});

test('шапка закреплена, иначе ракете некуда лететь', async () => {
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  // Ракета летит к разделу навигации, а для этого раздел обязан оставаться на
  // экране при прокрутке.
  assert.match(styles, /\.site-header \{[\s\S]{0,200}position: sticky/);
});

test('кому движение мешает, тому его и не будет', async () => {
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  // Не вкусовщина: у части людей от движения на экране кружится голова.
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,200}\.rocket-flight[\s\S]{0,80}display: none/
  );
});

test('заглавная надпись — имя портала в три строки', async () => {
  const { hero } = await import('../src/views/hero.js');
  const markup = hero();

  // Раньше здесь стояло «Реальные приложения с ИИ, в одиночку»: фраза о
  // содержании, но не имя портала.
  assert.match(markup, /<h1 class="hero-name">/);
  assert.match(markup, /hero-brand brand-mark">SOLO AI</);
  assert.match(markup, /hero-journey">JOURNEY</);
  assert.match(markup, /hero-tagline">от идеи до продукта/);
  // Знак и JOURNEY — одно имя, разбитое надвое: заголовок один.
  assert.equal(markup.match(/<h1/g).length, 1);
});

test('надпись одна на все страницы, где она есть', async () => {
  const { feedPage } = await import('../src/views/feed.js');
  const { stubPage } = await import('../src/views/stub.js');
  const feed = feedPage({ config, lessons: [], news: [], user: null });
  const stub = stubPage(config, null);

  // Лежала двумя копиями в feed.js и stub.js, и они уже разошлись в мелочах.
  for (const html of [feed, stub]) {
    assert.match(html, /hero-brand brand-mark">SOLO AI</);
    assert.match(html, /hero-journey">JOURNEY</);
    assert.ok(!html.includes('в одиночку'), 'осталась старая надпись');
  }
});

test('строки надписи меряются шириной блока, а не окна', async () => {
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const block = styles.slice(styles.indexOf('.hero {'));
  // У блока есть предел ширины: от долей окна строки разъезжались бы на
  // широком мониторе, где блок уже не растёт.
  assert.match(block.slice(0, 300), /container-type: inline-size/);
  // Окно поиска щедрое: между селектором и размером живут пояснения, а
  // тест должен ловить пропажу единиц, а не длину комментария.
  for (const selector of ['hero-brand', 'hero-journey', 'hero-tagline']) {
    const rule = block.slice(block.indexOf(`.${selector} {`));
    assert.match(rule.slice(0, 600), /font-size: [\d.]+cqi/, selector);
  }
});

test('в заглавном блоке крутятся опубликованные уроки со ссылками', async () => {
  const { hero } = await import('../src/views/hero.js');
  const markup = hero({
    lessons: [
      { slug: 'pervyj', title: 'Первый урок', description: 'Ставим VPS. И дальше текст.', status: 'published' },
      { slug: 'vtoroj', title: 'Второй урок', description: '', status: 'published' },
      { slug: 'chernovik', title: 'Черновик', description: '', status: 'draft' }
    ]
  });

  assert.match(markup, /data-rotator/);
  assert.match(markup, /href="\/lesson\/pervyj"/);
  assert.match(markup, /href="\/lesson\/vtoroj"/);
  // Черновики сюда не попадают даже автору: заглавный блок — витрина, а не
  // рабочий стол.
  assert.ok(!markup.includes('chernovik'));
  // В описании берём первое предложение: абзац целиком в заглавный блок не
  // влезает.
  assert.match(markup, /Ставим VPS\.<\/span>/);
  assert.ok(!markup.includes('И дальше текст'));
});

test('без скрипта виден первый урок, а не пустое место', async () => {
  const { hero } = await import('../src/views/hero.js');
  const markup = hero({
    lessons: [
      { slug: 'a', title: 'А', status: 'published' },
      { slug: 'b', title: 'Б', status: 'published' }
    ]
  });
  // Первый помечен в разметке, а не выбирается на месте: иначе у пришедшего
  // без скрипта заглавный блок оказался бы пустым.
  assert.match(markup, /<li class="hero-item current">[\s\S]{0,120}href="\/lesson\/a"/);
  assert.equal(markup.match(/class="hero-item current"/g).length, 1);
});

test('пока уроков нет, вместо пустоты стоит текст', async () => {
  const { hero } = await import('../src/views/hero.js');
  const markup = hero({ lessons: [] });
  assert.ok(!markup.includes('data-rotator'));
  assert.match(markup, /hero-empty/);
  assert.match(markup, /Первый урок уже собирается/);
});

test('пересменка не копится при переходах между страницами', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  // Счётчик живёт между переходами: без остановки прошлого их копилось бы всё
  // больше, и уроки замелькали бы.
  assert.match(app, /clearInterval\(rotatorTimer\)/);
  assert.match(app, /function initPage\(\) \{\s*startRotator\(\);/);
});
