// Обвязка любой страницы портала: голова документа, теги для превью ссылок,
// шапка со знаком, подвал. Задача — держать всё это в одном месте: теги Open
// Graph нужны на каждой странице, ради них серверный рендер и существует, а
// разъехавшиеся шапки — первое, что бросается в глаза на учебном сайте.
// Вызывается из всех остальных файлов src/views/.
import { escapeHtml } from '../lib/html.js';
import { assetUrl } from '../lib/assets.js';

/**
 * Собирает полную страницу.
 * body вставляется как есть — это разметка, которую собрал вызывающий вид;
 * всё пользовательское он обязан прогнать через escapeHtml сам.
 */
export function layout({
  config,
  title,
  description,
  body,
  path = '/',
  image = null,
  user = null
}) {
  // Полный адрес страницы. Нужен дважды: поисковику — как канонический, чтобы
  // один урок не считался тремя страницами из-за меток в ссылках; мессенджеру —
  // в превью, где относительный адрес не разворачивается.
  const адресСтраницы = `${config.publicBaseUrl}${path}`;
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:site_name" content="Solo AI Journey">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${escapeHtml(адресСтраницы)}">
<link rel="canonical" href="${escapeHtml(адресСтраницы)}">
${image ? `<meta property="og:image" content="${escapeHtml(image)}">\n` : ''}<meta name="theme-color" content="#0c0a20">
<link rel="icon" href="/icons/icon-192.png">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/icon-180.png">
<link rel="stylesheet" href="${assetUrl('/styles.css')}">
</head>
<body>
<header class="шапка">
  <a class="лого" href="/">
    <img src="/icons/icon-192.png" alt="">
    <span class="написание">
      <span class="знак" style="font-size:16px">SOLO AI</span>
      <span class="journey">JOURNEY</span>
    </span>
  </a>
  <nav class="меню">
    <a href="/ideas">Идеи</a>
    ${
      user
        ? `<span class="имя" title="Вы вошли">${escapeHtml(user.displayName)}</span>
       <button class="тема" type="button" data-уведомления hidden
         title="Уведомления о новых уроках">🔔</button>
       <button class="кнопка" type="button" data-выход>Выйти</button>`
        : '<a class="кнопка-знак" href="/login">Войти</a>'
    }
    <button class="тема" type="button" data-тема title="Светлая или тёмная тема">◐</button>
  </nav>
</header>
<main>${body}</main>
<footer>
  <span>soloaijourney.online</span>
  <span class="подпись-бренда">от идеи до продукта</span>
</footer>
<script src="${assetUrl('/app.js')}" type="module"></script>
</body>
</html>`;
}
