// Страница результатов поиска.
//
// Задача — показать, в каком уроке и на какой секунде нашлось слово. Своего
// плеера у портала нет: зритель смотрит на площадке, поэтому время находки
// написано словами, а не спрятано в ссылку — по нему человек перематывает сам.
// Вызывается из src/routes/pages.js по адресу /search.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';

/** Время находки человеку: 12:05, а не 725000 миллисекунд. */
export function timeLabel(ms) {
  const total = Math.floor(ms / 1000);
  const parts = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  return parts
    .slice(parts[0] ? 0 : 1)
    .map((value, index) => (index ? String(value).padStart(2, '0') : String(value)))
    .join(':');
}

function resultItem(item) {
  const seconds = Math.floor(item.startedMs / 1000);
  return `<li class="search-result">
  <a href="/lesson/${encodeURIComponent(item.lessonSlug)}#t=${seconds}">
    ${escapeHtml(item.lessonTitle)}
    <span class="meta">на ${escapeHtml(timeLabel(item.startedMs))}</span>
  </a>
  <p class="excerpt">${item.excerpt}</p>
</li>`;
}

export function searchPage({ config, user, query, results }) {
  return layout({
    config,
    user,
    path: '/search',
    title: query ? `Поиск: ${query} — Solo AI Journey` : 'Поиск — Solo AI Journey',
    description: 'Поиск по словам внутри уроков: находка ведёт на нужную минуту.',
    body: `
<h1>Поиск по урокам</h1>
<p class="hint">
  Ищем по расшифровке: слово находится внутри урока, а не только в заголовке.
</p>

<form class="card" action="/search" method="get">
  <div class="form-row">
    <input name="q" value="${escapeHtml(query)}" placeholder="слово из урока"
           autofocus required maxlength="100">
    <button class="button-brand" type="submit">Найти</button>
  </div>
</form>

${
  query && !results.length
    ? '<p class="hint">Ничего не нашлось. Попробуйте другое слово.</p>'
    : ''
}
${
  results.length
    ? `<ul class="search-results">${results.map(resultItem).join('')}</ul>`
    : ''
}`
  });
}
