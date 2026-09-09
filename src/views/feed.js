// Лента: уроки и новости, свежие сверху. Задача — дать поисковику и человеку
// без приложения полноценную главную страницу.
// Вызывается из src/routes/pages.js по маршрутам / и /tag/:slug.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';
import { stateLabel } from './lesson-state.js';
import { hero, heroLessons } from './hero.js';
import { platformLinks } from './platform-links.js';

/** Дата в виде, привычном читателю: «1 августа 2026». */
export function formatDate(value) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(new Date(value));
}

/** Обложка. Пока урок без картинки — фирменный градиент вместо серой заглушки. */
function cover(lesson) {
  return lesson.coverUrl
    ? `<img src="${escapeHtml(lesson.coverUrl)}" alt="" class="cover">`
    : '<div class="cover button-brand"></div>';
}

function lessonCard(lesson, isAdmin) {
  const date = lesson.publishedAt ? formatDate(lesson.publishedAt) : 'черновик';
  // Состояние обработки видит только автор: зрителю оно ничего не говорит, а
  // на главной автор оказывается чаще, чем в кабинете.
  const state = isAdmin ? stateLabel(lesson) : '';
  return `<article class="lesson-card">
  <a href="/lesson/${encodeURIComponent(lesson.slug)}">${cover(lesson)}</a>
  <div class="card-body">
    <p class="meta">${escapeHtml(date)}${
      state
        ? ` · <span class="badge${lesson.pipelineState === 'failed' ? ' danger' : ''}">${escapeHtml(state)}</span>`
        : ''
    }</p>
    <h3><a href="/lesson/${encodeURIComponent(lesson.slug)}">${escapeHtml(lesson.title)}</a></h3>
    <p class="card-text">${escapeHtml(lesson.description)}</p>
    ${
      platformLinks(lesson.publications ?? [], { className: 'platform-link', prefix: '' })
        ? `<p class="platform-links">Смотреть: ${platformLinks(lesson.publications ?? [], {
            className: 'platform-link',
            prefix: ''
          })}</p>`
        : ''
    }
    ${
      lesson.tags.length
        ? `<p class="tags">${lesson.tags
            .map(
              (t) =>
                `<a class="tag" href="/tag/${encodeURIComponent(t)}">${escapeHtml(t)}</a>`
            )
            .join(' ')}</p>`
        : ''
    }
  </div>
</article>`;
}

/**
 * Карточка новости в общей ленте.
 *
 * Отличается от урока намеренно: у новости нет обложки на всю карточку и есть
 * пометка. Вперемешку без различий лента читалась бы как сломанная — человек не
 * понимал бы, почему одни карточки открывают видео, а другие текст.
 */
function newsCard(item) {
  return `<article class="lesson-card news-in-feed">
  ${
    item.images.length
      ? `<a href="/news/${encodeURIComponent(item.slug)}"><img class="cover" src="${escapeHtml(
          item.images[0].url
        )}" alt="" loading="lazy"></a>`
      : ''
  }
  <div class="card-body">
    <p class="meta">${escapeHtml(formatDate(item.publishedAt))} · <span class="badge">новость</span></p>
    <h3><a href="/news/${encodeURIComponent(item.slug)}">${escapeHtml(item.title)}</a></h3>
    <p class="card-text">${escapeHtml(item.body).slice(0, 220)}</p>
  </div>
</article>`;
}

export function feedPage({ config, lessons, news = [], user, tag = null }) {
  // Одна лента по дате: уроки снимаются долго, а новости выходят часто, и
  // разложенные по разным разделам они читались бы как два несвязанных сайта.
  // Наверху заглавный блок уже показал свежие уроки. Повторять их карточками
  // сразу под собой — значит выводить один урок дважды: сперва текстом, потом
  // обложкой. В ленте остаётся то, что наверх не попало.
  const shownAbove = new Set(tag ? [] : heroLessons(lessons).map((lesson) => lesson.id));
  const feed = [
    ...lessons
      .filter((lesson) => !shownAbove.has(lesson.id))
      .map((lesson) => ({
      at: lesson.publishedAt ?? lesson.createdAt ?? new Date(0),
      html: lessonCard(lesson, user?.role === 'admin')
    })),
    ...news.map((item) => ({ at: item.publishedAt, html: newsCard(item) }))
  ].sort((first, second) => new Date(second.at) - new Date(first.at));

  const heading = tag ? `Уроки по теме «${tag}»` : 'Solo AI Journey';

  return layout({
    config,
    user,
    path: tag ? `/tag/${encodeURIComponent(tag)}` : '/',
    title: tag ? `${heading} — Solo AI Journey` : 'Solo AI Journey — портал видеоуроков',
    description:
      'Видеоуроки о разработке с ИИ: Claude Code, свой VPS и Telegram-бот. Уроки, новости и борд идей для будущих выпусков.',
    body: `
${
  tag
    ? `<h1>${escapeHtml(heading)}</h1><p><a href="/">← все уроки</a></p>`
    : hero({ lessons })
}

<section>
  ${
    feed.length
      ? `<div class="lessons-grid">${feed.map((item) => item.html).join('')}</div>`
      : '<p class="hint">Пока ни одного урока. Первый уже собирается.</p>'
  }
</section>`
  });
}
