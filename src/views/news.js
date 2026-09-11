// Раздел «Новости»: список и страница одной новости.
//
// Задача — показать новости всем, а автору дать их писать прямо здесь.
// Отдельной админской страницы у новостей нет намеренно: она отличалась бы от
// публичной только кнопками, а две почти одинаковые страницы однажды разойдутся.
// Подключается из src/routes/pages.js.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';
import { publicationLabel } from './publication-state.js';
import { isDrawing } from '../services/cover-drawing.js';

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
  <p class="meta">${
    item.status === 'published'
      ? escapeHtml(formatDate(item.publishedAt))
      : '<span class="badge">черновик</span>'
  }</p>
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
  <p class="meta">${
    item.status === 'published'
      ? escapeHtml(formatDate(item.publishedAt))
      : '<span class="badge">черновик — виден только вам</span>'
  }</p>
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

/**
 * Картинки новости в кабинете: у каждой «Удалить», рядом рисование и загрузка.
 * Отдельно от ленты для читателя: там картинка — содержимое, здесь — предмет
 * работы, и кнопки посреди новости читателю ни к чему.
 */
function newsImagesAdmin(item, drawingReady) {
  const slug = escapeHtml(item.slug);
  // Картинка рисуется прямо сейчас: кнопка занята, страница ждёт конца сама.
  const drawingNow = isDrawing(item.drawing);
  return `${
    item.images.length
      ? `<ul class="cover-choice">${item.images
          .map(
            (image, index) => `<li>
          <img src="${escapeHtml(image.url)}" alt="">
          <span class="meta">${index === 0 ? 'первая — уходит в пост канала' : `№ ${index + 1}`}</span>
          <span class="form-row">
            <button class="button" type="button" data-news-image-remove="${image.id}"
              title="Убрать эту картинку">Удалить</button>
          </span>
        </li>`
          )
          .join('')}</ul>`
      : '<p class="hint">Картинок пока нет.</p>'
  }
  ${
    drawingReady
      ? `<label class="field">Запрос для рисования — по-английски
      <textarea rows="3" maxlength="1000" data-news-image-prompt
        placeholder="Пусто — запрос составит Gemini по заголовку и тексту новости">${escapeHtml(item.imagePrompt?.text ?? '')}</textarea>
    </label>
    <p class="hint">
      ${
        item.imagePrompt?.source === 'suggested'
          ? 'Запрос составлен по заголовку и тексту новости. Поправьте, если нужно, и нажмите «Нарисовать картинку».'
          : item.imagePrompt
            ? 'Последняя картинка нарисована по этому запросу.'
            : 'Поле можно оставить пустым: запрос составит Gemini по заголовку и тексту.'
      }
      Пишите по-английски и только то, что должно быть на картинке: «no …» модель читает как «нарисуй …».
    </p>`
      : `<p class="hint">
      Рисование выключено: <a href="/settings">добавьте токен Hugging Face в настройках</a>.
    </p>`
  }
  <p class="form-row">
    ${drawingReady ? `<button class="button" type="button" data-news-prompt="${slug}">Составить запрос</button>` : ''}
    <button class="button" type="button" data-draw-news="${slug}"
      ${
        !drawingReady
          ? 'disabled title="Добавьте токен Hugging Face в настройках"'
          : drawingNow
            ? `disabled data-news-draw-watch="${slug}"`
            : ''
      }>
      ${drawingNow ? 'Рисую…' : 'Нарисовать картинку'}
    </button>
    <label class="button" for="news-image">Добавить картинку</label>
    <input id="news-image" type="file" accept="image/png,image/jpeg,image/webp" hidden
      data-news-image="${slug}">
  </p>
  ${
    item.sideError?.step === 'makeNewsImage'
      ? `<p class="hint danger">Нарисовать не вышло: ${escapeHtml(item.sideError.message)}</p>`
      : ''
  }`;
}

/** Страница создания и правки новости. */
export function newsEditPage({
  config,
  user,
  item = null,
  publications = [],
  platforms = [],
  drawingReady = false
}) {
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

${item ? newsAdminBlock(item, publications, platforms) : ''}

${
  item
    ? `<section class="card">
  <h2>Картинки</h2>
  <p class="hint">
    Одна показывается как есть, несколько — лентой с прокруткой. Порядок — тот,
    в каком они появлялись; первая уходит в пост канала.
  </p>
  ${newsImagesAdmin(item, drawingReady)}
</section>`
    : '<p class="hint">Картинки добавляются после сохранения — на этой же странице.</p>'
}`
  });
}

/**
 * Выпуск новости и посты в каналах — блоки на странице правки.
 *
 * Не на странице просмотра: там новость показывается так, как её увидит
 * читатель, и формы посреди неё мешают увидеть главное — саму новость. Всё,
 * что автор с новостью делает, собрано в одном месте: правка, выпуск, каналы,
 * картинки.
 */
function newsAdminBlock(item, publications, platforms) {
  const published = item.status === 'published';
  const slug = encodeURIComponent(item.slug);

  return `<section class="card">
  <h2>Выпуск</h2>
  <p class="hint">
    ${
      published
        ? `Новость вышла ${escapeHtml(formatDate(item.publishedAt))} — она в ленте и на витрине.
           Возврат в черновик убирает её у читателей; дата выхода при этом
           сохраняется, и повторный выпуск не поднимет старую новость наверх.`
        : `Пока черновик: в ленте и в списке её видите только вы. Выпуск ставит
           дату — ту самую, что увидят читатели.`
    }
  </p>
  <p class="form-row">
    <a class="button" href="/news/${slug}/edit">Править новость</a>
    <button class="${published ? 'button' : 'button-brand'}" type="button"
      data-news-publish="${escapeHtml(item.slug)}" value="${published ? 'no' : 'yes'}">
      ${published ? 'Вернуть в черновик' : 'Опубликовать'}
    </button>
  </p>
</section>

<section class="card">
  <h2>Каналы</h2>
  ${
    platforms.length
      ? platforms
          .map((platform) => {
            const publication = publications.find((post) => post.platform === platform.name);
            // Кнопка остаётся там, где ей есть что делать: пост, который уже
            // ушёл, вторым нажатием не обновится — уедет вторая копия, и
            // убирать её придётся руками в самом канале.
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
                         data-news-post="${escapeHtml(platform.name)}"
                         value="${escapeHtml(item.slug)}"
                         ${published ? '' : 'disabled title="Сначала опубликуйте новость"'}>
                         ${publication?.state === 'failed' ? 'Отправить заново' : 'Отправить пост'}
                       </button>`
                    : ''
                }
                ${
                  // Пост уже в канале: правим его, а не шлём второй. Второй пост
                  // означал бы второе уведомление подписчикам об одной новости.
                  publication?.state === 'published' && publication.externalId
                    ? `<button class="button" type="button"
                         data-news-refresh="${escapeHtml(platform.name)}"
                         value="${escapeHtml(item.slug)}">Обновить пост</button>`
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
    В пост уходит заголовок, начало текста и ссылка на страницу новости.
    Картинка — первая из тех, что стоят ниже; без неё пост уйдёт текстом.
  </p>
  <p class="hint">
    Поправили новость — нажмите «Обновить пост»: портал перепишет уже
    отправленный, а не отправит второй. Второй пост — это второе уведомление
    подписчикам об одной и той же новости. Картинку Telegram в готовом посте
    менять не даёт, обновится только текст; MAX перекладывает и картинку.
  </p>
</section>`;
}
