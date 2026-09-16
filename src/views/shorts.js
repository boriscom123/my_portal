// Раздел «Ролики»: список, страница ролика, страница правки.
//
// Устроен как «Новости» намеренно: у автора одно и то же дело — написать,
// посмотреть, выпустить, отправить в каналы, — и два разных устройства для
// одного дела заставляли бы вспоминать, где что лежит.
// Подключается из src/routes/pages.js.
import { escapeHtml } from '../lib/html.js';
import { assetUrl } from '../lib/assets.js';
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

/**
 * Сам ролик плеером. Вертикальный, поэтому по высоте ограничен экраном.
 *
 * Адрес приходит доводом: файл черновика наружу закрыт, и автору он отдаётся
 * по подписанной ссылке — иначе плеер на своей же странице оказывался пустым
 * (заказчик 2026-09-16). У выпущенного ролика адрес обычный и открытый.
 */
export function shortPlayer(short, src = null) {
  if (!short.assetId) return '<p class="hint">Файл ещё не загружен.</p>';
  return `<video class="short-video" controls playsinline preload="metadata"
    ${short.coverUrl ? `poster="${escapeHtml(short.coverUrl)}"` : ''}
    src="${escapeHtml(src ?? `/media/asset/${short.assetId}`)}"></video>`;
}

/** Список раздела. */
/**
 * Нарезки из уроков — для автора: выбор урока, его нарезки и сборка.
 * Блок стоит там, где заводят ролик: нарезка и есть способ его завести.
 * Выбор урока — обычной формой с адресом: работает и без скрипта, и страницу
 * с выбранным уроком можно открыть по ссылке.
 */
function clipsPanelHtml({ lessons = [], chosen = null, clips = [], made = [], hasTranscript = false }) {
  return `<section class="card">
  <h2>Нарезки из уроков</h2>
  <p class="hint">
    Вертикальные ролики нарезаются из мест урока, где вы говорите плотнее всего,
    а подписи вшиваются внутрь видео. Поэтому собирать их стоит
    ПОСЛЕ того, как поправите титры: иначе придётся резать заново.
    Сборка занимает пару минут.
  </p>
  <form action="/shorts/new" method="get" class="form-row">
    <label>Урок
      <select name="lesson">
        <option value="">— выберите урок —</option>
        ${lessons
          .map(
            (lesson) =>
              `<option value="${escapeHtml(lesson.slug)}"${
                chosen?.slug === lesson.slug ? ' selected' : ''
              }>${escapeHtml(lesson.title)}</option>`
          )
          .join('')}
      </select>
    </label>
    <button class="button" type="submit">Показать</button>
  </form>
  ${
    chosen
      ? `${
          clips.length
            ? `<ul class="clip-list">${clips
                .map((item) => {
                  const short = made.find((one) => one.assetId === item.id);
                  return `<li>
              <a href="${escapeHtml(item.url)}">${escapeHtml(item.name)}</a>
              ${
                short
                  ? ` — <a href="/short/${encodeURIComponent(short.slug)}/edit">ролик «${escapeHtml(
                      short.title
                    )}»</a>`
                  : `<button class="button" type="button" data-make-short="${item.id}"
                       value="${escapeHtml(chosen.slug)}">Сделать роликом</button>`
              }
            </li>`;
                })
                .join('')}</ul>
         <p class="hint">
           Ссылка живёт час — посмотрите и решите, годится ли. «Сделать роликом»
           заводит ролик в этом разделе: файл остаётся за уроком и перестаёт стареть.
         </p>`
            : '<p class="hint">Нарезок у этого урока ещё нет.</p>'
        }
  <p class="form-row">
    <button class="${clips.length ? 'button' : 'button-brand'}" type="button"
      data-clips="${escapeHtml(chosen.slug)}" ${hasTranscript ? '' : 'disabled title="Сначала нужна расшифровка"'}>
      ${clips.length ? 'Пересобрать ролики' : 'Собрать ролики'}
    </button>
  </p>`
      : ''
  }
</section>`;
}

export function shortsListPage({ config, user, shorts }) {
  const isAdmin = user?.role === 'admin';
  return layout({
    config,
    user,
    path: '/shorts',
    breadcrumbs: [{ title: 'Ролики' }],
    title: 'Ролики — Solo AI Journey',
    description: 'Короткие вертикальные ролики портала: главное из уроков за минуту.',
    body: `
<h1>Ролики${
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
export function shortPage({ config, user, short, videoUrl = null }) {
  const isAdmin = user?.role === 'admin';
  return layout({
    config,
    user,
    path: `/short/${short.slug}`,
    breadcrumbs: [{ title: 'Ролики', href: '/shorts' }, { title: short.title }],
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
  ${shortPlayer(short, videoUrl)}
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
export function shortNewPage({ config, user, clipsPanel = null }) {
  return layout({
    config,
    user,
    path: '/shorts/new',
    breadcrumbs: [{ title: 'Ролики', href: '/shorts' }, { title: 'Новый ролик' }],
    title: 'Новый ролик — Solo AI Journey',
    description: 'Загрузить короткий вертикальный ролик.',
    body: `
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
</form>

${clipsPanel ? clipsPanelHtml(clipsPanel) : ''}

<!-- Кнопки сборки и «Сделать роликом» слушает скрипт кабинета. -->
<script src="${assetUrl('/admin.js')}" type="module"></script>`
  });
}

/** Страница правки: вся работа над роликом собрана здесь. */
export function shortEditPage({ config, user, short, publications = [], platforms = [], videoUrl = null }) {
  const published = short.status === 'published';
  const slug = encodeURIComponent(short.slug);

  return layout({
    config,
    user,
    path: `/short/${short.slug}/edit`,
    breadcrumbs: [
      { title: 'Ролики', href: '/shorts' },
      { title: short.title, href: `/short/${encodeURIComponent(short.slug)}` },
      { title: 'Правка' }
    ],
    title: 'Правка ролика — Solo AI Journey',
    description: 'Поправить короткий ролик портала.',
    body: `
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
  <label>Хэштеги
    <input name="hashtags" value="${escapeHtml(short.hashtags.join(', '))}"
      placeholder="docker, свойсервер, телеграмбот">
  </label>
  <p class="hint">
    Заголовок и описание уходят в подпись поста вместе со ссылкой на этот ролик${
      short.lesson ? ' и на урок целиком' : ''
    }. В Instagram заголовок — первая строка подписи, её видно до «ещё»; хэштеги
    идут туда же последней строкой. Через запятую, решётку портал поставит сам.
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
  ${shortPlayer(short, videoUrl)}
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
  <h2>Текст из ролика</h2>
  <p class="hint">
    Портал расшифрует речь ролика и по ней предложит заголовок, описание и
    хэштеги — словами, по которым Instagram решает, кому показать ролик. Поля
    формы заполнятся, но сохранятся, только когда вы нажмёте «Сохранить».
    Расшифровка идёт минуту-другую, ответ модели — ещё до двух минут.
  </p>
  <p class="form-row">
    <button class="button-brand" type="button" data-short-suggest="${escapeHtml(short.slug)}"
      ${short.assetId ? '' : 'disabled title="Сначала загрузите файл"'}>
      ${short.transcript ? 'Предложить текст заново' : 'Расшифровать и предложить текст'}
    </button>
  </p>
  <details data-short-transcript ${short.transcript ? '' : 'hidden'}>
    <summary>Расшифровка</summary>
    <p class="hint" data-short-transcript-text>${escapeHtml(short.transcript ?? '')}</p>
  </details>
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
