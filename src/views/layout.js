// Обвязка любой страницы портала: голова документа, теги для превью ссылок,
// шапка со знаком, подвал. Задача — держать всё это в одном месте: теги Open
// Graph нужны на каждой странице, ради них серверный рендер и существует, а
// разъехавшиеся шапки — первое, что бросается в глаза на учебном сайте.
// Вызывается из всех остальных файлов src/views/.
import { escapeHtml } from '../lib/html.js';

/**
 * Собирает полную страницу.
 * body вставляется как есть — это разметка, которую собрал вызывающий вид;
 * всё пользовательское он обязан прогнать через escapeHtml сам.
 */
export function layout({ config, title, description, body, image = null, user = null }) {
  const адрес = config.publicBaseUrl;
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
${image ? `<meta property="og:image" content="${escapeHtml(image)}">\n` : ''}<meta name="theme-color" content="#0c0a20">
<link rel="icon" href="/icons/icon-192.png">
<link rel="manifest" href="${escapeHtml(адрес)}/manifest.webmanifest">
<link rel="stylesheet" href="/styles.css">
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
        ? `<span title="Вы вошли">${escapeHtml(user.displayName)}</span>`
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
<script src="/app.js" type="module"></script>
</body>
</html>`;
}
