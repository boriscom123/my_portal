// Хлебные крошки: «Главная › Раздел › Страница» над заголовком.
//
// Задача — дать вернуться на уровень выше с любой страницы. Крошки идут по
// устройству сайта, а не по истории браузера: работают и у того, кто открыл
// страницу по ссылке из Telegram, где «назад» уводит из браузера вовсе.
// Раньше вместо них стояли стрелки-ссылки «назад к разделу» — вразнобой, а на
// странице урока и новости их не было совсем.
// Вызывается из src/views/layout.js; цепочку передаёт каждая страница.
import { escapeHtml } from '../lib/html.js';

/**
 * Разметка крошек. items — пункты после «Главной»: { title, href? }.
 * Последний пункт — текущая страница: без ссылки и с aria-current, чтобы
 * чтец экрана назвал его «текущая страница». Пусто — пустая строка, а не
 * пустая полоса над заголовком.
 */
export function breadcrumbsHtml(items) {
  if (!items?.length) return '';
  const all = [{ title: 'Главная', href: '/' }, ...items];
  return `<nav class="breadcrumbs" aria-label="Навигация по сайту"><ol>${all
    .map((item, index) =>
      index === all.length - 1
        ? `<li><span aria-current="page">${escapeHtml(item.title)}</span></li>`
        : `<li><a href="${escapeHtml(item.href)}">${escapeHtml(item.title)}</a></li>`
    )
    .join('')}</ol></nav>`;
}
