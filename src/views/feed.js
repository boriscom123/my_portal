// Лента: уроки и новости, свежие сверху. Задача — дать поисковику и человеку
// без приложения полноценную главную страницу.
// Вызывается из src/routes/pages.js по маршрутам / и /tag/:slug.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';
import { stateLabel } from './lesson-state.js';
import { hero } from './hero.js';
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

/**
 * Бейдж вида карточки: урок это или новость — видно до заголовка.
 * Лежит на картинке в левом верхнем углу; цвета оба фирменные и разные, чтобы
 * отличать по цвету, не читая слово. Серая пометка у даты терялась.
 */
function kindBadge(kind) {
  return kind === 'news'
    ? '<span class="kind-badge kind-news">Новость</span>'
    : '<span class="kind-badge kind-lesson">Урок</span>';
}

function lessonCard(lesson, isAdmin) {
  const date = lesson.publishedAt ? formatDate(lesson.publishedAt) : 'черновик';
  // Состояние обработки видит только автор: зрителю оно ничего не говорит, а
  // на главной автор оказывается чаще, чем в кабинете.
  const state = isAdmin ? stateLabel(lesson) : '';
  // wide: урок занимает всю ширину ленты. Урок — то, ради чего портал, и
  // ставить его в один ряд с заметкой значит уравнять час работы и три абзаца.
  return `<article class="lesson-card wide">
  <a class="card-media" href="/lesson/${encodeURIComponent(lesson.slug)}">${cover(lesson)}
    ${kindBadge('lesson')}</a>
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
 * бейдж «Новость». Вперемешку без различий лента читалась бы как сломанная — человек не
 * понимал бы, почему одни карточки открывают видео, а другие текст.
 */
function newsCard(item) {
  return `<article class="lesson-card news-in-feed">
  ${
    item.images.length
      ? `<a class="card-media" href="/news/${encodeURIComponent(item.slug)}"><img class="cover" src="${escapeHtml(
          item.images[0].url
        )}" alt="" loading="lazy">
    ${kindBadge('news')}</a>`
      : ''
  }
  <div class="card-body">
    ${item.images.length ? '' : kindBadge('news')}
    <p class="meta">${escapeHtml(formatDate(item.publishedAt))}</p>
    <h3><a href="/news/${encodeURIComponent(item.slug)}">${escapeHtml(item.title)}</a></h3>
    <p class="card-text">${escapeHtml(item.body).slice(0, 220)}</p>
  </div>
</article>`;
}

export function feedPage({ config, lessons, news = [], user, tag = null }) {
  // Одна лента по дате: уроки снимаются долго, а новости выходят часто, и
  // разложенные по разным разделам они читались бы как два несвязанных сайта.
  const feed = [
    ...lessons.map((lesson) => ({
      kind: 'lesson',
      at: lesson.publishedAt ?? lesson.createdAt ?? new Date(0),
      html: lessonCard(lesson, user?.role === 'admin')
    })),
    ...news.map((item) => ({ kind: 'news', at: item.publishedAt, html: newsCard(item) }))
  ].sort((first, second) => new Date(second.at) - new Date(first.at));

  // Идущие подряд новости собираются в один ряд — по две, не больше. Урок
  // разрывает ряд и встаёт во всю ширину. Порядок по дате при этом цел: ряд
  // собирается только из соседей по ленте, а не из всех новостей подряд.
  const rows = [];
  for (const item of feed) {
    const last = rows.at(-1);
    if (item.kind === 'news' && last?.kind === 'news') last.items.push(item.html);
    else rows.push({ kind: item.kind, items: [item.html] });
  }

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
    : hero()
}

<section>
  ${
    feed.length
      ? `<div class="feed">${rows
          .map((row) =>
            row.kind === 'news'
              ? `<div class="news-grid">${row.items.join('')}</div>`
              : row.items.join('')
          )
          .join('')}</div>`
      : '<p class="hint">Пока ни одного урока. Первый уже собирается.</p>'
  }
</section>`
  });
}
