// Раздел «Короткие ролики»: список, страница ролика, страница правки.
//
// Устроен как «Новости» намеренно: у автора одно и то же дело — написать,
// посмотреть, выпустить, отправить в каналы, — и два разных устройства для
// одного дела заставляли бы вспоминать, где что лежит.
// Подключается из src/routes/pages.js.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';
import { publicationLabel } from './publication-state.js';

/** Дата человеку: «10 сентября 2026». */
function formatDate(value) {
  return new Date(value).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

/** Сам ролик плеером. Вертикальный, поэтому по высоте ограничен экраном. */
export function shortPlayer(short) {
  if (!short.assetId) return '<p class="hint">Файл ещё не загружен.</p>';
  return `<video class="short-video" controls playsinline preload="metadata"
    ${short.coverUrl ? `poster="${escapeHtml(short.coverUrl)}"` : ''}
    src="/media/asset/${short.assetId}"></video>`;
}

/** Список раздела. */
export function shortsListPage({ config, user, shorts }) {
  const isAdmin = user?.role === 'admin';
  return layout({
    config,
    user,
    path: '/shorts',
    title: 'Короткие ролики — Solo AI Journey',
    description: 'Короткие вертикальные ролики портала: главное из уроков за минуту.',
    body: `
<h1>Короткие ролики${
      isAdmin
        ? ` <a class="add" href="/shorts/new" title="Загрузить ролик" aria-label="Загрузить ролик">+</a>`
        : ''
    }</h1>

${
  shorts.length
    ? `<div class="shorts-grid">${shorts
        .map(
          (short) => `<article class="card short-card">
  <p class="meta">${
    short.status === 'published'
      ? escapeHtml(formatDate(short.publishedAt))
      : '<span class="badge">черновик</span>'
  }</p>
  <a href="/short/${encodeURIComponent(short.slug)}">${
    short.coverUrl
      ? `<img class="short-cover" src="${escapeHtml(short.coverUrl)}" alt="" loading="lazy">`
      : '<div class="short-cover button-brand"></div>'
  }</a>
  <h2><a href="/short/${encodeURIComponent(short.slug)}">${escapeHtml(short.title)}</a>${
    isAdmin
      ? ` <a class="edit" href="/short/${encodeURIComponent(short.slug)}/edit"
             title="Править ролик" aria-label="Править ролик">✎</a>`
      : ''
  }</h2>
</article>`
        )
        .join('')}</div>`
    : '<p class="hint">Роликов пока нет.</p>'
}`
  });
}

/** Страница одного ролика — так, как её увидит зритель. */
export function shortPage({ config, user, short }) {
  const isAdmin = user?.role === 'admin';
  return layout({
    config,
    user,
    path: `/short/${short.slug}`,
    title: `${short.title} — Solo AI Journey`,
    description: short.description.slice(0, 160) || short.title,
    image: short.coverUrl,
    body: `
<article class="card">
  <p class="meta">${
    short.status === 'published'
      ? escapeHtml(formatDate(short.publishedAt))
      : '<span class="badge">черновик — виден только вам</span>'
  }</p>
  <h1>${escapeHtml(short.title)}</h1>
  ${shortPlayer(short)}
  ${short.description ? `<p class="lead">${escapeHtml(short.description)}</p>` : ''}
  ${
    short.lesson
      ? `<p class="form-row">
           <a class="button" href="/lesson/${encodeURIComponent(short.lesson.slug)}">
             Смотреть урок целиком
           </a>
         </p>`
      : ''
  }
</article>

${
  isAdmin
    ? `<p class="form-row">
         <a class="button" href="/short/${encodeURIComponent(short.slug)}/edit">Править ролик</a>
       </p>`
    : ''
}`
  });
}

/** Страница загрузки нового ролика. */
export function shortNewPage({ config, user }) {
  return layout({
    config,
    user,
    path: '/shorts/new',
    title: 'Новый ролик — Solo AI Journey',
    description: 'Загрузить короткий вертикальный ролик.',
    body: `
<p><a href="/shorts">← Короткие ролики</a></p>
<h1>Новый ролик</h1>

<form class="card" data-short-new>
  <label>Заголовок
    <input name="title" maxlength="200" required>
  </label>
  <label>Описание
    <textarea name="description" rows="3" maxlength="2000"></textarea>
  </label>
  <p class="form-row">
    <label class="button" for="short-file">Выбрать файл</label>
    <span class="hint" data-short-file-name>файл не выбран</span>
    <input id="short-file" type="file" accept="video/mp4" hidden>
  </p>
  <p class="hint">
    Ролик вертикальный, mp4, до трёхсот мегабайт. Кадр-заставку портал снимет
    сам — с первой секунды.
  </p>
  <div class="form-row">
    <button class="button-brand" type="submit">Загрузить</button>
  </div>
</form>`
  });
}

/** Страница правки: вся работа над роликом собрана здесь. */
export function shortEditPage({ config, user, short, publications = [], platforms = [] }) {
  const published = short.status === 'published';
  const slug = encodeURIComponent(short.slug);

  return layout({
    config,
    user,
    path: `/short/${short.slug}/edit`,
    title: 'Правка ролика — Solo AI Journey',
    description: 'Поправить короткий ролик портала.',
    body: `
<p><a href="/shorts">← Короткие ролики</a></p>
<h1>Правка ролика</h1>

<form class="card" data-short-form="${escapeHtml(short.slug)}">
  <label>Заголовок
    <input name="title" value="${escapeHtml(short.title)}" maxlength="200" required>
  </label>
  <label>Описание
    <textarea name="description" rows="3" maxlength="2000">${escapeHtml(
      short.description
    )}</textarea>
  </label>
  <p class="hint">
    Заголовок и описание уходят в подпись поста вместе со ссылкой на этот ролик${
      short.lesson ? ' и на урок целиком' : ''
    }.
  </p>
  <div class="form-row">
    <button class="button-brand" type="submit">Сохранить</button>
    <button class="button" type="button" data-short-delete="${escapeHtml(short.slug)}">
      Удалить ролик
    </button>
  </div>
</form>

<section class="card">
  <h2>Выпуск</h2>
  <p class="hint">
    ${
      published
        ? `Ролик вышел ${escapeHtml(formatDate(short.publishedAt))} — он в разделе и открыт всем.
           Возврат в черновик убирает его у зрителей; дата выхода сохраняется.`
        : 'Пока черновик: в разделе и по прямой ссылке его видите только вы. Даже файл закрыт.'
    }
  </p>
  <p class="form-row">
    <a class="button" href="/short/${slug}">Открыть страницу ролика</a>
    <button class="${published ? 'button' : 'button-brand'}" type="button"
      data-short-publish="${escapeHtml(short.slug)}" value="${published ? 'no' : 'yes'}"
      ${short.assetId ? '' : 'disabled title="Сначала загрузите файл"'}>
      ${published ? 'Вернуть в черновик' : 'Опубликовать'}
    </button>
  </p>
</section>

<section class="card">
  <h2>Ролик</h2>
  ${shortPlayer(short)}
  ${
    short.lesson
      ? `<p class="hint">Вырезан из урока
           «<a href="/lesson/${encodeURIComponent(short.lesson.slug)}">${escapeHtml(
             short.lesson.title
           )}</a>». Файл остаётся за уроком — удаление ролика его не тронет.</p>`
      : `<p class="form-row">
           <label class="button" for="short-file">Заменить файл</label>
           <span class="hint" data-short-file-name>mp4, вертикальный, до 300 МБ</span>
           <input id="short-file" type="file" accept="video/mp4" hidden
             data-short-file="${escapeHtml(short.slug)}">
         </p>`
  }
</section>

<section class="card">
  <h2>Каналы</h2>
  ${
    platforms.length
      ? platforms
          .map((platform) => {
            const publication = publications.find((post) => post.platform === platform.name);
            const sendable = !publication || publication.state === 'failed';

            return `<div class="platform-row">
              <p><strong>${escapeHtml(platform.title)}</strong>: ${
                publication ? escapeHtml(publicationLabel(publication.state)) : 'не отправляли'
              }${
                publication?.url && publication.state !== 'failed'
                  ? ` — <a href="${escapeHtml(publication.url)}" rel="noopener" target="_blank">открыть</a>`
                  : ''
              }</p>
              ${
                publication?.error
                  ? `<p class="hint danger">${escapeHtml(publication.error)}</p>`
                  : ''
              }
              <p class="form-row">
                ${
                  sendable
                    ? `<button class="button" type="button"
                         data-short-post="${escapeHtml(platform.name)}"
                         value="${escapeHtml(short.slug)}"
                         ${published ? '' : 'disabled title="Сначала опубликуйте ролик"'}>
                         ${publication?.state === 'failed' ? 'Отправить заново' : 'Отправить ролик'}
                       </button>`
                    : ''
                }
              </p>
            </div>`;
          })
          .join('')
      : `<p class="hint">Ни один канал не настроен. Токен и адрес канала заводятся в
           <a href="/settings">настройках</a>.</p>`
  }
  <p class="hint">
    Ролик уходит в канал файлом, а не ссылкой: подписчик смотрит его в ленте, а
    не уходит на сайт. Telegram берёт от бота не больше 50 МБ, MAX — 250.
  </p>
</section>`
  });
}
