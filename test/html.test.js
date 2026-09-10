// Проверка экранирования. Портал принимает тексты от людей и печатает их в
// HTML — без экранирования это готовая XSS, а комментарии здесь публичные.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { escapeHtml } from '../src/lib/html.js';
import { layout } from '../src/views/layout.js';
import { lessonPage } from '../src/views/lesson.js';
import { privacyPage, termsPage } from '../src/views/legal.js';

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
  assert.match(nav, /href="\/feedback"/);
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
  // Раздел для автора: уроки и загрузка. Подключений площадок пока нет — их
  // страница в плане этапа публикации, и ссылка на неё вела бы в пустоту.
  assert.match(author, /href="\/lessons"/);
  assert.match(author, /href="\/admin\/upload"/);

  const viewer = settingsPage({ config, user: { displayName: 'Зритель', role: 'user' } });
  assert.ok(!viewer.includes('/admin/'), 'зрителю показали разделы автора');
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

test('картинка не растягивает страницу шире экрана', async () => {
  // У обложки урока в разметке стоит width="1280": размер нужен браузеру, чтобы
  // не дёргать вёрстку, пока картинка грузится. Без общего правила он же
  // растягивал страницу на телефоне до 1280 точек, унося за край все блоки
  // урока, — заказчик увидел это на своём телефоне.
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const rule = styles.slice(styles.indexOf('\nimg {'));
  assert.match(rule.slice(0, 120), /max-width: 100%/);
  // Без height: auto остаётся высота из разметки, и картинка сплющивается.
  assert.match(rule.slice(0, 120), /height: auto/);
});

test('обложка урока показывается целиком: на ней написан сам урок', async () => {
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const rule = styles.slice(styles.indexOf('.lesson-cover {'));
  assert.ok(rule, 'правило обложки урока пропало');
  assert.match(rule.slice(0, 300), /object-fit: contain/);
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

test('подвал прижат к низу на короткой странице', async () => {
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const body = styles.slice(styles.indexOf('body {'), styles.indexOf('a {'));
  // Страница — колонка, середина растягивается: иначе на короткой странице
  // подвал «взлетал» и висел посреди экрана.
  assert.match(body, /display: flex/);
  assert.match(body, /flex-direction: column/);
  // dvh, а не только vh: на телефоне полоса браузера то появляется, то уходит,
  // и от vh под подвалом оставалась щель ровно в её высоту.
  assert.match(body, /min-height: 100dvh/);

  const main = styles.slice(styles.indexOf('main {'));
  assert.match(main.slice(0, 400), /flex: 1 0 auto/);
});

test('меню на телефоне висит под шапкой, а не поверх своей кнопки', async () => {
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const rule = styles.slice(styles.indexOf('.nav-menu[open] + .nav {'));
  // Пока список лежал внутри раскрывающегося элемента, его место было под
  // кнопкой. Вынесенный соседом, он встал вровень с ней и накрыл её собой:
  // нужна явная привязка к низу шапки.
  assert.match(rule.slice(0, 600), /top: 100%/);
});

test('меню закрывается при переходе без перезагрузки', async () => {
  const navigation = await readFile(new URL('../public/navigation.js', import.meta.url), 'utf8');
  // Раньше меню закрывала перезагрузка. Её больше нет, и список разделов
  // оставался висеть поверх новой страницы.
  assert.match(navigation, /\[data-nav-menu\]'\)\?\.removeAttribute\('open'\)/);
});

test('поля ввода не мельче шестнадцати точек на телефоне', async () => {
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  // Браузер на телефоне САМ увеличивает страницу, когда поле мельче, и обратно
  // уже не отдаляет. Половина полей наследовала кегль подписи в четырнадцать.
  const block = styles.slice(styles.indexOf('@media (max-width: 900px)'));
  assert.match(block, /input,\s*select,\s*textarea \{\s*font-size: max\(16px, 1em\)/);

  // Одного объявления мало, и этот тест уже однажды был зелёным при живой
  // поломке. Поля оформлены правилами вида «#review-form input { font:
  // inherit }» — вес идентификатора против веса имени тега, — и порог молча
  // проигрывал им на заголовке, описании и тегах. Держим important.
  assert.match(block, /font-size: max\(16px, 1em\) !important/);
});

test('карточка молчит про площадку, пока ролик не публичен', () => {
  // Приватный ролик чужому человеку не открывается: кнопка на карточке вела бы
  // зрителя в отказ площадки. Правило в виде уже есть — тест держит его на
  // месте: строка отбора короткая, снести её при правке соседней разметки легко,
  // а заметит это зритель, а не мы.
  const html = lessonPage({
    config,
    user: null,
    comments: [],
    lesson: {
      id: 1,
      slug: 'urok',
      title: 'Урок',
      description: '',
      tags: [],
      coverUrl: null,
      publishedAt: new Date(),
      publications: [
        { platform: 'youtube', state: 'ready', url: 'https://youtu.be/private-1' },
        { platform: 'rutube', state: 'published', url: 'https://rutube.ru/video/public-1' }
      ]
    }
  });
  assert.doesNotMatch(html, /private-1/, 'приватный ролик показывать нельзя');
  assert.match(html, /public-1/, 'а публичный — нужно');
});

test('поля ввода оформлены одним правилом на весь портал', async () => {
  // Оформление полей было написано шесть раз, под каждую форму по её
  // идентификатору, и седьмая форма — ключи площадки в настройках — осталась
  // голой: правило под неё забыли. Тест держит общее правило на месте, чтобы
  // следующая форма не повторила эту историю.
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const shared = styles.slice(styles.indexOf("input:not([type]),"));
  assert.match(shared.slice(0, 400), /select,\s*\ntextarea \{/, 'списки и многострочные поля — в том же правиле');
  assert.match(shared.slice(0, 400), /border: 1px solid var\(--line\)/);
  assert.match(shared.slice(0, 400), /min-height: var\(--tap-target\)/);

  // Подпись над полем: без этого правила подписи встают в строку со всеми
  // соседями — так голая форма настроек и выглядела.
  assert.match(styles, /form label \{\s*\n\s*display: flex;\s*\n\s*flex-direction: column;/);
});

test('политика и условия открываются и говорят по существу', () => {
  // По этим ссылкам ходит проверяющий робот Google: приложение, просящее доступ
  // к чужому каналу YouTube, обязано их показать. Пустая или недоступная
  // страница означает отказ в переводе приложения в рабочий режим.
  const privacy = privacyPage({ config, user: null });
  assert.match(privacy, /Политика конфиденциальности/);
  // Три обещания, которые портал правда выполняет: почты в базе нет, следящих
  // счётчиков нет, доступ к каналу — только на загрузку своего.
  assert.match(privacy, /Почтового адреса портал не хранит/);
  assert.match(privacy, /счётчиков на страницах нет/);
  assert.match(privacy, /не удаляет и не меняет уже опубликованное/);

  const terms = termsPage({ config, user: null });
  assert.match(terms, /Условия использования/);
  assert.match(terms, /как есть/);
});

test('правовые ссылки стоят в подвале каждой страницы', () => {
  // Google требует их и проверяет, а посетитель ищет их именно в подвале.
  const html = layout({ config, path: '/', title: 'Портал', description: '', body: '<p>тело</p>' });
  assert.match(html, /href="\/privacy"/);
  assert.match(html, /href="\/terms"/);
});

test('в ленте у карточки есть ссылки на площадки — и только на вышедшее', async () => {
  // Заказчик ищет их именно тут: на главной, не заходя в урок.
  const { feedPage } = await import('../src/views/feed.js');
  const html = feedPage({
    config,
    user: null,
    news: [],
    lessons: [
      {
        id: 1,
        slug: 'urok',
        title: 'Урок',
        description: 'Описание',
        tags: [],
        coverUrl: null,
        publishedAt: new Date(),
        publications: [
          { platform: 'youtube', state: 'published', url: 'https://youtu.be/vyshel' },
          { platform: 'max', state: 'published', url: 'https://max.ru/kanal' },
          { platform: 'rutube', state: 'ready', url: 'https://rutube.ru/nevyshel' }
        ]
      }
    ]
  });

  assert.match(html, /youtu\.be\/vyshel/);
  assert.match(html, /max\.ru\/kanal/, 'MAX ведёт на канал: своего адреса у поста нет');
  assert.doesNotMatch(html, /nevyshel/, 'невышедшее показывать нельзя');
  assert.match(html, /MAX/);
});

test('урок без публикаций в ленте не ломается', async () => {
  const { feedPage } = await import('../src/views/feed.js');
  const html = feedPage({
    config,
    user: null,
    news: [],
    lessons: [
      {
        id: 1,
        slug: 'urok',
        title: 'Урок',
        description: '',
        tags: [],
        coverUrl: null,
        publishedAt: new Date()
      }
    ]
  });
  assert.match(html, /Урок/);
  assert.doesNotMatch(html, /Смотреть:/);
});

test('ссылки площадок переливаются тем же градиентом, что знак', async () => {
  // Заказчик попросил живые буквы, как у заглавной надписи. Общий градиент —
  // не лень, а решение: одна анимация на странице читается как одна вещь, а две
  // с разной скоростью — как две спорящие.
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.brand-mark,\s*\n\.button-brand,\s*\n\.platform-link \{/);
  assert.match(styles, /\.brand-mark,\s*\n\.platform-link \{\s*\n\s*-webkit-background-clip: text;/);

  // Отключённую анимацию уважаем тем же списком, что и остальные живые части.
  const reduced = styles.slice(styles.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced.slice(0, 300), /\.platform-link,/);

  // Подчёркивания нет: общее правило для ссылок подчёркивает их при наведении,
  // и вместе с собственной чертой выходило две линии сразу.
  assert.match(styles, /\.platform-link:hover,\s*\n\.platform-link:focus-visible \{\s*\n\s*text-decoration: none;/);
  assert.doesNotMatch(styles, /\.platform-link \{[^}]*border-bottom/);
});

test('полоска про файлы браузера есть, скрыта и говорит правду', () => {
  const html = layout({ config, path: '/', title: 'Портал', description: '', body: '<p>тело</p>' });

  // Скрыта разметкой: вернувшийся зритель не должен видеть её мельканием на
  // каждой странице, пока скрипт не решит, показывать ли.
  assert.match(html, /data-cookie-note hidden/);
  assert.match(html, /data-cookie-ok/);

  // Текст обязан совпадать с тем, что портал правда делает: одна кука после
  // входа и выбор темы. Счётчиков нет — проверено по разметке.
  assert.match(html, /Счётчиков и рекламных файлов здесь нет/);
  assert.match(html, /href="\/privacy"/);
});

test('атрибут hidden прячет, что бы ни говорило оформление', async () => {
  // Полоска про файлы браузера висела постоянно: у неё display: flex, а он
  // сильнее умолчания браузера для hidden. Кнопка «Понятно» при этом честно
  // ставила hidden, который ничего не менял. Правило общее, потому что таких
  // элементов на портале несколько: кнопка уведомлений, поле выбора файла.
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\[hidden\] \{\s*\n\s*display: none !important;\s*\n\}/);
});

test('полоска про куки прижата к краям, а не ужимается по содержимому', async () => {
  // На узком экране центрирование сдвигом превращало её в столбик посреди
  // экрана: элемент с position: fixed сжимается по содержимому, и текст с
  // основой в 18rem вставал колонкой. Заказчик прислал снимок.
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const block = styles.slice(styles.indexOf('.cookie-note {'), styles.indexOf('.cookie-note p'));
  assert.match(block, /left: 12px;/);
  assert.match(block, /right: 12px;/);
  assert.match(block, /margin: 0 auto;/);
  assert.doesNotMatch(block, /transform: translateX/);
});

test('на главной уроки и новости идут одной лентой по дате', async () => {
  const { feedPage } = await import('../src/views/feed.js');
  const html = feedPage({
    config,
    user: null,
    lessons: [
      {
        id: 1,
        slug: 'staryi',
        title: 'Старый урок',
        description: '',
        tags: [],
        coverUrl: null,
        publishedAt: new Date('2026-09-01'),
        publications: []
      }
    ],
    news: [
      {
        id: 1,
        slug: 'svezhaya',
        title: 'Свежая новость',
        body: 'Коротко о деле',
        images: [],
        publishedAt: new Date('2026-09-08')
      }
    ]
  });

  // Свежая новость должна стоять выше старого урока: лента одна и общая, иначе
  // уроки, которые снимаются неделями, вытеснили бы всё остальное вниз.
  assert.ok(html.indexOf('Свежая новость') < html.indexOf('Старый урок'));
  // И новость обязана отличаться от урока: без пометки лента читается как
  // сломанная — часть карточек открывает видео, часть текст.
  assert.match(html, /badge">новость</);
  assert.match(html, /href="\/news\/svezhaya"/);
});

test('урок из заглавного блока не повторяется карточкой ниже', async () => {
  // Один и тот же урок выводился дважды: сверху текстом в заглавном блоке,
  // сразу под ним — карточкой с обложкой. Заказчик увидел это первым.
  const { feedPage } = await import('../src/views/feed.js');
  const lesson = {
    id: 1,
    slug: 'urok',
    title: 'Урок про портал',
    description: 'Описание',
    tags: [],
    coverUrl: null,
    status: 'published',
    publishedAt: new Date('2026-09-08'),
    publications: []
  };

  const html = feedPage({ config, user: null, lessons: [lesson], news: [] });
  const first = html.indexOf('Урок про портал');
  assert.ok(first > -1, 'урок должен быть на странице');
  assert.equal(html.indexOf('Урок про портал', first + 1), -1, 'но ровно один раз');
});

test('на странице тега заглавного блока нет, и уроки не пропадают', async () => {
  // Там свой заголовок вместо заглавного блока — значит прятать из ленты
  // нечего, и все уроки по теме обязаны остаться видны.
  const { feedPage } = await import('../src/views/feed.js');
  const html = feedPage({
    config,
    user: null,
    tag: 'docker',
    news: [],
    lessons: [
      {
        id: 1,
        slug: 'urok',
        title: 'Урок про докер',
        description: '',
        tags: ['docker'],
        coverUrl: null,
        status: 'published',
        publishedAt: new Date(),
        publications: []
      }
    ]
  });
  assert.match(html, /Урок про докер/);
});

test('заглавный блок называет портал и не повторяет ленту', async () => {
  // Раньше здесь сменялись уроки, и те же уроки шли карточками ниже: один урок
  // выводился дважды. Заказчик выбрал оставить карточки, а из заголовка уроки
  // убрать — лента по дате читается как одна история.
  const { hero } = await import('../src/views/hero.js');
  const html = hero();
  assert.match(html, /SOLO AI/);
  assert.match(html, /от идеи до продукта/);
  assert.doesNotMatch(html, /data-rotator/, 'пересменки уроков здесь больше нет');
});

test('из подвала ведут ссылки на код и на переписку по дням', () => {
  // Заказчик просил: любой читатель должен суметь открыть историю того, как
  // портал делался. Она лежит в открытом репозитории рядом с кодом каждого дня.
  const html = layout({
    config: { ...config, repoUrl: 'https://github.com/kto-to/portal' },
    title: 'Т',
    description: 'о',
    path: '/',
    body: ''
  });
  assert.match(html, /href="https:\/\/github\.com\/kto-to\/portal\/tree\/main\/docs\/history"/);
  assert.match(html, /Как это делалось/);
  assert.match(html, /href="https:\/\/github\.com\/kto-to\/portal"[^>]*>Исходный код/);
});

test('без адреса репозитория подвал остаётся целым', () => {
  // Портал должен подниматься и без этой настройки: ссылка — украшение, а не
  // условие работы.
  const html = layout({ config, title: 'Т', description: 'о', path: '/', body: '' });
  assert.doesNotMatch(html, /Как это делалось/);
  assert.match(html, /href="\/privacy"/);
});
