// Раздел «Новости»: список и страница одной новости.
//
// Задача — показать новости всем, а автору дать их писать прямо здесь.
// Отдельной админской страницы у новостей нет намеренно: она отличалась бы от
// публичной только кнопками, а две почти одинаковые страницы однажды разойдутся.
// Подключается из src/routes/pages.js.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';

/** Дата человеку: «8 сентября 2026». */
function formatDate(value) {
  return new Date(value).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

/**
 * Картинки новости.
 * Одна — просто картинка. Несколько — лента с прокруткой по одной: слайдер на
 * скриптах здесь лишний, браузер умеет это сам, и оно работает даже когда
 * скрипты не загрузились.
 */
export function newsImages(images = []) {
  if (!images.length) return '';
  if (images.length === 1) {
    return `<img class="news-image" src="${escapeHtml(images[0].url)}" alt="" loading="lazy">`;
  }
  return `<div class="news-slider">${images
    .map(
      (image) =>
        `<img class="news-image" src="${escapeHtml(image.url)}" alt="" loading="lazy">`
    )
    .join('')}</div>`;
}

/** Заготовка новости: текстом, как её пишет автор. */
function newsForm(item = null) {
  return `<form class="card" data-news-form="${escapeHtml(item?.slug ?? '')}">
  <h2>${item ? 'Правка новости' : 'Новая новость'}</h2>
  <label>Заголовок
    <input name="title" value="${escapeHtml(item?.title ?? '')}" maxlength="200" required>
  </label>
  <label>Текст
    <textarea name="body" rows="6" maxlength="4000">${escapeHtml(item?.body ?? '')}</textarea>
  </label>
  <p class="hint">
    Ссылки пишите прямо в тексте — портал сделает их кликабельными. Картинки
    добавляются после сохранения, на странице самой новости.
  </p>
  <!-- Сюда скрипт кладёт список свежих анонсов. Пустой и скрытый: пока автор
       не попросил, чужие ленты никто не спрашивает. -->
  <div class="announcements" data-announcements-list hidden></div>
  <div class="form-row">
    <button class="button" type="button" data-announcements>Свежие анонсы</button>
    <button class="button" type="button" data-news-suggest>Написать по заголовку</button>
    <button class="button-brand" type="submit">${item ? 'Сохранить' : 'Завести новость'}</button>
    ${
      item
        ? `<button class="button" type="button" data-news-delete="${escapeHtml(item.slug)}">Удалить</button>`
        : ''
    }
  </div>
</form>`;
}

/** Список новостей. */
export function newsListPage({ config, user, news }) {
  const isAdmin = user?.role === 'admin';
  return layout({
    config,
    user,
    path: '/news',
    title: 'Новости — Solo AI Journey',
    description: 'Что нового на портале: анонсы, итоги и заметки между уроками.',
    body: `
<h1>Новости${
      isAdmin
        ? ` <a class="add" href="/news/new" title="Написать новость" aria-label="Написать новость">+</a>`
        : ''
    }</h1>

${
  news.length
    ? news
        .map(
          (item) => `<article class="card news-card">
  <p class="meta">${escapeHtml(formatDate(item.publishedAt))}</p>
  <h2><a href="/news/${encodeURIComponent(item.slug)}">${escapeHtml(item.title)}</a>${
            isAdmin
              ? ` <a class="edit" href="/news/${encodeURIComponent(item.slug)}/edit"
                   title="Править новость" aria-label="Править новость">✎</a>`
              : ''
          }</h2>
  ${newsImages(item.images.slice(0, 1))}
  <p class="card-text">${escapeHtml(item.body).slice(0, 400)}</p>
</article>`
        )
        .join('')
    : '<p class="hint">Новостей пока нет.</p>'
}`
  });
}

/** Страница одной новости. */
export function newsPage({ config, user, item }) {
  const isAdmin = user?.role === 'admin';
  return layout({
    config,
    user,
    path: `/news/${item.slug}`,
    title: `${item.title} — Solo AI Journey`,
    description: item.body.slice(0, 160),
    body: `
<article class="card">
  <p class="meta">${escapeHtml(formatDate(item.publishedAt))}</p>
  <h1>${escapeHtml(item.title)}</h1>
  ${newsImages(item.images)}
  <div class="news-body">${linkify(item.body)}</div>
</article>

${
  isAdmin
    ? `<p class="form-row">
         <a class="button" href="/news/${encodeURIComponent(item.slug)}/edit">Править новость</a>
       </p>`
    : ''
}`
  });
}

/**
 * Делает ссылки в тексте кликабельными.
 * Текст новости пишется человеком и печатается в HTML — сначала экранируем всё,
 * и только потом превращаем в ссылки то, что осталось адресом. Обратный порядок
 * означал бы, что чужая разметка попадёт на страницу.
 */
export function linkify(text) {
  return escapeHtml(String(text ?? ''))
    .split('\n')
    .map((line) =>
      line.replace(
        /(https?:\/\/[^\s<]+)/g,
        (url) => `<a href="${url}" rel="noopener" target="_blank">${url}</a>`
      )
    )
    .join('<br>');
}

/** Страница создания и правки новости. */
export function newsEditPage({ config, user, item = null }) {
  return layout({
    config,
    user,
    path: item ? `/news/${item.slug}/edit` : '/news/new',
    title: item ? `Правка новости — Solo AI Journey` : 'Новая новость — Solo AI Journey',
    description: 'Написать или поправить новость портала.',
    body: `
<p><a href="/news">← Новости</a></p>
<h1>${item ? 'Правка новости' : 'Новая новость'}</h1>

${newsForm(item)}

${
  item
    ? `<section class="card">
  <h2>Картинки</h2>
  <p class="hint">
    Одна показывается как есть, несколько — лентой с прокруткой. Порядок — тот,
    в каком вы их загружали.
  </p>
  ${newsImages(item.images)}
  <p class="form-row">
    <label class="button" for="news-image">Добавить картинку</label>
    <input id="news-image" type="file" accept="image/png,image/jpeg,image/webp" hidden
      data-news-image="${escapeHtml(item.slug)}">
  </p>
</section>`
    : '<p class="hint">Картинки добавляются после сохранения — на этой же странице.</p>'
}`
  });
}
