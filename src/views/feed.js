// Лента: уроки и новости, свежие сверху. Задача — дать поисковику и человеку
// без приложения полноценную главную страницу.
// Вызывается из src/routes/pages.js по маршрутам / и /tag/:slug.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';
import { stateLabel } from './lesson-state.js';
import { hero } from './hero.js';

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

export function feedPage({ config, lessons, news, user, tag = null }) {
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
  <h2>Уроки</h2>
  ${
    lessons.length
      ? `<div class="lessons-grid">${lessons
          .map((lesson) => lessonCard(lesson, user?.role === 'admin'))
          .join('')}</div>`
      : '<p class="hint">Пока ни одного урока. Первый уже собирается.</p>'
  }
</section>

${
  news.length
    ? `<section class="news">
  <h2>Новости</h2>
  ${news
    .map(
      (n) => `<article class="card">
    <p class="meta">${escapeHtml(formatDate(n.publishedAt))}</p>
    <h3>${escapeHtml(n.title)}</h3>
    <p>${escapeHtml(n.body)}</p>
  </article>`
    )
    .join('')}
</section>`
    : ''
}`
  });
}
