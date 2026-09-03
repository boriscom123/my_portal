// Обвязка любой страницы портала: голова документа, теги для превью ссылок,
// шапка со знаком, подвал. Задача — держать всё это в одном месте: теги Open
// Graph нужны на каждой странице, ради них серверный рендер и существует, а
// разъехавшиеся шапки — первое, что бросается в глаза на учебном сайте.
// Вызывается из всех остальных файлов src/views/.
import { escapeHtml } from '../lib/html.js';
import { assetUrl } from '../lib/assets.js';
import { ракета } from './rocket.js';

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
<meta name="apple-mobile-web-app-title" content="Solo">
<link rel="apple-touch-icon" href="/icons/icon-180.png">
<link rel="stylesheet" href="${assetUrl('/styles.css')}">
</head>
<body>
<header class="site-header">
  <a class="logo" href="/">
    ${ракета({ height: 34, id: 'header' })}
    <span class="wordmark">
      <span class="brand-mark" style="font-size:16px">SOLO AI</span>
      <span class="wordmark-tail">JOURNEY</span>
    </span>
  </a>
  <nav class="nav">
    <a href="/ideas">Идеи</a>
    ${
      user
        ? `<span class="user-name" title="Вы вошли">${escapeHtml(user.displayName)}</span>
       <button class="theme-toggle" type="button" data-notifications hidden
         title="Уведомления о новых уроках">🔔</button>
       <button class="button" type="button" data-logout>Выйти</button>`
        : '<a class="button-brand" href="/login">Войти</a>'
    }
    <button class="theme-toggle" type="button" data-theme-toggle title="Светлая или тёмная тема">◐</button>
  </nav>
</header>
<main>${body}</main>
<footer>
  <span>soloaijourney.online</span>
  <span class="tagline">от идеи до продукта</span>
</footer>
<script src="${assetUrl('/app.js')}" type="module"></script>
</body>
</html>`;
}
